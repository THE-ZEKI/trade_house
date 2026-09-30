import { asUser, callApp, queryOneWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertPasswordPolicy, hashPassword } from '@/lib/password';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/password/change — changement par l'utilisateur connecte.
 *
 * Le mot de passe ACTUEL est exigé : sans cela, quiconque vole une session
 * pourrait fixer un nouveau mot de passe et eviter definitivement le
 * proprietaire du compte.
 *
 * Toutes les sessions sont revoquees apres changement.
 */
export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const body =
    typeof raw === 'object' && raw !== null
      ? {
          currentPassword: (raw as Record<string, unknown>).currentPassword,
          newPassword: (raw as Record<string, unknown>).newPassword,
        }
      : null;

  if (typeof body?.newPassword !== 'string') {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Donnees invalides', rule: null } }, 422);
  }
  // Le mot de passe actuel est OBLIGATOIRE : s'il est absent, on ne change rien.
  if (typeof body?.currentPassword !== 'string' || body.currentPassword.length === 0) {
    return jsonOk(
      { error: { code: 'VALIDATION', message: 'Mot de passe actuel requis', rule: null } },
      422,
    );
  }

  try {
    const user = await requireUser();
    const bcrypt = (await import('bcryptjs')).default;

    const account = await asUser(user.userId, (sql) =>
      queryOneWith<{ password_hash: string }>(
        sql,
        'select password_hash from public.users where id = $1::uuid',
        [user.userId],
      ),
    );
    if (!account || !(await bcrypt.compare(body.currentPassword, account.password_hash))) {
      throw new AppError('UNAUTHENTICATED', 'Mot de passe actuel incorrect', { status: 401 });
    }

    await assertPasswordPolicy(body.newPassword);
    const hash = await hashPassword(body.newPassword);

    await asUser(user.userId, async (sql) => {
      await callApp(sql, 'app.set_password', [user.userId, hash]);
      // defense en profondeur : toutes les sessions tombent
      await callApp(sql, 'app.revoke_all_sessions', [user.userId]);
    });

    return jsonOk({ status: 'password_changed', reauthenticate: true });
  } catch (error) {
    return jsonError(error);
  }
}
