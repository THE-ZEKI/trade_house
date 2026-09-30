/**
 * Constantes partagees — compatibles avec le runtime EDGE.
 *
 * Regle du projet : le middleware tourne sur l'Edge, ou le runtime Node
 * (node:crypto, pg) n'existe pas. Tout ce qu'il importe doit rester ici,
 * sans import Node. Les fonctions de jeton vivent dans session.ts.
 */

export const SESSION_COOKIE = 'th_session';

export const sessionCookieOptions = (expiresAt: Date) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  expires: expiresAt,
});
