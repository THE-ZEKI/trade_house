import { asUser, callApp } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * POST /api/training/assignments — attribuer un cours a un trader
 *
 * La base refuse tout trader qui n'est pas de l'equipe du manager. C'est cette
 * regle, et non l'interface, qui doit proteger le cloisonnement : un appel
 * direct avec un identifiant devine doit echouer.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!can(user, 'training.assign')) {
      throw new AppError('FORBIDDEN', 'Seul un manager attribue un cours', { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as {
      courseId?: string;
      traderId?: string;
      dueAt?: string | null;
    } | null;

    if (!body?.courseId || !body?.traderId) {
      throw new AppError('VALIDATION', 'Cours et trader sont requis', { status: 422 });
    }

    // Une echeance est facultative, mais si elle est fournie elle doit etre une
    // vraie date : une chaine libre finirait acceptée par PostgreSQL puis
    // affichée telle quelle dans l'ecran du trader.
    let due: Date | null = null;
    if (typeof body.dueAt === 'string' && body.dueAt.trim()) {
      const parsed = new Date(body.dueAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new AppError('VALIDATION', 'Echeance invalide', { status: 422 });
      }
      due = parsed;
    }

    const id = await asUser(user.userId, (sql) =>
      callApp<string>(sql, 'assign_training', [body.courseId, body.traderId, due]),
    );

    return jsonOk({ assignment: { id, courseId: body.courseId, traderId: body.traderId } }, 201);
  } catch (error) {
    return jsonError(error);
  }
}