import { asUser, callApp, queryOneWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { decryptSecret, encryptSecret, randomToken } from '@/lib/crypto';
import { hashToken } from '@/lib/session';
import { verifyCode } from '@/lib/totp';

export const dynamic = 'force-dynamic';

const BACKUP_CODES = 10;

type Body = { code: string } | null;

function parse(raw: unknown): Body {
  if (typeof raw !== 'object' || raw === null) return null;
  const code = (raw as Record<string, unknown>).code;
  if (typeof code !== 'string') return null;
  return { code: code.trim() };
}

/**
 * POST /api/auth/mfa/confirm - A5, etape 2/2
 *
 * Verifie un code TOTP contre le secret en attente : cela prouve a l'application
 * que l'utilisateur possede reellement l'authentificateur. Ensuite 10 codes de
 * secours sont generes et stockes hachees : ils ne sont affiches qu'ici.
 */
export async function POST(request: Request) {
  const body = parse(await request.json().catch(() => null));
  if (!body) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Donnees invalides', rule: null } }, 422);
  }

  try {
    const user = await requireUser();

    // lecture DANS le contexte de l'utilisateur, sinon le RLS de
    // public.mfa_factors ne laisse passer aucune ligne
    const pending = await asUser(user.userId, (sql) =>
      queryOneWith<{ secret: Buffer | null }>(
        sql,
        'select secret from public.mfa_factors where user_id = $1::uuid and confirmed_at is null',
        [user.userId],
      ),
    );
    if (!pending?.secret) {
      return jsonOk(
        { error: { code: 'CONFLICT', message: 'Aucun secret en attente', rule: 'A5' } },
        409,
      );
    }

    const secret = decryptSecret(pending.secret).toString('ascii');
    if (!verifyCode(secret, body.code)) {
      return jsonOk({ error: { code: 'CONFLICT', message: 'Code invalide', rule: 'A5' } }, 401);
    }

    // codes de secours : generes ici, stockes uniquement hachees
    const plainCodes = Array.from({ length: BACKUP_CODES }, () => randomToken(6));
    const hashes = plainCodes.map((code) => hashToken(code));

    await asUser(user.userId, async (sql) => {
      await callApp(sql, 'app.confirm_mfa', [
        user.userId,
        encryptSecret(Buffer.from(secret, 'ascii')),
      ]);
      await callApp(sql, 'app.store_backup_codes', [user.userId, hashes]);
    });

    return jsonOk({
      status: 'mfa_enabled',
      backupCodes: plainCodes,
      warning: 'Conservez ces codes : chacun ne fonctionne qu’une fois.',
    });
  } catch (error) {
    return jsonError(error);
  }
}
