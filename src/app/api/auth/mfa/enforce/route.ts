import { asUser, callApp } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type Body = { userId: string; enabled: boolean } | null;

/**
 * POST /api/auth/mfa/enforce — RG-06 : reserve a l'administrateur.
 * Rend la 2FA obligatoire (ou non) pour un compte. Journalise (RG-63).
 */
export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  if (
    typeof raw !== 'object' ||
    raw === null ||
    typeof (raw as Record<string, unknown>).userId !== 'string' ||
    typeof (raw as Record<string, unknown>).enabled !== 'boolean'
  ) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Donnees invalides', rule: null } }, 422);
  }
  const body = raw as { userId: string; enabled: boolean };

  try {
    const actor = await requireUser();
    if (actor.role !== 'admin') {
      throw new AppError('FORBIDDEN', 'Seul un administrateur peut faire', {
        status: 403,
        rule: 'RG-06',
      });
    }
    await asUser(actor.userId, (sql) =>
      callApp(sql, 'app.set_mfa_enforced', [body.userId, body.enabled]),
    );
    return jsonOk({ status: 'updated', userId: body.userId, mfaEnforced: body.enabled });
  } catch (error) {
    return jsonError(error);
  }
}
