/**
 * Erreurs : la base parle, le back-end traduit.
 *
 * Les exceptions PostgreSQL portent le message métier, toujours préfixé par la
 * règle du cahier des charges (RG-xx). On extrait ce code pour renvoyer au client
 * une erreur structurée, traduisible (RG-53) et testable.
 */

export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  /** Règle du cahier des charges à l'origine (ex. 'RG-43'), si identifiée. */
  readonly rule?: string;

  constructor(code: AppErrorCode, message: string, options: { status?: number; rule?: string } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? defaultStatus(code);
    this.rule = options.rule;
  }
}

function defaultStatus(code: AppErrorCode): number {
  switch (code) {
    case 'UNAUTHENTICATED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'VALIDATION':
      return 422;
    case 'CONFLICT':
      return 409;
    default:
      return 500;
  }
}

const RULE = /RG-\d{2}/;

/** Extrait le code RG du message d'une exception PostgreSQL. */
export function extractRule(message: string): string | undefined {
  return RULE.exec(message)?.[0];
}

/**
 * Traduit une exception PostgreSQL en AppError.
 *
 * Exemple : la base lève
 *   ERREUR:  RG-43 : correctifs obligatoires non traites
 * et l'API renvoie { code: 'CONFLICT', rule: 'RG-43' } avec un message
 * traduisible par next-intl.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const pg = error as { code?: string; message?: string; constraint?: string; detail?: string };
  const message = pg?.message ?? 'Erreur interne';
  const rule = extractRule(message);

  // 23503 clé étrangère, 23505 unicité, 23514 check violated
  switch (pg?.code) {
    case '23505':
      return new AppError('CONFLICT', message, { status: 409, rule });
    case '23503':
      return new AppError('VALIDATION', message, { status: 422, rule });
    case '23514':
      return new AppError('VALIDATION', pg.constraint ?? message, { status: 422, rule });
    case '22023':
    case '22P02':
      return new AppError('VALIDATION', message, { status: 422, rule });
    default:
      break;
  }

  // 42501 = permission denied (RLS) : l'utilisateur n'a pas le droit
  if (pg?.code === '42501') {
    return new AppError('FORBIDDEN', 'Acces refuse', { status: 403, rule });
  }

  // pas de code PG mais un message métier : c'est un RAISE de nos fonctions
  if (rule) {
    return new AppError('CONFLICT', message, { status: 409, rule });
  }

  return new AppError('INTERNAL', message, { status: 500 });
}
