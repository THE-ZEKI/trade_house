import { withTransaction, callApp } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { assertPasswordPolicy, hashPassword } from '@/lib/password';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type Body = { token: string; password: string } | null;

/**
 * POST /api/auth/password/reset — A1
 *
 * Consomme le jeton de reinitialisation (1 heure, usage unique : la base le
 * verifie). Apres changement, toutes les sessions ouvertes sont revoquees :
 * si le compte etait vole, l'attaquant est deconnecte aussitot.
 */
export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  if (
    typeof raw !== 'object' ||
    raw === null ||
    typeof (raw as Record<string, unknown>).token !== 'string' ||
    typeof (raw as Record<string, unknown>).password !== 'string'
  ) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Donnees invalides', rule: null } }, 422);
  }
  const body = raw as { token: string; password: string };

  try {
    await assertPasswordPolicy(body.password);
    const passwordHash = await hashPassword(body.password);

    const userId = await withTransaction(async (sql) => {
      const accepted = await callApp<string>(sql, 'app.accept_invitation', [
        body.token.trim(),
        passwordHash,
      ]);
      if (!accepted) {
        throw new AppError('VALIDATION', 'Lien invalide ou expire', { status: 422, rule: 'RG-05' });
      }
      // toutes les sessions sont fermees
      await callApp(sql, 'app.revoke_all_sessions', [accepted]);
      return accepted;
    });

    return jsonOk({ status: 'password_changed', userId });
  } catch (error) {
    return jsonError(error);
  }
}
