import { createClerkClient } from '@clerk/clerk-sdk-node';
import type { ClerkClient as ClerkSDKClient } from '@clerk/clerk-sdk-node';
import { verifyToken } from '@clerk/backend';

export interface TokenValidationResult {
  valid: boolean;
  userId?: string;
  sessionId?: string;
  scopes?: string[];
  error?: string;
}

export interface UserMetadata {
  twentyApiKey?: string;
  twentyBaseUrl?: string;
  twentyApiKeyUpdatedAt?: string;
}

export class ClerkClient {
  private clerk: ClerkSDKClient;
  private enabled: boolean;
  private secretKey: string | undefined;

  constructor() {
    this.enabled = process.env.AUTH_ENABLED === 'true';
    this.secretKey = process.env.CLERK_SECRET_KEY;

    if (this.enabled) {
      const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;

      if (!this.secretKey) {
        throw new Error('CLERK_SECRET_KEY is required when AUTH_ENABLED=true');
      }

      this.clerk = createClerkClient({
        secretKey: this.secretKey,
        publishableKey,
      });
    } else {
      // Create a dummy client for when auth is disabled
      this.clerk = null as any;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async validateToken(token: string): Promise<TokenValidationResult> {
    if (!this.enabled) {
      return { valid: false, error: 'Authentication is not enabled' };
    }

    try {
      // Remove 'Bearer ' prefix if present
      const cleanToken = token.replace(/^Bearer\s+/i, '');

      // Verify the JWT signature/expiry against Clerk's JWKS. This works for
      // BOTH regular Clerk session tokens (which include a `sid` claim) AND
      // OAuth 2.1 access tokens issued via Clerk's OAuth provider/MCP flow
      // (which don't have a `sid`, but always carry a `sub` claim = user ID).
      //
      // NOTE: previously this code assumed every bearer token was a Clerk
      // *session* token and looked up `payload.sid` via `sessions.getSession()`.
      // That path always fails for genuine OAuth access tokens (no `sid`),
      // which broke every MCP client OAuth login regardless of Client ID /
      // redirect_uri configuration.
      const payload = await verifyToken(cleanToken, {
        secretKey: this.secretKey,
      });

      if (!payload.sub) {
        return { valid: false, error: 'No subject (user id) claim in token' };
      }

      const scopeClaim = (payload as Record<string, unknown>).scope;
      const scopes = typeof scopeClaim === 'string' ? scopeClaim.split(' ') : undefined;

      return {
        valid: true,
        userId: payload.sub,
        sessionId: typeof (payload as Record<string, unknown>).sid === 'string'
          ? ((payload as Record<string, unknown>).sid as string)
          : undefined,
        scopes,
      };
    } catch (error) {
      console.error('Token validation error:', error);
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Token validation failed',
      };
    }
  }
  
  async getUserMetadata(userId: string): Promise<UserMetadata | null> {
    if (!this.enabled) {
      return null;
    }
    
    try {
      const user = await this.clerk.users.getUser(userId);
      return user.privateMetadata as UserMetadata || {};
    } catch (error) {
      console.error('Failed to get user metadata:', error);
      return null;
    }
  }
  
  async updateUserMetadata(userId: string, metadata: UserMetadata): Promise<void> {
    if (!this.enabled) {
      throw new Error('Authentication is not enabled');
    }
    
    try {
      await this.clerk.users.updateUser(userId, {
        privateMetadata: metadata as any,
      });
    } catch (error) {
      console.error('Failed to update user metadata:', error);
      throw new Error('Failed to update user configuration');
    }
  }
  
  getClerkDomain(): string {
    return process.env.CLERK_DOMAIN || '';
  }
  
  getPublishableKey(): string {
    return process.env.CLERK_PUBLISHABLE_KEY || '';
  }
}