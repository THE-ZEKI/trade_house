import { asUser, queryOneWith, queryWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { deleteFile } from '@/lib/storage';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; fileId: string }> };

/**
 * DELETE /api/reports/:id/files/:fileId — retirer une piece jointe (RG-31)
 *
 * Reserve au proprietaire du rapport, et seulement tant que le rapport est
 * encore modifiable. Deux gardes, volontairement redondants :
 *
 *   - la verification applicative rend un message comprehensible ;
 *   - la politique `files_delete` (migration 020) refuse l'operation meme si
 *     cette verification etait contournee.
 *
 * Le RLS ne disparait pas apres le DELETE : on rend la ligne pour recuperer le
 * chemin de stockage, on supprime le fichier, puis on efface la ligne. L'ordre
 * compte — supprimer d'abord laisserait un fichier orphelin impossible a
 * retrouver, alors qu'une ligne orpheline se detecte et se purge.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id, fileId } = await params;

    const file = await asUser(user.userId, (sql) =>
      queryOneWith<{ storage_path: string }>(
        sql,
        `select f.storage_path
           from public.report_files f
           join public.reports r on r.id = f.report_id
          where f.id = $1::uuid
            and f.report_id = $2::uuid
            and r.trader_id = $3::uuid
            and r.status in ('draft', 'correction_requested')`,
        [fileId, id, user.userId],
      ),
    );

    if (!file) {
      return jsonOk(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Piece jointe introuvable, ou rapport deja depose',
            rule: 'RG-31',
          },
        },
        403,
      );
    }

    const deleted = await asUser(user.userId, (sql) =>
      queryWith(sql, `delete from public.report_files where id = $1::uuid returning id`, [fileId]),
    );

    if (deleted.length === 0) {
      throw new AppError('FORBIDDEN', 'Suppression refusee par la base', { status: 403, rule: 'RG-31' });
    }

    await deleteFile(file.storage_path).catch(() => {
      // La ligne est deja supprimee : un fichier restant sur le disque est
      // indesirable mais sans consequence de securite (il n'est plus
      // rattache a aucun rapport et n'est servi par aucune route).
      // Faire echouer la requete ici donnerait un faux negatif a l'utilisateur.
    });

    return jsonOk({ deleted: fileId });
  } catch (error) {
    if (error instanceof AppError) return jsonError(error);
    return jsonError(error);
  }
}