import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { spawn, ChildProcess } from 'node:child_process';
import { AddressInfo } from 'node:net';

// Levanta src/http-server.ts real contra un "Twenty" falso que registra el
// bearer token que recibe en cada llamada GraphQL.

function jwt(claims: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(claims)}.firma`;
}
const inOneHour = () => Math.floor(Date.now() / 1000) + 3600;

let fakeTwenty: Server;
let mcp: ChildProcess;
let mcpUrl: string;
const seenTokens: string[] = [];

before(async () => {
  fakeTwenty = createServer((req, res) => {
    seenTokens.push(String(req.headers.authorization));
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (String(req.headers.authorization).includes('rechazado')) {
        res.end(JSON.stringify({
          data: null,
          errors: [{ message: 'Token has expired.', extensions: { code: 'UNAUTHENTICATED' } }],
        }));
        return;
      }
      res.end(JSON.stringify({ data: { people: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } } }));
    });
  });
  await new Promise<void>(r => fakeTwenty.listen(0, r));
  const twentyPort = (fakeTwenty.address() as AddressInfo).port;

  const mcpPort = 40000 + Math.floor(Math.random() * 20000);
  mcpUrl = `http://127.0.0.1:${mcpPort}`;
  mcp = spawn(process.execPath, ['--import', 'tsx', 'src/http-server.ts'], {
    env: {
      ...process.env,
      PORT: String(mcpPort),
      AUTH_ENABLED: 'true',
      TWENTY_BASE_URL: `http://127.0.0.1:${twentyPort}`,
      MCP_SERVER_URL: 'https://mcp.example.test',
      TWENTY_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 15000);
    mcp.stdout!.on('data', d => { if (String(d).includes('running at')) { clearTimeout(timer); resolve(); } });
    mcp.on('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}`)); });
  });
});

after(() => {
  mcp?.kill();
  fakeTwenty?.close();
});

async function rpc(path: string, token: string | null, body: unknown, sessionId?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const res = await fetch(`${mcpUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  const dataLine = text.split('\n').find(l => l.startsWith('data:'));
  const json = dataLine ? JSON.parse(dataLine.slice(5)) : (text ? JSON.parse(text) : null);
  return { res, json };
}

async function openSession(path: string, token: string) {
  const { res } = await rpc(path, token, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  });
  assert.equal(res.status, 200);
  const sessionId = res.headers.get('mcp-session-id')!;
  assert.ok(sessionId);
  await rpc(path, token, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);
  return sessionId;
}

const searchCall = (id: number) => ({
  jsonrpc: '2.0', id, method: 'tools/call',
  params: { name: 'search_contacts', arguments: { query: 'x' } },
});

test('la sesión usa el token renovado del mismo usuario', async () => {
  const tokenA = jwt({ sub: 'user-1', workspaceId: 'ws', exp: inOneHour() });
  const tokenA2 = jwt({ sub: 'user-1', workspaceId: 'ws', exp: inOneHour() + 1 });
  const sessionId = await openSession('/mcp', tokenA);

  seenTokens.length = 0;
  await rpc('/mcp', tokenA, searchCall(2), sessionId);
  const r = await rpc('/mcp', tokenA2, searchCall(3), sessionId);

  assert.equal(r.res.status, 200);
  assert.deepEqual(seenTokens, [`Bearer ${tokenA}`, `Bearer ${tokenA2}`]);
});

test('un token expirado recibe 401 invalid_token (para que el cliente renueve)', async () => {
  const sessionId = await openSession('/mcp', jwt({ sub: 'user-1', workspaceId: 'ws', exp: inOneHour() }));
  const expired = jwt({ sub: 'user-1', workspaceId: 'ws', exp: Math.floor(Date.now() / 1000) - 10 });

  seenTokens.length = 0;
  const { res } = await rpc('/mcp', expired, searchCall(2), sessionId);

  assert.equal(res.status, 401);
  const challenge = res.headers.get('www-authenticate') ?? '';
  assert.match(challenge, /error="invalid_token"/);
  assert.match(challenge, /oauth-protected-resource\/mcp"/);
  assert.equal(seenTokens.length, 0, 'no debe llegar a Twenty');
});

test('si Twenty rechaza un token opaco, la siguiente petición recibe 401', async () => {
  const opaque = 'token-opaco-rechazado';
  const sessionId = await openSession('/mcp', opaque);

  const first = await rpc('/mcp', opaque, searchCall(2), sessionId);
  assert.equal(first.res.status, 200);
  assert.match(JSON.stringify(first.json), /Token has expired/);

  const second = await rpc('/mcp', opaque, searchCall(3), sessionId);
  assert.equal(second.res.status, 401);
  assert.match(second.res.headers.get('www-authenticate') ?? '', /invalid_token/);
});

test('el token de otro usuario no puede reutilizar la sesión', async () => {
  const sessionId = await openSession('/mcp', jwt({ sub: 'user-1', workspaceId: 'ws', exp: inOneHour() }));
  seenTokens.length = 0;
  const { res } = await rpc('/mcp', jwt({ sub: 'user-2', workspaceId: 'ws', exp: inOneHour() }), searchCall(2), sessionId);
  assert.equal(res.status, 404);
  assert.equal(seenTokens.length, 0);
});

test('la raíz responde igual que /mcp', async () => {
  const anon = await fetch(`${mcpUrl}/`, { method: 'POST', body: '{}' });
  assert.equal(anon.status, 401);

  const sessionId = await openSession('/', jwt({ sub: 'user-1', workspaceId: 'ws', exp: inOneHour() }));
  assert.ok(sessionId);
});

test('metadatos RFC 9728 para raíz y /mcp', async () => {
  const root = await (await fetch(`${mcpUrl}/.well-known/oauth-protected-resource`)).json();
  const mcpPath = await (await fetch(`${mcpUrl}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.equal(root.resource, 'https://mcp.example.test');
  assert.equal(mcpPath.resource, 'https://mcp.example.test/mcp');
});
