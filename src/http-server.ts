#!/usr/bin/env node

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { TwentyClient } from './client/twenty-client.js';
import { registerPersonTools, registerCompanyTools, registerTaskTools, registerOpportunityTools } from './tools/index.js';
import { WellKnownRoutes } from './routes/well-known.js';
import { IPMiddleware } from './auth/ip-middleware.js';

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

  function sendUnauthorized(res: import('node:http').ServerResponse, message: string): void {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      // Points MCP clients at our protected-resource metadata so they know
      // to start Twenty's OAuth flow (RFC 9728 style challenge).
      'WWW-Authenticate': `Bearer resource_metadata="${mcpServerUrl}/.well-known/oauth-protected-resource"`,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    });
    res.end(JSON.stringify({ error: 'unauthorized', error_description: message }));
  }

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

    // Handle OAuth discovery endpoint (points clients at Twenty's own
    // authorization server - see routes/well-known.ts)
    if (req.url === '/.well-known/oauth-protected-resource') {
      if (!authEnabled) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      await wellKnownRoutes.handleProtectedResource(req, res);
      return;
    }

    // Only handle /mcp endpoint
    if (!req.url?.startsWith('/mcp')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    try {
      // Extract the caller's bearer token (their Twenty OAuth access token).
      // We don't verify it ourselves - Twenty's own API is the enforcement
      // point and will reject invalid/expired tokens on the actual GraphQL
      // call, so there's no separate identity layer to keep in sync.
      const authHeader = req.headers.authorization;
      let bearerToken: string | undefined;

      if (authHeader) {
        if (!authHeader.startsWith('Bearer ')) {
          sendUnauthorized(res, 'Invalid Authorization header format');
          return;
        }
        bearerToken = authHeader.substring(7);
      } else if (requireAuth) {
        sendUnauthorized(res, 'Missing Authorization header - please log in with your Twenty account');
        return;
      }

      const config = parseConfig(req.url, bearerToken);

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

      // Create MCP server with Twenty client
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

      const client = new TwentyClient({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });

      // Register tools
      registerPersonTools(server, client);
      registerCompanyTools(server, client);
      registerTaskTools(server, client);
      registerOpportunityTools(server, client);

      // Create streamable HTTP transport
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      // Connect server to transport
      await server.connect(transport);

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
