/**
 * Lectura (sin verificar firma) de los claims del bearer token de Twenty.
 *
 * Twenty sigue siendo quien valida el token en cada llamada GraphQL; aquí solo
 * leemos `exp` y el sujeto para dos cosas que el servidor MCP sí necesita:
 *
 *  1. Responder HTTP 401 cuando el token ya expiró. Es la señal con la que el
 *     cliente MCP (Claude) usa su refresh token. Si dejamos pasar el token
 *     vencido, Twenty lo rechaza DENTRO de la herramienta, el cliente solo ve
 *     un error de herramienta y nunca renueva.
 *  2. Saber si un token nuevo pertenece al mismo usuario que abrió la sesión,
 *     para reutilizar la sesión con el token renovado sin permitir que otro
 *     usuario la secuestre con su propio token.
 */

export interface BearerClaims {
  sub?: string;
  workspaceId?: string;
  exp?: number;
}

export function decodeBearerClaims(token: string): BearerClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof payload !== 'object' || payload === null) return null;
    return {
      sub: typeof payload.sub === 'string' ? payload.sub : undefined,
      workspaceId: typeof payload.workspaceId === 'string' ? payload.workspaceId : undefined,
      exp: typeof payload.exp === 'number' ? payload.exp : undefined,
    };
  } catch {
    return null;
  }
}

// Margen para no aceptar un token que vencerá a media llamada.
const EXPIRY_SKEW_SECONDS = 60;

export function isExpired(claims: BearerClaims | null, nowMs = Date.now()): boolean {
  if (!claims?.exp) return false; // Token opaco o sin exp: que Twenty decida.
  return claims.exp - EXPIRY_SKEW_SECONDS <= nowMs / 1000;
}

/** Identidad estable del dueño del token, o null si no se puede determinar. */
export function tokenOwner(claims: BearerClaims | null): string | null {
  if (!claims?.sub) return null;
  return `${claims.workspaceId ?? ''}:${claims.sub}`;
}
