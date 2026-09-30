import { asUser, callApp, queryOneWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/auth/mfa - desactivation de la 2FA.
 *
 * Exige le mot de passe : sans cela, un attaquant ayant vole la session
 * pourrait supprimer le second facteur et se particulier de la securite.
 * L'evenement est journalise (RG-63).
 */
export async function DELETE(request: Request) {
  const raw = await request.json().catch(() => null);
  const password =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).password : null;
  if (typeof password !== 'string') {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Mot de passe requis', rule: null } }, 422);
  }

  try {
    const user = await requireUser();
    if (!user.mfaEnrolled) {
      throw new AppError('CONFLICT', 'La 2FA n’est pas activee', { status: 409 });
    }

    // lecture dans le contexte de l'utilisateur (RLS) : le hash sert uniquement
    // a verifier le mot de passe, il n'est jamais renvoye
    const account = await asUser(user.userId, (sql) =>
      queryOneWith<{ password_hash: string }>(
        sql,
        'select password_hash from public.users where id = $1::uuid',
        [user.userId],
      ),
    );

    const bcrypt = (await import('bcryptjs')).default;
    if (!account || !(await bcrypt.compare(password, account.password_hash))) {
      throw new AppError('UNAUTHENTICATED', 'Mot de passe incorrect', { status: 401 });
    }

    await asUser(user.userId, (sql) => callApp(sql, 'app.disable_mfa', [user.userId]));

    return jsonOk({ status: 'mfa_disabled' });
  } catch (error) {
    return jsonError(error);
  }
}
