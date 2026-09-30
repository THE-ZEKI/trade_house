import { asUser, callApp, queryOne } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { encryptSecret } from '@/lib/crypto';
import { generateSecret, otpauthUrl } from '@/lib/totp';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/mfa/setup — A5, etape 1/2
 *
 * Genere un secret TOTP, le chiffre (AES-256-GCM) et le stocke en attente de
 * confirmation. Le secret en clair n'est renvoye qu'ici, a l'utilisateur qui
 * vient de s'authentifier : il ne le voit qu'une fois.
 *
 * L'application n'est PAS encore protegee tant que l'etape 2 n'est pas faite
 * (mfa_enrolled reste false en base).
 */
export async function POST() {
  try {
    const user = await requireUser();

    const secret = generateSecret();
    const encrypted = encryptSecret(Buffer.from(secret, 'ascii'));

    await asUser(user.userId, (sql) =>
      callApp(sql, 'app.store_mfa_secret', [user.userId, encrypted]),
    );

    return jsonOk({
      status: 'secret_created',
      secret,
      otpauthUrl: otpauthUrl({ secret, account: user.email, issuer: 'Trade House' }),
      instructions: [
        'Ouvrez votre application d’authentification (Google Authenticator, 1Password, Authy…).',
        'Ajoutez un compte en scannant le secret ou l’URL otpauth.',
        'Saisissez le code à 6 chiffres pour confirmer.',
      ],
    });
  } catch (error) {
    return jsonError(error);
  }
}
