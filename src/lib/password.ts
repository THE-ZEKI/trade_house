import bcrypt from 'bcryptjs';
import { queryOne } from './db';
import { AppError } from './errors';

/**
 * Mots de passe — RG-60 (hachage) et RG-65 (>= 8 caracteres, un chiffre,
 * un caractere special).
 *
 * La regle de complexite est appliquee ici ET en base
 * (app.fn_password_meets_policy) : la base reste le juge de reference.
 */

const BCRYPT_ROUNDS = Number.parseInt(process.env.BCRYPT_ROUNDS ?? '10', 10);

/** Nombre de travail bcrypt ; on refuse une valeur faible en production. */
function rounds(): number {
  if (process.env.NODE_ENV === 'production' && BCRYPT_ROUNDS < 10) {
    throw new Error('BCRYPT_ROUNDS doit etre >= 10 en production');
  }
  return Math.min(Math.max(BCRYPT_ROUNDS, 10), 15);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, rounds());
}

export function checkPasswordPolicy(password: string): boolean {
  return password.length >= 8 && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
}

/**
 * Verifie la regle cote base : c'est la meme fonction que celle utilisee par les
 * tests SQL, on ne peut donc pas diverger entre l'API et la base.
 */
export async function assertPasswordPolicy(password: string): Promise<void> {
  if (!checkPasswordPolicy(password)) {
    throw new AppError('VALIDATION', 'Mot de passe trop faible : 8 caracteres, un chiffre et un caractere special', {
      status: 422,
      rule: 'RG-65',
    });
  }
  const dbSays = await queryOne<{ ok: boolean }>(
    'select app.fn_password_meets_policy($1::text) as ok',
    [password],
  );
  if (dbSays && !dbSays.ok) {
    throw new AppError('VALIDATION', 'Mot de passe refuse par la base', {
      status: 422,
      rule: 'RG-65',
    });
  }
}
