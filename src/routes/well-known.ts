import { IncomingMessage, ServerResponse } from 'node:http';

/**
 * OAuth discovery metadata for MCP clients.
 *
 * Twenty CRM is itself a full OAuth 2.0 authorization server (authorization
 * code + PKCE, real dynamic client registration per RFC 7591). There is no
 * third-party identity provider here: users log in with their own Twenty
 * account and grant this MCP server access to THEIR data, so every action
 * an agent takes is attributed to (and limited by the permissions of) the
 * actual Twenty user who authorized it - not a shared service account.
 */
export class WellKnownRoutes {
  private authServerUrl: string;
  private serverUrl: string;

  constructor() {
    // The PUBLIC url of the Twenty instance (what a user's browser and MCP
    // client can reach), e.g. https://crm.setec.one. This can differ from
    // TWENTY_BASE_URL, which the server uses for its own internal API calls
    // (e.g. http://server:3000 over a private docker network).
    this.authServerUrl = process.env.TWENTY_PUBLIC_URL || process.env.TWENTY_BASE_URL || '';
    this.serverUrl = process.env.MCP_SERVER_URL || 'http://localhost:3000';
  }

  async handleProtectedResource(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // RFC 9728 - OAuth 2.0 Protected Resource Metadata
    const metadata = {
      resource: this.serverUrl,
      authorization_servers: [this.authServerUrl],
      bearer_methods_supported: ['header'],
      resource_documentation: 'https://github.com/jezweb/twenty-mcp',
      // Twenty's own OAuth scopes (see https://docs.twenty.com/developers/extend/oauth):
      // `api` = full read/write access, `profile` = read the user's profile.
      scopes_supported: ['api', 'profile'],
    };

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      // Deliberately not cached: while we're iterating on OAuth config,
      // a long max-age here means clients (and any proxy in between) can
      // keep serving a stale copy for a long time even after the server
      // is fixed, making changes look like they "didn't take effect".
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(metadata, null, 2));
  }

  async handleAuthorizationServer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // RFC 8414 - OAuth 2.0 Authorization Server Metadata.
    //
    // Some MCP clients only ever query the RESOURCE server's own
    // `/.well-known/oauth-authorization-server` (they don't follow the
    // `authorization_servers` entry from the protected-resource metadata out
    // to the authorization server's own domain). To be compatible with
    // those clients, we mirror it here by proxying Twenty's real metadata
    // live, rather than hand-copying values that could drift out of sync.
    try {
      const response = await fetch(`${this.authServerUrl}/.well-known/oauth-authorization-server`);
      const metadata = await response.json();

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(metadata, null, 2));
    } catch (error) {
      console.error('Failed to fetch Twenty OAuth authorization server metadata:', error);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'bad_gateway',
        error_description: 'Could not reach Twenty\'s OAuth authorization server metadata',
      }));
    }
  }

  async handleOptions(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
  }
}
