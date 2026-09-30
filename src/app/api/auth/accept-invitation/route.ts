import { asUser, callApp, queryOneWith, withTransaction } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { assertPasswordPolicy, hashPassword } from '@/lib/password';
import { startSession } from '@/lib/auth';
import { hashToken, newSessionToken, sessionTtlHours } from '@/lib/session';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type Body = { token: string; password: string } | null;

function parse(raw: unknown): Body {
  if (typeof raw !== 'object' || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.token !== 'string' || typeof b.password !== 'string') return null;
  return { token: b.token.trim(), password: b.password };
}

/**
 * POST /api/auth/accept-invitation - A2 / RG-05
 *
 * Le jeton est valide par la base (expiration 7 jours, usage unique). Le mot de
 * passe est hache ici, jamais transporte ni stocke en clair (RG-60).
 * Une session est ouverte aussitot : l'utilisateur est operationnel.
 */
export async function POST(request: Request) {
  const body = parse(await request.json().catch(() => null));
  if (!body) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Donnees invalides', rule: null } }, 422);
  }

  try {
    // RG-65 avant tout : inutile de hacher un mot de passe qui sera refuse
    await assertPasswordPolicy(body.password);
    const passwordHash = await hashPassword(body.password);

    // aucune session ouverte : l'appel se fait sans contexte utilisateur
    const userId = await withTransaction((sql) =>
      callApp<string>(sql, 'app.accept_invitation', [body.token, passwordHash]),
    );
    if (!userId) {
      throw new AppError('VALIDATION', 'Invitation invalide', { status: 422, rule: 'RG-05' });
    }

    // session immediate
    const token = newSessionToken();
    const expiresAt = await withTransaction(async (sql) => {
      const { rows } = await sql.query<{ expires_at: Date }>(
        'select * from app.create_session($1::uuid, $2::text, null, null, $3::int)',
        [userId, hashToken(token), sessionTtlHours()],
      );
      return rows[0].expires_at;
    });
    await startSession(token, expiresAt);

    // la session existe desormais : on lit le profil dans son contexte (RLS)
    const profile = await asUser(userId, (sql) =>
      queryOneWith<{ email: string; full_name: string; role: string }>(
        sql,
        'select email, full_name, role from public.users where id = $1::uuid',
        [userId],
      ),
    );

    return jsonOk({
      status: 'activated',
      user: {
        userId,
        email: profile?.email,
        fullName: profile?.full_name,
        role: profile?.role,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
