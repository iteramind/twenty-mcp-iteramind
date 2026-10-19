import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerDeleteTools } from '../../src/tools/index.js';
import { fakeClient, connection } from './helpers.js';

async function setup() {
  const { client: twenty, calls } = fakeClient(call => call.query.includes('deleteTask')
    ? { deleteTask: { id: 't1' } }
    : { tasks: connection([{ id: 't1', title: 'TEST-MCP tarea' }]) });
  const server = new McpServer({ name: 'test', version: '1' });
  registerDeleteTools(server, twenty);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  const call = async (args: Record<string, unknown>) => {
    const r = await mcp.callTool({ name: 'delete_record', arguments: args });
    return { text: (r.content as { text: string }[])[0].text, isError: !!r.isError };
  };
  return { mcp, call, deletes: () => calls.filter(c => c.query.includes('deleteTask')).length };
}

test('delete_record está marcada como destructiva', async () => {
  const { mcp } = await setup();
  const { tools } = await mcp.listTools();
  assert.equal(tools.find(t => t.name === 'delete_record')?.annotations?.destructiveHint, true);
});

test('delete_record exige la vista previa y un token de un solo uso', async () => {
  const { call, deletes } = await setup();

  const guessed = await call({ objectType: 'task', id: 't1', confirmationToken: 'adivina' });
  assert.equal(guessed.isError, true);
  assert.equal(deletes(), 0);

  const preview = await call({ objectType: 'task', id: 't1' });
  assert.match(preview.text, /TEST-MCP tarea/);
  assert.equal(deletes(), 0);
  const token = preview.text.match(/confirmationToken: "([^"]+)"/)![1];

  const wrongRecord = await call({ objectType: 'task', id: 'otro', confirmationToken: token });
  assert.equal(wrongRecord.isError, true);

  const ok = await call({ objectType: 'task', id: 't1', confirmationToken: token });
  assert.equal(ok.isError, false);
  assert.equal(deletes(), 1);

  const reused = await call({ objectType: 'task', id: 't1', confirmationToken: token });
  assert.equal(reused.isError, true);
  assert.equal(deletes(), 1);
});
