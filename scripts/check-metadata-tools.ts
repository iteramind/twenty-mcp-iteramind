// Ejecuta las herramientas de esquema (solo lectura) contra Twenty real vía MCP en memoria.
//   node --env-file=.env --import tsx scripts/check-metadata-tools.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TwentyClient } from '../src/client/twenty-client.js';
import { registerMetadataTools } from '../src/tools/metadata.js';

const twenty = new TwentyClient({ apiKey: process.env.TWENTY_API_KEY!, baseUrl: process.env.TWENTY_BASE_URL! });
const server = new McpServer({ name: 'check', version: '1' });
registerMetadataTools(server, twenty);
const [a, b] = InMemoryTransport.createLinkedPair();
const mcp = new Client({ name: 'check', version: '1' });
await Promise.all([server.connect(a), mcp.connect(b)]);

const { tools } = await mcp.listTools();
const calls: [string, Record<string, unknown>][] = [
  ['list_all_objects', {}],
  ['get_object_schema', { objectName: 'opportunity' }],
  ['get_field_metadata', { objectName: 'quotation', includeSystem: false }],
];
let failed = 0;
for (const [name, args] of calls) {
  const tool = tools.find(t => t.name === name);
  if (!tool) { console.log(`✖ ${name} no existe`); failed++; continue; }
  const r = await mcp.callTool({ name, arguments: args });
  const text = (r.content as { text: string }[])[0]?.text ?? '';
  const bad = r.isError || /^(Error|Failed)/.test(text);
  if (bad) failed++;
  console.log(`${bad ? '✖' : '✔'} ${name} ${JSON.stringify(args)}\n${text.slice(0, 700)}\n`);
}
process.exit(failed ? 1 : 0);
