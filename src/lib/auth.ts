import bcrypt from 'bcryptjs';
import { cookies, headers } from 'next/headers';
import { queryOne, query, withTransaction } from './db';
import {
  SESSION_COOKIE,
  hashToken,
  newSessionToken,
  sessionCookieOptions,
  sessionTtlHours,
} from './session';
import { AppError } from './errors';

/**
 * Authentification.
 *
 * Points importants :
 *  - la lecture du compte et l'ouverture de la session passent par des fonctions
 *    app.* SECURITY DEFINER : au moment de la connexion, personne n'est
 *    identifie et le RLS ne laisserait passer aucune ligne (cf. 010_auth.sql) ;
 *  - le mot de passe est verifie ici (bcrypt), jamais par la base ;
 *  - en cas d'echec, on effectue quand meme une comparaison bcrypt factice :
 *    sinon le temps de reponse revele quels emails existent (RG-01).
 */

export type SessionUser = {
  userId: string;
  email: string;
  fullName: string;
  role: 'admin' | 'manager' | 'trader';
  timezone: string;
  locale: string;
  mfaEnforced: boolean;
  mfaEnrolled: boolean;
  sessionExpiresAt: string;
};

/** Hachage factice : sert a egaliser le temps de reponse (anti-enumeration). */
const DUMMY_HASH = '$2a$06$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

type LoginRow = {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: SessionUser['role'];
  is_active: boolean;
  mfa_enforced: boolean;
  mfa_enrolled: boolean;
  preferred_locale: string;
  timezone: string;
};

type PublicUser = Omit<SessionUser, 'sessionExpiresAt'>;

export type LoginResult =
  | { status: 'authenticated'; token: string; expiresAt: Date; user: PublicUser }
  | { status: 'mfa_setup_required'; user: PublicUser }
  | { status: 'mfa_challenge_required'; user: PublicUser };

export async function authenticate(params: {
  email: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<LoginResult> {
  const email = params.email.trim().toLowerCase();
  const user = await queryOne<LoginRow>('select * from app.user_for_login($1::citext)', [email]);

  const passwordOk = await bcrypt.compare(params.password, user?.password_hash ?? DUMMY_HASH);

  if (!user || !passwordOk) {
    throw new AppError('UNAUTHENTICATED', 'Identifiants invalides', { status: 401 });
  }
  // RG-03 : un compte desactive ne peut plus se connecter
  if (!user.is_active) {
    throw new AppError('FORBIDDEN', 'Compte desactive', { status: 403 });
  }

  const publicUser: PublicUser = {
    userId: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    timezone: user.timezone,
    locale: user.preferred_locale,
    mfaEnforced: user.mfa_enforced,
    mfaEnrolled: user.mfa_enrolled,
  };

  // A5 : 2FA obligatoire mais pas encore configuree -> il doit d'abord
  // enregistrer son authentificateur avant d'obtenir une session
  if (user.mfa_enforced && !user.mfa_enrolled) {
    return { status: 'mfa_setup_required', user: publicUser };
  }
  if (user.mfa_enrolled) {
    return { status: 'mfa_challenge_required', user: publicUser };
  }

  const token = newSessionToken();
  const expiresAt = await withTransaction(async (sql) => {
    const { rows } = await sql.query<{ id: string; expires_at: Date }>(
      'select * from app.create_session($1::uuid, $2::text, $3::inet, $4::text, $5::int)',
      [user.id, hashToken(token), params.ip ?? null, params.userAgent ?? null, sessionTtlHours()],
    );
    return rows[0].expires_at;
  });

  return { status: 'authenticated', token, expiresAt, user: publicUser };
}

/** Pose le cookie de session. */
export async function startSession(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

/** Supprime le cookie de session. */
export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, '', { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
}

export async function currentSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Utilisateur courant, ou null.
 * A appeler dans les Server Components / Route Handlers (runtime Node).
 * La verification se fait en base : un cookie present n'est pas une preuve.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const token = await currentSessionToken();
  if (!token) return null;

  const row = await queryOne<{
    user_id: string;
    email: string;
    full_name: string;
    role: SessionUser['role'];
    timezone: string;
    preferred_locale: string;
    mfa_enforced: boolean;
    mfa_enrolled: boolean;
    session_expires_at: Date;
  }>('select * from app.session_user($1::text)', [hashToken(token)]);

  if (!row) return null;

  return {
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    timezone: row.timezone,
    locale: row.preferred_locale,
    mfaEnforced: row.mfa_enforced,
    mfaEnrolled: row.mfa_enrolled,
    sessionExpiresAt: row.session_expires_at.toISOString(),
  };
}

/** Exige une session valide, sinon leve une erreur 401. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) {
    throw new AppError('UNAUTHENTICATED', 'Session absente ou expiree', { status: 401 });
  }
  return user;
}

/** Deconnexion : revoque la session en base puis efface le cookie. */
export async function logout(): Promise<boolean> {
  const token = await currentSessionToken();
  if (token) {
    await query('select app.revoke_session($1::text)', [hashToken(token)]);
  }
  await clearSession();
  return true;
}

/** IP et navigateur pour le journal de connexion. */
export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  return {
    ip: forwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null,
    userAgent: h.get('user-agent'),
  };
}
