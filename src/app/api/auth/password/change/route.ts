import { asUser, callApp, queryOne } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertPasswordPolicy, hashPassword } from '@/lib/password';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/password/change — changement par l'utilisateur connecte.
 * Toutes les sessions sont revoquees, y compris la courante : l'utilisateur
 * doit se reconnecter avec le nouveau mot de passe.
 */
export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const password =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).password : null;
  if (typeof password !== 'string') {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Donnees invalides', rule: null } }, 422);
  }

  try {
    const user = await requireUser();
    await assertPasswordPolicy(password);
    const hash = await hashPassword(password);

    await asUser(user.userId, async (sql) => {
      await callApp(sql, 'app.set_password', [user.userId, hash]);
    });

    return jsonOk({ status: 'password_changed', reauthenticate: true });
  } catch (error) {
    return jsonError(error);
  }
}
