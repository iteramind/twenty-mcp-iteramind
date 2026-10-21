// Valida (sin modificar datos) que los campos que envían update_contact, update_company y
// update_opportunity existan en Twenty: usa un ID inexistente, así Twenty solo debe responder
// que el registro no existe.
//   node --env-file=.env --import tsx scripts/check-write-fields.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TwentyClient } from '../src/client/twenty-client.js';
import { registerPersonTools, registerCompanyTools } from '../src/tools/index.js';
import { registerOpportunityTools } from '../src/tools/opportunities.js';

const twenty = new TwentyClient({ apiKey: process.env.TWENTY_API_KEY!, baseUrl: process.env.TWENTY_BASE_URL! });
const server = new McpServer({ name: 'c', version: '1' });
registerPersonTools(server, twenty); registerCompanyTools(server, twenty); registerOpportunityTools(server, twenty);
const [a, b] = InMemoryTransport.createLinkedPair();
const mcp = new Client({ name: 'c', version: '1' });
await Promise.all([server.connect(a), mcp.connect(b)]);
const ghost = '3f2b9c1e-7d4a-4e8b-9a61-5c2d8e0f1a27'; // no existe
const calls: [string, any][] = [
  ['update_contact', { id: ghost, firstName: 'X', lastName: 'Y', email: 'x@example.test', phone: '8110000000', jobTitle: 'X', linkedinUrl: 'https://linkedin.com/in/x', companyId: ghost }],
  ['update_company', { id: ghost, name: 'X', domainName: 'x.test', address: 'Calle 1', linkedinUrl: 'https://linkedin.com/company/x', annualRevenue: 10, accountOwnerId: ghost }],
  ['update_opportunity', { id: ghost, name: 'X', amount: { value: 1, currency: 'MXN' }, closeDate: '2030-01-01', companyId: ghost, pointOfContactId: ghost }],
];
for (const [name, args] of calls) {
  const r = await mcp.callTool({ name, arguments: args });
  console.log(name, '→', (r.content as any)[0].text.split('\n')[0].slice(0, 220));
}
