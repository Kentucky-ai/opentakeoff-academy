#!/usr/bin/env node
// examples/my-parser.mcp.example.js
//
// A reference "bring your own parser" for OpenTakeoff Academy, exposed as an
// MCP stdio server. In a real submission this is where your proprietary
// document parser lives: the runner calls it as a black box and only the tool
// call + result appear in the trace (and may be redacted). Its internals never
// leave your machine.
//
// This example ships a single deterministic tool, `parse_planset`, that
// returns structured rooms/finishes for the practice sample. Run it directly
// via the descriptor examples/my-parser.mcp.example.json:
//
//   opentakeoff-academy run --track div9 --suite practice \
//     --endpoint http://localhost:8123/v1 --model my-model \
//     --mcp examples/my-parser.mcp.example.json --out ./runs/my-run.bundle.json
//
// Implemented on the official @modelcontextprotocol/sdk with the low-level
// Server API (no extra deps).

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Deterministic "parse" of the sample planset. A real parser would rasterize
// the asset (assetRef) and detect rooms, finishes, and polygons.
function parsePlanset(args = {}) {
  return {
    assetRef: args.assetRef || 'sample/rm101.png',
    scale: { pxPerFt: 10, source: 'scale-bar' },
    rooms: [
      {
        roomId: 'RM-101',
        finish: 'LVT',
        polygonPx: [[0, 0], [340, 0], [340, 250], [0, 250]],
        widthPx: 340,
        heightPx: 250,
        areaSf: 850,
      },
    ],
    notes: 'reference parser: single-room deterministic output',
  };
}

const TOOLS = [
  {
    name: 'parse_planset',
    description: 'Parse a planset asset into structured rooms, finishes, and polygons (px). Black-box entrant tool.',
    inputSchema: {
      type: 'object',
      properties: {
        assetRef: { type: 'string', description: 'Path/URL to the planset asset.' },
        page: { type: 'integer', description: 'Page/sheet to parse.' },
      },
      additionalProperties: true,
    },
  },
];

async function main() {
  const server = new Server(
    { name: 'ota-example-parser', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    if (name === 'parse_planset') {
      const result = parsePlanset(args);
      // Return both a text block (for generic clients) and structuredContent
      // (which the runner's MCP client prefers).
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
    return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
  });

  await server.connect(new StdioServerTransport());
  // Server now runs until stdin closes.
}

main().catch((e) => { console.error('[example-parser] fatal:', e); process.exit(1); });
