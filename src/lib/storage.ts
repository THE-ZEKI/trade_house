import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { AppError } from './errors';

/**
 * Stockage prive des fichiers (RG-32, RG-33).
 *
 * Les pieces jointes ne sont JAMAIS servies par un lien public : un fichier
 * n'est accessible que par une route /api/.../files/:id, qui verifie que
 * l'utilisateur courant a le droit de voir le rapport, ou qui accepte un jeton
 * signe a duree de vie courte (utile dans un email ou un partage ponctuel).
 *
 * ---------------------------------------------------------------------------
 * DEUX SUPPORTS, UN SEUL CONTRAT (038).
 *
 * Le code appelant n'a jamais change : putFile, getFile, deleteFile. Ce qui
 * change, c'est ce qu'elles font reellement.
 *
 * local -> dossier .storage/ sur le disque
 * blob  -> Vercel Blob (durable)
 *
 * LE CHOIX EST AUTOMATIQUE, et c'est volontaire : en developpement on travaille
 * sans token, en production on ne doit pas avoir a oublier de le poser. Un
 * module qui se trompe de stockage perdrait des fichiers sans aucun signe
 * visible — un fichier affiche a l'upload, puis disparu a la lecture suivante.
 * Ici la seule variable qui compte est BLOB_READ_WRITE_TOKEN : presente, on
 * utilise Blob ; absente, on retombe sur le disque local.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI LE STOCKAGE LOCAL NE MARCHAIT PAS SUR VERCEL.
 *
 *     ENOENT: no such file or directory, mkdir '/var/task/.storage'
 *
 * process.cwd() vaut /var/task sur Vercel, et ce repertoire est en LECTURE
 * SEULE : le systeme de fichiers d'une fonction est ephemere et verrouille.
 * L'echec ne dependait d'aucune donnee — toute ecriture y echouait, donc
 * l'upload de support de cours ne pouvait pas fonctionner en ligne, jamais.
 *
 * Ce n'etait pas un bug mais une limite d'architecture heritee du developpement
 * local, et elle etait documentee sans avoir ete traitee.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI LE STOCKAGE EST CHOISI PAR UNE VARIABLE D'ENVIRONNEMENT.
 *
 * app_settings.storage_provider existe deja en base (004) et prevoit s3 et
 * supabase. Il n'est volontairement pas lu ici.
 *
 * Une base est un mauvais endroit pour decider OU ecrire un fichier : c'est un
 * choix d'infrastructure, pas une donnee metier, et il doit etre fige au
 * deploiement. Le lire a chaque appel ouvrirait en plus un probleme de
 * coherence — deux instances avec deux valeurs differentes, et un fichier
 * ecrit par l'une, invisible par l'autre. La variable d'environnement ne peut
 * pas diverger : elle est posee une fois.
 *
 * Les colonnes de la base restent alimentees comme avant. Seul l'octet change
 * de support, et rien d'autre dans l'application n'a besoin d'etre modifie.
 */

/**
 * Vercel Blob est-il configure ?
 *
 * On teste la presence du token, pas VERCEL_ENV : en developpement on peut
 * vouloir tester Blob, et hors ligne le build Vercel ne doit pas echouer a
 * l'import. Un appel reseau au build serait, lui, une panne au pire moment.
 */
const HAS_BLOB = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

/**
 * Racine disque, utilisee seulement si BLOB_READ_WRITE_TOKEN est absent.
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

/**
 * Ecrit un fichier.
 *
 * Les DEUX branches reutilisent le meme nom aleatoire : le format
 * `utilisateur/AAAA-MM-JJ/<hex>.<ext>` ne depend pas du support. C'est ce qui
 * permet de basculer un jour de local vers Blob sans toucher une seule ligne de
 * base : storage_path reste identique, seule la maniere de le resoudre change.
 */
export async function putFile(userId: string, mime: string, content: Buffer): Promise<string> {
  const relative = storageName(userId, mime);

  if (HAS_BLOB) {
    // addRandomSuffix: false — le nom est deja aleatoire (randomBytes(16)), et
    // laisser le SDK en ajouter un premier produirait des chemins differents
    // d'un build a l'autre, donc des fichiers invisibles en base.
    //
    // access: 'private' est ce qui remplace la protection du dossier .storage.
    // Sans lui, le Blob serait lisible par quiconque connait l'URL ; avec lui,
    // une URL devinee ne donne rien sans passer par nos routes, qui verifient le
    // RLS. C'est l'equivalent du cloisonnement de 033.
    //
    // ('private_verification' existe dans d'autres versions du SDK ; cette
    // version-ci n'accepte que 'public' | 'private'.)
    const { put } = await import('@vercel/blob');
    await put(relative, content, {
      access: 'private',
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return relative;
  }

  const full = absolutePath(relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
  return relative;
}

export async function getFile(relative: string): Promise<Buffer> {
  if (HAS_BLOB) {
    // Une seule appel, pas deux. head() puis get() marche aussi, mais cela fait
    // deux allers-retours reseau pour lire un fichier dont on veut de toute
    // facon les octets ; get() renvoie deja le flux ET l'etat de la reponse.
    //
    // On ne manipule jamais d'URL signee : le controle d'acces reste entierement
    // dans les routes, qui verifient le RLS avant d'appeler cette fonction.
    // access est OBLIGATOIRE pour get() dans cette version du SDK. Il ne sert qu'a
    // signer la lecture : le store est deja prive (cf. put), le nom du blob est
    // donc le seul discriminant.
    const { get } = await import('@vercel/blob');
    const result = await get(relative, {
      access: 'private',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    // null : le chemin n'existe pas. 304 : existe mais non modifie — impossible
    // ici puisqu'on n'envoie aucun If-None-Match, mais on le traite comme un
    // echec plutot que de renvoyer un Buffer vide a l'appelant.
    if (!result || result.statusCode !== 200) {
      throw new AppError('NOT_FOUND', 'Fichier introuvable', { status: 404 });
    }

    // On reconvertit le flux en Buffer : tous les appelants — les deux
    // generateurs de PDF comme les routes de telechargement — attendent un
    // Buffer, parce que readFile leur en renvoyait un. Changer ce contrat les
    // aurait casses un par un, sans erreur de compilation pour autant.
    const chunks: Uint8Array[] = [];
    const reader = result.stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks);
  }

  const full = absolutePath(relative);
  if (!existsSync(full)) {
    throw new AppError('NOT_FOUND', 'Fichier introuvable', { status: 404 });
  }
  return readFile(full);
}

export async function deleteFile(relative: string): Promise<void> {
  if (HAS_BLOB) {
    // del ne leve pas si le fichier est absent : supprimer ce qui n'existe plus
    // est le résultat attendu quand un utilisateur remplace deux fois de suite
    // la meme piece jointe. On absorbe l'erreur, sinon le deuxieme remplacement
    // echouerait sur un fichier deja supprime.
    const { del } = await import('@vercel/blob');
    await del(relative, { token: process.env.BLOB_READ_WRITE_TOKEN }).catch(() => {});
    return;
  }

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
