import { asUser, callApp, queryWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const FIELD_TARGETS = new Set(['general', 'field', 'file']);
const SEVERITIES = ['mandatory', 'suggestion'];
const SHAPES = ['rectangle', 'circle', 'arrow', 'freehand', 'text'];

/**
 * POST /api/reports/:id/corrections — le superviseur pointe une erreur (P9)
 *
 * Une correction peut viser le rapport entier (general), un champ precis
 * (field) ou une zone d'une piece jointe (file). Dans le dernier cas, le
 * corps porte les coordonnees de l'annotation, stockees avec la correction :
 * l'annotateur et l'auteur de la remarque restent ainsi traçables.
 */
export async function POST(request: Request, { params }: Params) {
  const raw = await request.json().catch(() => null);
  if (typeof raw !== 'object' || raw === null) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Corps invalide', rule: null } }, 422);
  }
  const body = raw as Record<string, unknown>;
  const { id } = await params;

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const targetType = typeof body.targetType === 'string' ? body.targetType : 'general';
  const targetField = typeof body.targetField === 'string' ? body.targetField.trim() : null;
  const targetFileId = typeof body.targetFileId === 'string' ? body.targetFileId : null;
  // Le defaut doit exister dans l'enum. Il valait 'medium', qui n'existe pas :
  // correction_severity ne contient que 'mandatory' et 'suggestion'. Le code
  // ne declenchait pas l'erreur — l'interface envoie toujours une valeur — mais
  // un appel direct sans severity se serait fait refuser en 422 avec un
  // message qui ne designait pas la vraie cause. Un defaut invalide est une
  // impasse qui n'apparait que le jour ou on l'atteint.
  const severity = typeof body.severity === 'string' ? body.severity : 'suggestion';

  if (!message || message.length > 4000) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Message requis (4000 car. max)', rule: null } }, 422);
  }
  if (!FIELD_TARGETS.has(targetType) || !SEVERITIES.includes(severity)) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Cible ou severite invalide', rule: null } }, 422);
  }
  if (targetType === 'field' && !targetField) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Champ cible requis', rule: null } }, 422);
  }
  if (targetType === 'file' && !targetFileId) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Piece jointe cible requise', rule: null } }, 422);
  }
  if (targetType !== 'file' && targetFileId) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Piece jointe incoherente avec la cible', rule: null } }, 422);
  }

  try {
    const user = await requireUser();

    const created = await asUser(user.userId, async (sql) => {
      // asUser ouvre deja une transaction : la correction, son annotation et la
      // relecture forment un seul tout, annule en bloc en cas d'echec.
      const correctionId = await callApp<string>(
        sql,
        'add_correction',
        [id, message, severity, targetType, targetField, targetFileId],
      );
      if (!correctionId) {
        throw new AppError('CONFLICT', 'Correction refusee', { status: 409 });
      }

      // annotation dessinee sur la piece jointe, facultative
      if (targetType === 'file' && targetFileId) {
        const a = (body.annotation ?? null) as { shape?: unknown; data?: unknown } | null;
        if (a && typeof a === 'object' && typeof a.shape === 'string' && SHAPES.includes(a.shape)) {
          const data = typeof a.data === 'object' && a.data !== null ? a.data : {};
          await queryWith(
            sql,
            `insert into public.file_annotations (file_id, correction_id, shape, data, author_id)
             values ($1::uuid, $2::uuid, $3::annotation_shape, $4::jsonb, $5::uuid)`,
            [targetFileId, correctionId, a.shape, JSON.stringify(data), user.userId],
          );
        }
      }

      const rows = await queryWith(
        sql,
        `select c.id, c.target_type, c.target_field, c.target_file_id, c.message,
                c.severity, c.status, c.created_at
           from public.report_corrections c where c.id = $1::uuid`,
        [correctionId],
      );
      return rows[0] ?? null;
    });

    return jsonOk({ correction: created }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
