import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMarketplaceServer } from '../src/marketplace-mcp.js';

test('agents can discover and inspect the real catalog, with no execution verbs',async t=>{
 const server=await buildMarketplaceServer();
 const client=new Client({name:'union-test',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();
 t.after(async()=>{await client.close();await server.close();});
 await server.connect(a);await client.connect(b);
 assert.deepEqual((await client.listTools()).tools.map(t=>t.name),['find_tools','inspect_tool']);
 const search=await client.callTool({name:'find_tools',arguments:{query:'pdf'}});
 assert.equal(search.structuredContent.total,2);
 const item=await client.callTool({name:'inspect_tool',arguments:{id:'opentakeoff-mcp'}});
 assert.equal(item.structuredContent.listing.security.status,'blocked');
 assert.equal(item.structuredContent.listing.status,'paused');
 const missing=await client.callTool({name:'inspect_tool',arguments:{id:'unknown-tool'}});
 assert.equal(missing.isError,true);
 const bad=await client.callTool({name:'find_tools',arguments:{query:'takeoff',shell:'anything'}});
 assert.equal(bad.isError,true);
});
