import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { AppError } from './errors';

/**
 * Stockage prive des fichiers (RG-32, RG-33).
 *
 * Les pieces jointes ne sont JAMAIS servies par un lien public : un fichier
 * n'est accessible que par la route /api/reports/files/:id, qui verifie que
 * l'utilisateur courant a le droit de voir le rapport, ou qui accepte un jeton
 * signe a duree de vie courte (utile dans un email ou un partage ponctuel).
 *
 * app_settings.storage_provider decide du support :
 *   local  -> dossier .storage/ sur le serveur (developpement)
 *   s3 / supabase -> a brancher lors du deploiement
 */

const ROOT = path.join(process.cwd(), '.storage');

/** Types reellement acceptes (RG-32) : le type reel est verifie a l'upload. */
export const ALLOWED_MIME: Record<string, { ext: string; category: 'screenshot' | 'pdf' }> = {
  'image/png': { ext: 'png', category: 'screenshot' },
  'image/jpeg': { ext: 'jpg', category: 'screenshot' },
  'image/webp': { ext: 'webp', category: 'screenshot' },
  'application/pdf': { ext: 'pdf', category: 'pdf' },
};

/** Suffixes autorises a l'upload, en plus du type MIME. */
const EXT_BY_MIME: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
};

/**
 * Verifie la SIGNATURE reelle du fichier : un fichier renomme .png mais
 * contenant du HTML passerait sinon le controle du type MIME.
 */
export function sniffMime(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  return null;
}

/** Genere un nom de stockage aleatoire : le nom d'origine ne fuite pas. */
function storageName(userId: string, mime: string): string {
  const ext = ALLOWED_MIME[mime]?.ext ?? 'bin';
  return `${userId}/${new Date().toISOString().slice(0, 10)}/${randomBytes(16).toString('hex')}.${ext}`;
}

function absolutePath(relative: string): string {
  // empeche toute remontee de chemin (../../etc/passwd)
  const full = path.resolve(ROOT, relative);
  if (!full.startsWith(path.resolve(ROOT) + path.sep)) {
    throw new AppError('VALIDATION', 'Chemin de fichier invalide', { status: 422 });
  }
  return full;
}

export async function putFile(userId: string, mime: string, content: Buffer): Promise<string> {
  const relative = storageName(userId, mime);
  const full = absolutePath(relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
  return relative;
}

export async function getFile(relative: string): Promise<Buffer> {
  const full = absolutePath(relative);
  if (!existsSync(full)) {
    throw new AppError('NOT_FOUND', 'Fichier introuvable', { status: 404 });
  }
  return readFile(full);
}

export async function deleteFile(relative: string): Promise<void> {
  const full = absolutePath(relative);
  if (existsSync(full)) await unlink(full);
}

/** Nom de fichier « propre » pour le telechargement. */
export function downloadName(original: string, mime: string): string {
  const ext = EXT_BY_MIME[mime]?.[0] ?? '';
  const cleaned = path
    .basename(original)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 120);
  return cleaned && cleaned.includes('.') ? cleaned : `fichier${ext}`;
}

// --- Jeton signe a duree de vie courte (RG-33) ----------------------------

function secret(): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) throw new Error('APP_ENCRYPTION_KEY absente');
  return key;
}

/** jeton = <fileId>.<expiration>.<hmac> */
export function signFileToken(fileId: string, ttlSeconds = 900): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${fileId}.${expires}`;
  const mac = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function verifyFileToken(fileId: string, token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [id, expires, mac] = parts;
  if (id !== fileId) return false;
  if (Number.parseInt(expires, 10) * 1000 < Date.now()) return false;
  const expected = createHmac('sha256', secret()).update(`${id}.${expires}`).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
