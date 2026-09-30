import { NextResponse } from 'next/server';
import { toAppError, type AppError } from './errors';

/**
 * Reponses HTTP homogenes.
 * Format d'erreur : { error: { code, message, rule? } }
 *  - code  : catalogue i18n (AppErrorCode)
 *  - rule  : regle du cahier des charges en cause, si la base l'a signalee
 */

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function jsonError(error: unknown) {
  const err: AppError = toAppError(error);
  return NextResponse.json(
    { error: { code: err.code, message: err.message, rule: err.rule ?? null } },
    { status: err.status },
  );
}
