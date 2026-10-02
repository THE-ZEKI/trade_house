import { asUser, callApp } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/meetings/:id/actions — annuler, deplacer une reunion
 *
 * Les deux operations passent par des fonctions `app.*` qui refusent, en base,
 * ce qui n'a pas de sens metier : on ne deplace pas une reunion terminee, on
 * n'annule pas une reunion deja annulee. L'interface n'affiche d'ailleurs le
 * bouton correspondant que si la transition est possible.
 *
 * Le changement de lien vit dans /api/meetings/:id/link, car il a sa propre
 * validation (le https est une regle de securite, pas une transition).
 */
export async function POST(request: Request, { params }: Params) {
  const raw = await request.json().catch(() => null);
  const body = (typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}) as {
    action?: string;
    reason?: string;
    startsAt?: string;
    durationMin?: number;
    scope?: string;
  };

  try {
    const user = await requireUser();
    const { id } = await params;

    if (body.action === 'cancel') {
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      // Le motif n'est pas une option : une annulation sans explication est
      // inexploicable pour le trader qui recoit le rappel.
      if (!reason) {
        throw new AppError('VALIDATION', 'Le motif est obligatoire', { status: 422, rule: 'RG-12' });
      }
      await asUser(user.userId, (sql) => callApp(sql, 'cancel_meeting', [id, reason]));
      return jsonOk({ status: 'cancelled' });
    }

    if (body.action === 'reschedule') {
      const startsAt = typeof body.startsAt === 'string' ? body.startsAt : '';
      if (Number.isNaN(Date.parse(startsAt))) {
        throw new AppError('VALIDATION', 'Nouvelle date invalide', { status: 422 });
      }
      const duration =
        Number.isFinite(Number(body.durationMin)) && Number(body.durationMin) > 0
          ? Number(body.durationMin)
          : null;

      // Trois parametres seulement : app.reschedule_meeting(p_meeting_id,
      // p_starts_at, p_duration_min). Il n'existe pas de portee « serie » dans
      // cette version — la materielisation des occurrences passe par
      // /occurrences, et s'appliquer sur la serie entiere releverait d'une
      // fonction qui n existe pas.
      await asUser(user.userId, (sql) =>
        callApp(sql, 'reschedule_meeting', [id, new Date(startsAt).toISOString(), duration]),
      );
      return jsonOk({ status: 'rescheduled' });
    }

    throw new AppError('VALIDATION', `Action inconnue : ${String(body.action ?? '')}`, { status: 422 });
  } catch (error) {
    return jsonError(error);
  }
}