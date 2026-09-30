import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Jeton de salle (C4).
 *
 * La base decide (app.room_claims) si l'appelant a le droit d'entrer et
 * renvoie ce qu'il a le droit de faire. Ici on ne fait que signer ces
 * revendications : le secret reste cote serveur, et le fournisseur de visio
 * n'en recoit qu'une projection au moment d'entrer.
 *
 * Sans etat : la revocation individuelle n'est pas possible, ce qui est
 * assume — la duree de vie courte (30 min par defaut) rend le fenetre
 * d'exposition negligeable, et evite une table de plus.
 */

export type RoomClaims = {
  /** version du format */
  v: 1;
  /** identifiant de la reunion */
  m: string;
  /** identifiant de l'utilisateur */
  u: string;
  /** 'moderator' si admin/manager/organisateur, sinon 'participant' (RG-25) */
  r: 'moderator' | 'participant';
  /** expiration, epoch en secondes */
  e: number;
};

function secret(): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error('APP_ENCRYPTION_KEY doit contenir au moins 32 caracteres');
  }
  return key;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

/** token = base64url(payload) . base64url(HMAC-SHA256(payload)) */
export function signRoomToken(claims: RoomClaims): string {
  const payload = b64url(Buffer.from(JSON.stringify(claims), 'utf8'));
  const mac = createHmac('sha256', secret()).update(payload).digest();
  return `${payload}.${b64url(mac)}`;
}

export function verifyRoomToken(token: string): RoomClaims | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payload, mac] = parts;
  // la signature se compare OCTET PAR OCTET : il faut decoder le base64url
  // avant, sinon on compare du texte a des octets et rien ne correspond jamais.
  const provided = Buffer.from(mac, 'base64url');
  const expected = createHmac('sha256', secret()).update(payload).digest();
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  let claims: RoomClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as RoomClaims;
  } catch {
    return null;
  }
  if (claims.v !== 1 || typeof claims.e !== 'number') return null;
  if (claims.e * 1000 < Date.now()) return null;
  return claims;
}
