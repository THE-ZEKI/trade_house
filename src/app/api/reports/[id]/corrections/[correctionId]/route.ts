import { asUser, callApp, queryWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ correctionId: string }> };

/**
 * POST /api/reports/:id/corrections/:correctionId — arbitrage d'une correction
 *
 *   action=accept   le trader a bien corrige        -> la correction passe a « done »
 *   action=reject   il refuse la remarque           -> le superviseur tranche
 *   action=arbitrate keep=true|false               -> decision du superviseur
 *
 * Le dernier point est le coeur du cycle : une correction contestee ne peut
 * pas disparaitre silencieusement, quelqu'un tranche et la decision est
 * conservee dans la table.
 */
export async function POST(request: Request, { params }: Params) {
  const raw = await request.json().catch(() => null);
  if (typeof raw !== 'object' || raw === null) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Corps invalide', rule: null } }, 422);
  }
  const body = raw as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : '';
  const { correctionId } = await params;

  const reply = typeof body.reply === 'string' ? body.reply.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  try {
    const user = await requireUser();

    const updated = await asUser(user.userId, async (sql) => {
      if (action === 'accept') {
        if (!reply) throw new AppError('VALIDATION', 'Reponse requise', { status: 422 });
        await callApp(sql, 'respond_correction', [correctionId, 'done', reply]);
      } else if (action === 'reject') {
        if (!reason) throw new AppError('VALIDATION', 'Motif de rejet requis', { status: 422 });
        await callApp(sql, 'respond_correction', [correctionId, 'rejected', reason]);
      } else if (action === 'arbitrate') {
        if (typeof body.keep !== 'boolean') {
          throw new AppError('VALIDATION', 'Decision « keep » requise', { status: 422 });
        }
        await callApp(sql, 'arbitrate_correction', [correctionId, body.keep]);
      } else {
        throw new AppError('VALIDATION', `Action inconnue : ${action}`, { status: 422 });
      }

      const rows = await queryWith(
        sql,
        `select c.id, c.status, c.severity, c.trader_reply, c.rejection_reason,
                c.resolved_at, c.updated_at
           from public.report_corrections c where c.id = $1::uuid`,
        [correctionId],
      );
      return rows[0] ?? null;
    });

    if (!updated) {
      return jsonOk({ error: { code: 'NOT_FOUND', message: 'Correction introuvable', rule: null } }, 404);
    }
    return jsonOk({ correction: updated });
  } catch (error) {
    return jsonError(error);
  }
}
