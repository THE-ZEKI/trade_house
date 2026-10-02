import { asUser, callApp, callAppSet } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/reports/:id/actions — cycle de vie du rapport (P8, P9, RG-31, RG-33)
 *
 * Toutes les transitions passent par les fonctions app.* : les regles (jalon
 * 24 h, delai de correction, separation des roles, coherence des corrections)
 * sont verifiees en base, dans une transaction, jamais dans le code applicatif.
 * Le corps ne porte que le nom de l'action et ses arguments.
 */
export async function POST(request: Request, { params }: Params) {
  const raw = await request.json().catch(() => null);
  if (typeof raw !== 'object' || raw === null) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Corps invalide', rule: null } }, 422);
  }
  const body = raw as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : '';
  const { id } = await params;

  try {
    const user = await requireUser();

    const result = await asUser(user.userId, async (sql) => {
      switch (action) {
        case 'submit':
          // RG-31 : la soumission fige la version 1 et marque le rapport tardif
          // si elle intervient apres le jalon de 24 h.
          return { status: await callApp(sql, 'submit_report', [id]) };

        case 'resubmit':
          // Nouvelle version apres corrections : l'historique reste intact (E6).
          return { status: await callApp(sql, 'resubmit_report', [id]) };

        case 'start-review':
          return { status: await callApp(sql, 'start_review', [id]) };

        case 'request-corrections': {
          const deadline = typeof body.deadline === 'string' ? body.deadline : null;
          if (deadline && Number.isNaN(Date.parse(deadline))) {
            throw new AppError('VALIDATION', 'Echeance invalide', { status: 422 });
          }
          return {
            status: await callApp(sql, 'request_corrections', [
              id,
              deadline ? new Date(deadline).toISOString() : null,
            ]),
          };
        }

        case 'validate':
          // Impossible tant qu'une correction est ouverte : la fonction le refuse.
          return { status: await callApp(sql, 'validate_report', [id]) };

        case 'dismiss': {
          const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
          if (!reason) throw new AppError('VALIDATION', 'Motif obligatoire', { status: 422 });
          return { status: await callApp(sql, 'dismiss_report', [id, reason]) };
        }

        case 'reopen': {
          const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
          if (!reason) throw new AppError('VALIDATION', 'Motif obligatoire', { status: 422 });
          return { status: await callApp(sql, 'reopen_report', [id, reason]) };
        }

        default:
          throw new AppError('VALIDATION', `Action inconnue : ${action}`, { status: 422 });
      }
    });

    return jsonOk({ report: result });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * POST /api/reports/:id/no-trade — declaration « jour sans trade » (D7)
 *
 * Un rapport « no trade » reste un rapport : il entre dans le meme cycle de
 * revue que les autres, sinon la regularity de l'ancien (le suivi de presence)
 * serait triviale a contourner.
 */
export async function PUT(request: Request) {
  const raw = await request.json().catch(() => null);
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  try {
    const user = await requireUser();
    const { report } = await asUser(user.userId, async (sql) => {
      const rows = await callAppSet(sql, 'declare_no_trade', [
        typeof body.sessionDate === 'string' ? body.sessionDate : null,
        typeof body.reason === 'string' ? body.reason : null,
      ]);
      return { report: rows[0] ?? null, reason: body.reason ?? null };
    });

    if (!report) {
      return jsonOk({ error: { code: 'VALIDATION', message: 'Date de seance requise (AAAA-MM-JJ)', rule: null } }, 422);
    }
    return jsonOk({ report });
  } catch (error) {
    return jsonError(error);
  }
}

/** DELETE /api/reports/:id/no-trade — annulation avant soumission */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const user = await requireUser();
    await asUser(user.userId, (sql) => callApp(sql, 'cancel_no_trade', [id]));
    return jsonOk({ cancelled: true });
  } catch (error) {
    return jsonError(error);
  }
}
