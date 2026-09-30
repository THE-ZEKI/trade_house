import { authenticate, requestMeta, startSession } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Parsed = { email: string; password: string } | null;

/** Validation minimale : deux champs, pas besoin d'une bibliotheque. */
function parseBody(raw: unknown): Parsed {
  if (typeof raw !== 'object' || raw === null) return null;
  const { email, password } = raw as Record<string, unknown>;
  if (typeof email !== 'string' || typeof password !== 'string') return null;
  const trimmed = email.trim();
  if (trimmed.length < 3 || trimmed.length > 255) return null;
  // bcrypt ne regarde que les 72 premiers octets : on borne au-dela
  if (password.length === 0 || password.length > 200) return null;
  return { email: trimmed, password };
}

/**
 * POST /api/auth/login
 *
 * Reponses :
 *   200 { status: 'authenticated', user }   -> cookie de session pose
 *   200 { status: 'mfa_setup_required' }     -> 2FA obligatoire, a configurer
 *   200 { status: 'mfa_challenge_required' } -> code TOTP a fournir
 *   401 { error }                           -> identifiants invalides
 *   403 { error }                           -> compte desactive (RG-03)
 *   422 { error }                           -> corps de requete invalide
 */
export async function POST(request: Request) {
  const body = parseBody(await request.json().catch(() => null));
  if (!body) {
    return jsonOk(
      { error: { code: 'VALIDATION', message: 'Donnees invalides', rule: null } },
      422,
    );
  }

  try {
    const meta = await requestMeta();
    const result = await authenticate({
      email: body.email,
      password: body.password,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    if (result.status === 'authenticated') {
      await startSession(result.token, result.expiresAt);
      return jsonOk({ status: 'authenticated', user: result.user });
    }

    // Pas de cookie tant que la 2FA n'est pas configuree ou validee
    return jsonOk({ status: result.status, user: result.user });
  } catch (error) {
    return jsonError(error);
  }
}

