import { createHash, randomBytes } from 'node:crypto';
import { SESSION_COOKIE, sessionCookieOptions } from './constants';

export { SESSION_COOKIE, sessionCookieOptions };

/**
 * Jeton de session — runtime NODE uniquement (utilise node:crypto).
 * Ne pas importer depuis le middleware, qui tourne sur l'Edge.
 *
 * On ne stocke JAMAIS le jeton en base : public.user_sessions.token_hash ne
 * contient que son empreinte SHA-256, calculee par app.hash_token() cote SQL.
 * Si la base fuite, aucune session n'est reutilisable.
 */

/** Jeton aleatoire de 256 bits, en hexadecimal. */
export function newSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Empreinte du jeton — doit etre identique a app.hash_token() (sha256 hex).
 * Si les deux divergent, aucune session ne sera jamais retrouvee.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function sessionTtlHours(): number {
  const raw = Number.parseInt(process.env.SESSION_TTL_HOURS ?? '12', 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 24 * 30) : 12;
}

