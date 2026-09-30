import { asUser, callApp, queryOne, withTransaction } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requestMeta, startSession } from '@/lib/auth';
import { decryptSecret } from '@/lib/crypto';
import { hashToken } from '@/lib/session';
import { verifyCode } from '@/lib/totp';
import { newSessionToken, sessionTtlHours } from '@/lib/session';

export const dynamic = 'force-dynamic';

type Body = { email: string; code: string } | null;

function parse(raw: unknown): Body {
  if (typeof raw !== 'object' || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.email !== 'string' || typeof b.code !== 'string') return null;
  return { email: b.email.trim().toLowerCase(), code: b.code.trim() };
}

/**
 * POST /api/auth/mfa/challenge — A5, validation du code TOTP.
 *
 * Le mot de passe a deja ete verifie par /api/auth/login : ce second facteur
 * debouche sur une session. Un code de secours est accepte et consomme
 * (usage unique).
 */
export async function POST(request: Request) {
  const body = parse(await request.json().catch(() => null));
  if (!body) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Donnees invalides', rule: null } }, 422);
  }

  try {
    // SECURITY DEFINER : aucune session n'existe encore a ce stade
    const account = await queryOne<{
      user_id: string;
      email: string;
      full_name: string;
      role: string;
      is_active: boolean;
      secret: Buffer | null;
    }>('select * from app.mfa_state($1::citext)', [body.email]);

    // meme message dans tous les cas : ni le compte ni la 2FA ne sont divulgues
    const fail = () =>
      jsonOk({ error: { code: 'UNAUTHENTICATED', message: 'Code invalide', rule: 'A5' } }, 401);
    if (!account?.is_active || !account.secret) return fail();

    let valid = verifyCode(decryptSecret(account.secret).toString('ascii'), body.code);
    let usedBackupCode = false;

    if (!valid) {
      // le code peut etre un code de secours
      const consumed = await withTransaction((sql) =>
        callApp<boolean>(sql, 'app.consume_backup_code', [account.user_id, hashToken(body.code.toUpperCase())]),
      );
      if (consumed) {
        valid = true;
        usedBackupCode = true;
      }
    }
    if (!valid) return fail();

    const token = newSessionToken();
    const meta = await requestMeta();
    const expiresAt = await withTransaction(async (sql) => {
      const { rows } = await sql.query<{ expires_at: Date }>(
        'select * from app.create_session($1::uuid, $2::text, $3::inet, $4::text, $5::int)',
        [account.user_id, hashToken(token), meta.ip, meta.userAgent, sessionTtlHours()],
      );
      return rows[0].expires_at;
    });
    await startSession(token, expiresAt);

    const remaining = await queryOne<{ n: number }>(
      'select app.backup_codes_remaining($1::uuid) as n',
      [account.user_id],
    );

    return jsonOk({
      status: 'authenticated',
      usedBackupCode,
      backupCodesRemaining: remaining?.n ?? 0,
      user: {
        userId: account.user_id,
        email: account.email,
        fullName: account.full_name,
        role: account.role,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
