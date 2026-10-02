import { asUser, queryOneWith } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getFile, downloadName } from '@/lib/storage';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ fileId: string }> };

/**
 * GET /api/training/files/:fileId — capture d'exercice, en prive (RG-33)
 *
 * Meme regime que les pieces jointes de rapport : le fichier n'est JAMAIS servi
 * en statique. Le dossier .storage/ est hors de public/ et le nom de stockage ne
 * correspond a aucun nom lisible ; seule cette route permet d'y acceder, et
 * elle s'appuie sur le RLS pour verifier que l'utilisateur voit le travail.
 *
 * Si le RLS ne renvoie rien, la reponse est 404 et non 403 : distinguer « vous
 * n'avez pas le droit » de « cela n'existe pas » confirmerait l'existence du
 * fichier a qui essaie de le deviner.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { fileId } = await params;

    const file = await asUser(user.userId, (sql) =>
      queryOneWith<{ storage_path: string; original_name: string; mime_type: string }>(
        sql,
        `select f.storage_path, f.original_name, f.mime_type
           from public.training_exercise_files f
          where f.id = $1::uuid`,
        [fileId],
      ),
    );

    if (!file) {
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Capture introuvable', rule: null } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    const content = await getFile(file.storage_path);
    return new Response(new Uint8Array(content), {
      headers: {
        'content-type': file.mime_type,
        'content-length': String(content.length),
        'content-disposition': `inline; filename="${downloadName(file.original_name, file.mime_type)}"`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur';
    return new Response(JSON.stringify({ error: { code: 'INTERNAL', message } }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}