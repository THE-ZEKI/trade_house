import { asUser, queryWith, queryOneWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { ALLOWED_MIME, sniffMime, putFile, deleteFile } from '@/lib/storage';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** RG-32 : captures d'ecran et PDF, dans une limite de taille. */
const MAX_BYTES = Number.parseInt(process.env.MAX_ATTACHMENT_MB ?? '10', 10) * 1024 * 1024;

/**
 * POST /api/reports/:id/files — ajout d'une piece jointe (RG-32)
 *
 * Le fichier n'est accepte que si sa SIGNATURE correspond au type annonce :
 * un .png contenant du HTML passerait sinon un controle base sur le seul nom
 * ou le Content-Type envoye par le client, tous deux pilotables par
 * l'attaquant. Le contenu est donc verifie avant d'etre ecrit, puis le nom
 * de stockage est regenere : le nom d'origine ne fuite jamais sur le disque.
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

    // seul le proprietaire du rapport peut y joindre des pieces
    const owner = await asUser(user.userId, (sql) =>
      queryOneWith(
        sql,
        `select 1 from public.reports
          where id = $1::uuid and trader_id = $2::uuid
            and status in ('draft', 'correction_requested')`,
        [id, user.userId],
      ),
    );
    if (!owner) {
      return jsonOk(
        { error: { code: 'FORBIDDEN', message: 'Piece jointe reservee au rapport du trader', rule: 'RG-32' } },
        403,
      );
    }

    stored = await putFile(user.userId, realMime, content);

    const rows = await asUser(user.userId, (sql) =>
      queryWith(
        sql,
        `insert into public.report_files
           (report_id, kind, storage_path, original_name, mime_type, size_bytes, uploaded_by)
         values ($1::uuid, $2::report_file_kind, $3, $4, $5, $6::bigint, $7::uuid)
         returning id, kind, original_name, mime_type, size_bytes, created_at`,
        [id, ALLOWED_MIME[realMime].category, stored, file.name || 'fichier', realMime, content.length, user.userId],
      ),
    );

    return jsonOk({ file: rows[0] }, 201);
  } catch (error) {
    // le fichier ne doit pas rester orphelin si l'insertion echoue
    if (stored) await deleteFile(stored).catch(() => {});
    if (error instanceof AppError) return jsonError(error);
    return jsonError(error);
  }
}
