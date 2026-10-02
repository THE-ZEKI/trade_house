import { asUser, queryWith, queryOneWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { ALLOWED_MIME, sniffMime, putFile, deleteFile } from '@/lib/storage';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** RG-32 : memes limites que les pieces jointes de rapport. */
const MAX_BYTES = Number.parseInt(process.env.MAX_ATTACHMENT_MB ?? '10', 10) * 1024 * 1024;

/**
 * POST /api/training/courses/:id/files — support de cours (image ou PDF)
 *
 * Meme regime que les pieces jointes de rapport : liste fermee de types, et
 * verification de la SIGNATURE reelle du contenu. Un fichier renomme .png
 * mais contenant du HTML passerait sinon un controle base sur le nom ou sur
 * le Content-Type du client, tous deux pilotables par l'attaquant.
 *
 * L'ecriture passe par app.attach_course_file, qui refuse un cours qui n'est
 * pas de l'auteur. Le droit d'ecrire est donc decide en base, pas ici.
 */
export async function POST(request: Request, { params }: Params) {
  let stored: string | null = null;

  try {
    const user = await requireUser();
    const { id } = await params;

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return jsonOk({ error: { code: 'VALIDATION', message: 'Fichier manquant', rule: 'RG-32' } }, 422);
    }
    if (file.size === 0 || file.size > MAX_BYTES) {
      return jsonOk(
        { error: { code: 'VALIDATION', message: `Fichier vide ou superieur a ${MAX_BYTES / 1048576} Mo`, rule: 'RG-32' } },
        422,
      );
    }

    const declared = ALLOWED_MIME[file.type] ? file.type : null;
    if (!declared) {
      return jsonOk(
        { error: { code: 'VALIDATION', message: 'Type non autorise (PNG, JPEG, WebP, PDF)', rule: 'RG-32' } },
        422,
      );
    }

    const content = Buffer.from(await file.arrayBuffer());
    const realMime = sniffMime(content);
    if (realMime !== declared) {
      return jsonOk(
        { error: { code: 'VALIDATION', message: 'Le contenu du fichier ne correspond pas a son type', rule: 'RG-32' } },
        422,
      );
    }

    stored = await putFile(user.userId, realMime, content);

    // app.attach_course_file refuse si l'utilisateur n'est pas l'auteur du
    // cours : une exception here est un refus metier, pas une panne.
    const rows = await asUser(user.userId, (sql) =>
      queryWith<{ id: string }>(
        sql,
        `select app.attach_course_file($1::uuid, $2, $3, $4, $5::bigint) as id`,
        [id, stored, file.name || 'fichier', realMime, content.length],
      ),
    );

    return jsonOk({ file: rows[0] }, 201);
  } catch (error) {
    // Pas de fichier orphelin : si l'insertion echoue, le contenu ecrit sur
    // le disque ne serait plus atteignable par aucune ligne.
    if (stored) await deleteFile(stored).catch(() => {});
    return jsonError(error);
  }
}

/**
 * DELETE /api/training/courses/:id/files?fileId=...
 *
 * Le retrait est decide par app.remove_course_file : la route ne verifie que
 * la presence du parametre, jamais l'autorisation.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const fileId = new URL(request.url).searchParams.get('fileId');

    if (!fileId) {
      return jsonOk({ error: { code: 'VALIDATION', message: 'Fichier manquant' } }, 422);
    }

    // Le chemin de stockage est recupere AVANT la suppression pour effacer le
    // contenu : la ligne disparue, le fichier resterait sur le disque.
    const before = await asUser(user.userId, (sql) =>
      queryOneWith<{ storage_path: string }>(
        sql,
        `select f.storage_path
           from public.training_course_files f
          where f.id = $1::uuid and f.course_id = $2::uuid`,
        [fileId, id],
      ),
    );

    await asUser(user.userId, (sql) =>
      queryWith(sql, `select app.remove_course_file($1::uuid) as ok`, [fileId]),
    );

    if (before) await deleteFile(before.storage_path).catch(() => {});

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
