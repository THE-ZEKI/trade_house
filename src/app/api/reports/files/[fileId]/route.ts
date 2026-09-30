import { query, asUser, queryOneWith } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getFile, downloadName, signFileToken, verifyFileToken } from '@/lib/storage';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ fileId: string }> };

/**
 * GET /api/reports/files/:fileId — telechargement prive (RG-33)
 *
 * Deux formes d'acces :
 *   1. session ouverte  -> l'utilisateur doit avoir le droit de voir le rapport
 *                         (verifie par le RLS via app.can_view_trader) ;
 *   2. jeton signe      -> lien temporaire de 15 min, pour un partage ponctuel
 *                         sans donner de session.
 *
 * Le fichier n'est JAMAIS servi en static : le dossier .storage/ est hors de
 * public/, et le nom de stockage ne correspond a aucun nom lisible.
 */
export async function GET(request: Request, { params }: Params) {
  const { fileId } = await params;
  const token = new URL(request.url).searchParams.get('token');

  try {
    // --- cas 1 : jeton signe, aucun acces base de donnees necessaire -------
    if (token) {
      if (!verifyFileToken(fileId, token)) {
        return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Lien expire ou invalide', rule: 'RG-33' } }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
      // Lecture hors contexte RLS, deliberement : ici le jeton signe EST
      // l'autorisation. Il est produit par le serveur avec APP_ENCRYPTION_KEY
      // et expire en 15 minutes ; seul le serveur peut en emettre un.
      const file = await query<{ storage_path: string; original_name: string; mime_type: string }>(
        `select storage_path, original_name, mime_type from public.report_files where id = $1::uuid`,
        [fileId],
      );
      const found = file[0] ?? null;
      if (!found) return notFound();
      return stream(found.storage_path, found.original_name, found.mime_type);
    }

    // --- cas 2 : session ---------------------------------------------------
    const user = await requireUser();
    const file = await asUser(user.userId, (sql) =>
      queryOneWith(
        sql,
        `select f.storage_path, f.original_name, f.mime_type
           from public.report_files f
          where f.id = $1::uuid`,
        [fileId],
      ),
    );
    if (!file) return notFound();

    // un lien de partage de courte duree, pratique a glisser dans un email
    const shareUrl = `/api/reports/files/${fileId}?token=${signFileToken(fileId)}`;
    return stream(file.storage_path, file.original_name, file.mime_type, shareUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur';
    return new Response(JSON.stringify({ error: { code: 'INTERNAL', message } }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

function notFound() {
  return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Fichier introuvable', rule: 'RG-33' } }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}

async function stream(
  storagePath: string,
  originalName: string,
  mimeType: string,
  shareUrl?: string,
): Promise<Response> {
  const content = await getFile(storagePath);
  return new Response(new Uint8Array(content), {
    headers: {
      'content-type': mimeType,
      'content-length': String(content.length),
      // inline : le fichier s'affiche dans l'onglet, sauf les PDF non fiables
      'content-disposition': `inline; filename="${downloadName(originalName, mimeType)}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
      ...(shareUrl ? { 'x-share-url': shareUrl } : {}),
    },
  });
}
