import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerPersonTools, registerCompanyTools } from '../../src/tools/index.js';
import { fakeClient, connection } from './helpers.js';

async function setup() {
  const { client, calls } = fakeClient(call => {
    if (call.query.includes('updatePerson')) return { updatePerson: { id: 'p1', name: { firstName: 'Ana', lastName: 'Ruiz' } } };
    if (call.query.includes('updateCompany')) return { updateCompany: { id: 'c1', name: 'Acme' } };
    if (call.query.includes('createPerson')) return { createPerson: { id: 'p1', name: { firstName: 'Ana', lastName: 'Ruiz' } } };
    return { people: connection([{ id: 'p1', name: { firstName: 'Ana', lastName: 'Ruiz' } }]) };
  });
  const server = new McpServer({ name: 't', version: '1' });
  registerPersonTools(server, client);
  registerCompanyTools(server, client);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 't', version: '1' });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  const call = (name: string, args: Record<string, unknown>) => mcp.callTool({ name, arguments: args });
  const sent = (mutation: string) => calls.find(c => c.query.includes(mutation))!.variables;
  return { call, sent };
}

test('update_contact convierte a la forma anidada de Twenty y conserva el apellido', async () => {
  const { call, sent } = await setup();
  await call('update_contact', { id: 'p1', firstName: 'Ana María', email: 'ana@example.test', phone: '81 1234 5678' });
  assert.deepEqual(sent('updatePerson').data, {
    name: { firstName: 'Ana María', lastName: 'Ruiz' },
    emails: { primaryEmail: 'ana@example.test' },
    phones: { primaryPhoneNumber: '81 1234 5678', primaryPhoneCountryCode: 'MX' },
  });
});

test('un teléfono con + se manda completo', async () => {
  const { call, sent } = await setup();
  await call('create_contact', { firstName: 'Ana', lastName: 'Ruiz', phone: '+1 415 555 0100' });
  assert.deepEqual(sent('createPerson').data.phones, { primaryPhoneNumber: '+1 415 555 0100' });
});

test('update_company solo manda campos que existen en Twenty 2.x', async () => {
  const { call, sent } = await setup();
  await call('update_company', { id: 'c1', annualRevenue: 1.5, accountOwnerId: 'wm1' });
  assert.deepEqual(sent('updateCompany').data, {
    annualRevenue: { amountMicros: 1500000, currencyCode: 'MXN' },
    accountOwnerId: 'wm1',
  });
});
