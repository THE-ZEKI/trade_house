import { asUser, queryWith } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ fileId: string; annotationId: string }> };

/**
 * DELETE /api/reports/files/:fileId/annotations/:annotationId
 *
 * Autorise par la politique `annotations_delete` (migration 020) : l'encadrement
 * sur n'importe quelle annotation du fichier, et l'auteur sur la sienne. Cette
 * asymetrie est voulue — un dessin errone ne doit pas rester bloque parce que
 * son auteur est absent.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { fileId, annotationId } = await params;

    const deleted = await asUser(user.userId, (sql) =>
      queryWith(
        sql,
        `delete from public.file_annotations
          where id = $1::uuid and file_id = $2::uuid
          returning id`,
        [annotationId, fileId],
      ),
    );

    if (deleted.length === 0) {
      // 0 ligne revient soit de « inexistant », soit de « refuse par le RLS ».
      // Dans les deux cas la reponse est identique : dire « refuse » a un
      // attaquant qui teste des identifiants lui confirmerait l'existence.
      throw new AppError('FORBIDDEN', 'Annotation introuvable ou suppression non autorisee', {
        status: 403,
        rule: 'RG-46',
      });
    }

    return jsonOk({ deleted: annotationId });
  } catch (error) {
    return jsonError(error);
  }
}