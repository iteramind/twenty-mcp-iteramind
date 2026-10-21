/**
 * Prueba de punta a punta del servidor HTTP (lo que usa Claude) contra Twenty real.
 * Levanta src/http-server.ts en local con AUTH_ENABLED=true y se conecta con el
 * cliente MCP oficial por Streamable HTTP, usando la API key como bearer token.
 * Solo lectura.
 *
 *   node --env-file=.env --import tsx scripts/e2e-http.ts
 */
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { TwentyClient } from '../src/client/twenty-client.js';

const apiKey = process.env.TWENTY_API_KEY!;
const port = 41000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ['--import', 'tsx', 'src/http-server.ts'], {
  env: { ...process.env, PORT: String(port), AUTH_ENABLED: 'true', MCP_SERVER_URL: base, TWENTY_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('el servidor no arrancó')), 20000);
  server.stdout!.on('data', d => { if (String(d).includes('running at')) { clearTimeout(timer); resolve(); } });
});

let failed = false;
async function check(name: string, fn: () => Promise<string>) {
  try {
    console.log(`✔ ${name} — ${await fn()}`);
  } catch (error) {
    failed = true;
    console.log(`✖ ${name} — ${(error as Error).message.split('\n')[0].slice(0, 250)}`);
  }
}
function expect(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}
async function connect(path: string, token: string) {
  const client = new Client({ name: 'e2e-http', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}${path}`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  return client;
}
const text = (r: any) => (r.content as { text: string }[])[0]?.text ?? '';

const EXPECTED_TOOLS = [
  'search_opportunities', 'get_opportunity', 'list_opportunities_by_stage', 'get_tasks', 'get_task', 'update_task',
  'create_task', 'create_note', 'get_notes', 'get_note', 'link_activity', 'list_workspace_members', 'delete_record',
  'list_all_objects', 'get_object_schema', 'get_field_metadata', 'search_contacts', 'search_companies',
];

try {
  for (const path of ['/mcp', '/']) {
    await check(`sesión MCP en ${path}: herramientas registradas`, async () => {
      const client = await connect(path, apiKey);
      const { tools } = await client.listTools();
      const names = tools.map(t => t.name);
      const missing = EXPECTED_TOOLS.filter(n => !names.includes(n));
      expect(missing.length === 0, `faltan: ${missing.join(', ')}`);
      await client.close();
      return `${tools.length} herramientas`;
    });
  }

  const client = await connect('/mcp', apiKey);

  await check('search_opportunities "Chromebooks" por HTTP', async () => {
    const t = text(await client.callTool({ name: 'search_opportunities', arguments: { query: 'Chromebooks' } }));
    expect(/Chromebooks .*\[ID: [0-9a-f-]{36}\]/.test(t), t);
    return t.split('\n')[1];
  });

  await check('search_opportunities por etapa con paginación por HTTP', async () => {
    // La etapa con más oportunidades (las etapas se configuran en Twenty y pueden cambiar).
    const grouped = await new TwentyClient({ apiKey, baseUrl: process.env.TWENTY_BASE_URL! }).listOpportunitiesByStage();
    const [stage, list] = Object.entries(grouped).sort((x, y) => y[1].length - x[1].length)[0];
    expect(list.length >= 2, 'ninguna etapa tiene 2+ oportunidades para probar paginación');
    const limit = Math.max(1, Math.floor(list.length / 2));
    const t1 = text(await client.callTool({ name: 'search_opportunities', arguments: { stage, limit } }));
    const cursor = t1.match(/cursor="([^"]+)"/)?.[1];
    expect(cursor, `sin cursor: ${t1}`);
    const t2 = text(await client.callTool({ name: 'search_opportunities', arguments: { stage, limit, cursor } }));
    const ids = (t: string) => [...t.matchAll(/ID: ([0-9a-f-]{36})/g)].map(m => m[1]);
    expect(!ids(t2).some(id => ids(t1).includes(id)), 'páginas repetidas');
    return `etapa ${stage}: ${t1.split('\n')[0]} / página 2: ${ids(t2).length}`;
  });

  await check('get_tasks por HTTP (limit, detalle)', async () => {
    const page = JSON.parse(text(await client.callTool({ name: 'get_tasks', arguments: { limit: 3 } })));
    expect(page.results.length === 3 && 'assignee' in page.results[0] && 'linkedTo' in page.results[0], JSON.stringify(page).slice(0, 200));
    return `3 de ${page.totalCount}, con cursor siguiente: ${page.pageInfo.hasNextPage}`;
  });

  await check('list_all_objects por HTTP', async () => {
    const t = text(await client.callTool({ name: 'list_all_objects', arguments: {} }));
    expect(t.includes('Custom Objects'), t.slice(0, 200));
    return t.match(/\*\*Total Objects\*\*: \d+/)?.[0] ?? '';
  });

  await client.close();

  await check('token expirado recibe 401 invalid_token', async () => {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const expired = `${enc({ alg: 'none' })}.${enc({ sub: 'x', exp: 1 })}.x`;
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${expired}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }),
    });
    expect(res.status === 401 && /invalid_token/.test(res.headers.get('www-authenticate') ?? ''), `status ${res.status}`);
    return res.headers.get('www-authenticate')!.slice(0, 60) + '…';
  });

  await check('metadatos OAuth en raíz y /mcp', async () => {
    const root = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
    const mcp = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
    expect(root.resource === base && mcp.resource === `${base}/mcp`, JSON.stringify([root.resource, mcp.resource]));
    return `${root.authorization_servers[0]}`;
  });
} finally {
  server.kill();
}

console.log(failed ? '\nHubo fallas' : '\nTodo OK');
process.exit(failed ? 1 : 0);
