#!/usr/bin/env node

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { TwentyClient } from './client/twenty-client.js';
import { registerPersonTools, registerCompanyTools, registerTaskTools, registerOpportunityTools, registerDeleteTools, registerMetadataTools } from './tools/index.js';
import { WellKnownRoutes } from './routes/well-known.js';
import { IPMiddleware } from './auth/ip-middleware.js';
import { decodeBearerClaims, isExpired, tokenOwner } from './auth/bearer.js';

interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  client: TwentyClient;
  // Token con el que se llama a Twenty y usuario dueño de la sesión.
  token: string;
  owner: string | null;
  // Token que Twenty ya rechazó (opaco o vencido a media llamada).
  rejectedToken?: string;
  lastSeen: number;
}

// Sesiones sin actividad por más de este tiempo se cierran; el cliente MCP
// recibe 404 y abre una nueva de forma transparente.
const SESSION_IDLE_MS = 6 * 60 * 60 * 1000;

async function main() {
  const port = parseInt(process.env.PORT || '3000');
  // AUTH_ENABLED here means "require each caller to log in with their own
  // Twenty account via OAuth" - there is no separate identity provider or
  // per-user key storage. The bearer token a client sends after completing
  // Twenty's own OAuth flow IS the credential used to call Twenty's API, so
  // every action is scoped to that user's own Twenty permissions.
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  const requireAuth = authEnabled && process.env.REQUIRE_AUTH !== 'false';
  const wellKnownRoutes = new WellKnownRoutes();
  const ipMiddleware = new IPMiddleware();
  const mcpServerUrl = process.env.MCP_SERVER_URL || `http://localhost:${port}`;

  // The MCP Streamable HTTP transport is stateful: the `initialize` call
  // creates a session (an id returned in the `Mcp-Session-Id` header), and
  // every later call in that same session (tools/list, tools/call, ...)
  // must be routed to that SAME transport/server instance for the session
  // to be recognized - a fresh transport has no memory of a prior session
  // id and will reject the request. We keep a small in-memory map from
  // session id to its {server, transport} pair so follow-up requests reuse
  // the right instance instead of always starting a brand new session.
  const sessions = new Map<string, McpSession>();

  // Parse configuration from multiple sources
  function parseConfig(url: string, bearerToken?: string) {
    const urlObj = new URL(url, `http://localhost:${port}`);
    const params = urlObj.searchParams;

    // Priority: the caller's own OAuth bearer token (their Twenty identity)
    // > explicit query params > environment variables (shared fallback key).
    return {
      apiKey: bearerToken ||
              params.get('apiKey') ||
              process.env.TWENTY_API_KEY ||
              process.env.SMITHERY_CONFIG_APIKEY ||
              process.env.apiKey,
      baseUrl: params.get('baseUrl') ||
               process.env.TWENTY_BASE_URL ||
               process.env.SMITHERY_CONFIG_BASEURL ||
               process.env.baseUrl ||
               'https://api.twenty.com',
    };
  }

  function sendUnauthorized(
    res: import('node:http').ServerResponse,
    message: string,
    resourcePath: string,
    error?: 'invalid_token',
  ): void {
    // `error="invalid_token"` le indica al cliente que su token ya no sirve y
    // que debe renovarlo con su refresh token (RFC 6750 §3.1).
    const errorParam = error ? `error="${error}", error_description="${message}", ` : '';
    res.writeHead(401, {
      'Content-Type': 'application/json',
      // Points MCP clients at our protected-resource metadata so they know
      // to start Twenty's OAuth flow (RFC 9728 style challenge).
      'WWW-Authenticate': `Bearer ${errorParam}resource_metadata="${mcpServerUrl}/.well-known/oauth-protected-resource${resourcePath}"`,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    });
    res.end(JSON.stringify({ error: error ?? 'unauthorized', error_description: message }));
  }

  function createSession(apiKey: string, baseUrl: string, owner: string | null): McpSession {
    const server = new McpServer({
      name: 'twenty-mcp-server',
      version: '1.0.0',
    }, {
      capabilities: {
        tools: {},
        experimental: {
          authentication: {
            type: 'oauth2',
            required: requireAuth,
            enabled: authEnabled,
            discoveryEndpoints: authEnabled ? {
              protectedResource: '/.well-known/oauth-protected-resource',
            } : undefined
          }
        }
      }
    });

    const client = new TwentyClient({ apiKey, baseUrl });

    registerPersonTools(server, client);
    registerCompanyTools(server, client);
    registerTaskTools(server, client);
    registerOpportunityTools(server, client);
    registerDeleteTools(server, client);
    registerMetadataTools(server, client);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, session);
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(sessionId);
      },
    });

    const session: McpSession = { server, transport, client, token: apiKey, owner, lastSeen: Date.now() };
    client.onAuthError = () => { session.rejectedToken = session.token; };
    return session;
  }

  setInterval(() => {
    const cutoff = Date.now() - SESSION_IDLE_MS;
    for (const [id, session] of sessions) {
      if (session.lastSeen < cutoff) {
        sessions.delete(id);
        session.transport.close().catch(() => {});
      }
    }
  }, 10 * 60 * 1000).unref();

  // Create HTTP server
  const httpServer = createServer(async (req, res) => {
    // Check IP allowlist first (before any other processing)
    if (!await ipMiddleware.checkAccess(req, res)) {
      return; // IP middleware already sent response
    }

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      await wellKnownRoutes.handleOptions(req, res);
      return;
    }

    // Handle health check endpoint
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        service: 'twenty-mcp-server',
        authEnabled,
        ipProtection: ipMiddleware.getConfig().enabled
      }));
      return;
    }

    // Handle OAuth discovery endpoints (points clients at Twenty's own
    // authorization server - see routes/well-known.ts)
    const path = new URL(req.url || '/', `http://localhost:${port}`).pathname;

    // RFC 9728: el cliente que se conecta a /mcp busca primero
    // /.well-known/oauth-protected-resource/mcp; el que se conecta a la raíz,
    // /.well-known/oauth-protected-resource. Servimos ambos.
    if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') {
      if (!authEnabled) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      await wellKnownRoutes.handleProtectedResource(req, res, path.endsWith('/mcp') ? '/mcp' : '');
      return;
    }

    if (path === '/.well-known/oauth-authorization-server' || path === '/.well-known/oauth-authorization-server/mcp') {
      if (!authEnabled) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      await wellKnownRoutes.handleAuthorizationServer(req, res);
      return;
    }

    // El endpoint MCP es /mcp; la raíz responde igual para que
    // https://mcp.setec.one y https://mcp.setec.one/mcp sean equivalentes.
    if (path !== '/mcp' && path !== '/') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    try {
      // Extract the caller's bearer token (their Twenty OAuth access token).
      // We don't verify it ourselves - Twenty's own API is the enforcement
      // point and will reject invalid/expired tokens on the actual GraphQL
      // call, so there's no separate identity layer to keep in sync.
      const resourcePath = path === '/mcp' ? '/mcp' : '';
      const authHeader = req.headers.authorization;
      let bearerToken: string | undefined;

      if (authHeader) {
        if (!authHeader.startsWith('Bearer ')) {
          sendUnauthorized(res, 'Invalid Authorization header format', resourcePath);
          return;
        }
        bearerToken = authHeader.substring(7);
      } else if (requireAuth) {
        sendUnauthorized(res, 'Missing Authorization header - please log in with your Twenty account', resourcePath);
        return;
      }

      const claims = bearerToken ? decodeBearerClaims(bearerToken) : null;
      if (authEnabled && bearerToken && isExpired(claims)) {
        sendUnauthorized(res, 'Access token expired', resourcePath, 'invalid_token');
        return;
      }
      const owner = tokenOwner(claims);

      // Reuse the session's existing server/transport if the client sent
      // back a known Mcp-Session-Id (e.g. a tools/list or tools/call
      // following an earlier initialize) - otherwise this must be a fresh
      // `initialize` call, so build a new session for it.
      const incomingSessionId = req.headers['mcp-session-id'];
      const sessionIdHeader = Array.isArray(incomingSessionId) ? incomingSessionId[0] : incomingSessionId;
      let session = sessionIdHeader ? sessions.get(sessionIdHeader) : undefined;

      // Sesión que ya no existe (reinicio del servidor o cerrada por inactividad).
      // El protocolo MCP pide 404 para que el cliente abra una nueva solo; con
      // cualquier otro código el conector se queda atorado hasta reconectar a mano.
      if (sessionIdHeader && !session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Session not found' },
          id: null,
        }));
        return;
      }

      if (session && bearerToken && bearerToken === session.rejectedToken) {
        sendUnauthorized(res, 'Access token rejected by Twenty', resourcePath, 'invalid_token');
        return;
      }

      if (session && bearerToken && bearerToken !== session.token) {
        // El cliente renovó su token. Antes la sesión seguía usando el token
        // con el que se abrió y Twenty respondía "Token has expired".
        if (owner && owner === session.owner) {
          session.client.setApiKey(bearerToken);
          session.token = bearerToken;
        } else {
          // Otro usuario, o no podemos saberlo: no reutilizamos la sesión.
          // 404 obliga al cliente a abrir una nueva con su propio token.
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Session not found' },
            id: null,
          }));
          return;
        }
      }

      if (!session) {
        const config = parseConfig(req.url || '/', bearerToken);

        if (!config.apiKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Missing credentials',
            error_description: authEnabled
              ? 'Please log in with your Twenty account'
              : 'Missing required apiKey parameter'
          }));
          return;
        }

        session = createSession(config.apiKey, config.baseUrl, owner);
        await session.server.connect(session.transport);
      }

      session.lastSeen = Date.now();
      const { transport } = session;

      // Parse request body for POST requests
      let body: any = undefined;
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const bodyText = Buffer.concat(chunks).toString();
            if (bodyText.trim()) {
              body = JSON.parse(bodyText);
            }
            await transport.handleRequest(req, res, body);
          } catch (error) {
            console.error('Error parsing request body:', error);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON in request body' }));
          }
        });
      } else {
        // Handle GET/DELETE requests
        await transport.handleRequest(req, res, body);
      }
    } catch (error) {
      console.error('Error handling request:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  });

  httpServer.listen(port, () => {
    console.log(`Twenty MCP Server running at http://localhost:${port}/mcp`);
    console.log(`Health check available at http://localhost:${port}/health`);

    // Log configuration source for debugging
    if (authEnabled) {
      console.log('OAuth enabled - each caller logs in with their own Twenty account');
    } else if (process.env.SMITHERY_CONFIG_APIKEY) {
      console.log('Running in Smithery environment');
    } else if (process.env.TWENTY_API_KEY) {
      console.log('Using environment variables for configuration');
    } else {
      console.log(`Example: http://localhost:${port}/mcp?apiKey=YOUR_API_KEY&baseUrl=https://api.twenty.com`);
    }
  });
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
