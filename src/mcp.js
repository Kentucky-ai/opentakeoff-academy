// src/mcp.js
//
// Minimal MCP client used to expose an entrant's own parser as a black-box
// toolset to the agent loop. The runner lists the server's tools, advertises
// them to the model, and calls them on demand; only the call + result appear
// in the trace (and may be redacted for private tools).
//
// We use the official @modelcontextprotocol/sdk when available (it keeps
// stdio/HTTP transport handling correct and small). If the SDK cannot be
// loaded for some reason, we fall back to a tiny stdio JSON-RPC client so the
// harness still works with the example parser we ship.
//
// A descriptor is a small JSON object:
//   stdio:  { "command": "node", "args": ["my-parser.js"], "env": { ... }, "cwd": "..." }
//   http:   { "url": "https://my-parser.example/mcp" }

/**
 * @typedef {Object} McpConnection
 * @property {() => Promise<Array<{name:string, description?:string, inputSchema?:object}>>} listTools
 * @property {(name:string, args:object) => Promise<any>} callTool
 * @property {() => Promise<void>} close
 * @property {string} serverId
 */

/**
 * Connect to an MCP server described by `descriptor`.
 * @param {object} descriptor - { command,args,env,cwd } (stdio) or { url } (http)
 * @param {object} [opts]
 * @param {string} [opts.serverId] - id recorded in trace `server` fields
 * @returns {Promise<McpConnection>}
 */
export async function connectMcp(descriptor, opts = {}) {
  const serverId = opts.serverId || descriptor.id || (descriptor.command ? `stdio:${descriptor.command}` : descriptor.url) || 'mcp';
  try {
    return await connectWithSdk(descriptor, serverId);
  } catch (err) {
    // Only the stdio transport has a hand-rolled fallback; HTTP requires the SDK.
    if (!descriptor.command) throw err;
    return connectStdioFallback(descriptor, serverId, err);
  }
}

/** Preferred path: the official MCP SDK. */
async function connectWithSdk(descriptor, serverId) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  let transport;
  if (descriptor.url) {
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    transport = new StreamableHTTPClientTransport(new URL(descriptor.url));
  } else if (descriptor.command) {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    transport = new StdioClientTransport({
      command: descriptor.command,
      args: descriptor.args || [],
      env: descriptor.env ? { ...process.env, ...descriptor.env } : process.env,
      cwd: descriptor.cwd,
    });
  } else {
    throw new Error('mcp descriptor needs either "command" (stdio) or "url" (http)');
  }

  const client = new Client({ name: 'opentakeoff-academy-runner', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);

  return {
    serverId,
    async listTools() {
      const res = await client.listTools();
      return (res.tools || []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    },
    async callTool(name, args) {
      const res = await client.callTool({ name, arguments: args || {} });
      return normalizeToolResult(res);
    },
    async close() {
      try { await client.close(); } catch { /* ignore */ }
    },
  };
}

/**
 * Fallback stdio JSON-RPC 2.0 client (line/Content-Length framing per MCP).
 * Kept intentionally small; only what the runner needs: initialize,
 * tools/list, tools/call.
 */
async function connectStdioFallback(descriptor, serverId, sdkError) {
  const { spawn } = await import('node:child_process');
  const child = spawn(descriptor.command, descriptor.args || [], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: descriptor.env ? { ...process.env, ...descriptor.env } : process.env,
    cwd: descriptor.cwd,
  });

  let buf = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();

  child.stdout.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    // MCP stdio framing is newline-delimited JSON in practice; support both
    // bare-line JSON and Content-Length framed messages.
    for (;;) {
      const nl = buf.indexOf(0x0a);
      if (nl === -1) break;
      const line = buf.subarray(0, nl).toString('utf8').trim();
      buf = buf.subarray(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || 'mcp error'));
        else resolve(msg.result);
      }
    }
  });

  function rpc(method, params) {
    const id = nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(payload);
    });
  }

  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'opentakeoff-academy-runner', version: '1.0.0' },
  });
  // notifications/initialized (no response expected)
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  return {
    serverId,
    _fallback: true,
    _sdkError: sdkError && String(sdkError.message || sdkError),
    async listTools() {
      const res = await rpc('tools/list', {});
      return (res.tools || []).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    },
    async callTool(name, args) {
      const res = await rpc('tools/call', { name, arguments: args || {} });
      return normalizeToolResult(res);
    },
    async close() {
      try { child.stdin.end(); child.kill(); } catch { /* ignore */ }
    },
  };
}

/**
 * MCP tool results arrive as { content: [{type:'text', text}, ...], structuredContent?, isError? }.
 * Prefer structuredContent; otherwise parse a lone JSON text block; otherwise
 * return the raw content array.
 */
function normalizeToolResult(res) {
  if (!res) return null;
  if (res.structuredContent !== undefined) return res.structuredContent;
  const content = res.content || [];
  if (content.length === 1 && content[0]?.type === 'text') {
    const text = content[0].text;
    try { return JSON.parse(text); } catch { return text; }
  }
  return { content, isError: res.isError };
}

/**
 * Turn an MCP tool listing into OpenAI function-tool definitions so the model
 * can call them. Returns { tools, names } where names is a Set for routing.
 * @param {Array<{name,description,inputSchema}>} mcpTools
 */
export function mcpToolsToOpenAI(mcpTools) {
  const names = new Set();
  const tools = mcpTools.map((t) => {
    names.add(t.name);
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.description || `Entrant MCP tool: ${t.name}`,
        parameters: t.inputSchema && typeof t.inputSchema === 'object'
          ? t.inputSchema
          : { type: 'object', properties: {}, additionalProperties: true },
      },
    };
  });
  return { tools, names };
}
