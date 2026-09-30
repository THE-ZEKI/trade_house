import { asUser, callApp, query, queryOne, queryOneWith, queryWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** RG-06 : le manager ne modifie pas les reglages globaux, l'admin si. */
function requireAdmin(role: string) {
  return jsonOk(
    { error: { code: 'FORBIDDEN', message: 'Reserve a l\'administrateur', rule: 'RG-06' } },
    403,
  ) as unknown as Response;
}

/**
 * GET /api/settings — seuils et reglages globaux
 *
 * Toutes les valeurs viennent de app_settings (table singleton). Aucun seuil
 * n'est code en dur dans l'application : les modifier ici les change partout,
 * sans redeploiement.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const rows = await asUser(user.userId, (sql) =>
      queryWith(sql, 'select * from app.settings()'),
    );
    return jsonOk({ settings: rows[0] ?? null });
  } catch (error) {
    return jsonError(error);
  }
}

/** Champs modifiables, avec leur type et leurs bornes. */
const NUMERIC: Record<string, [number, number]> = {
  late_submission_days: [0, 30],
  correction_critical_days: [0, 30],
  stale_submission_hours: [1, 720],
  max_files_per_report: [1, 50],
  max_screenshot_mb: [1, 50],
  max_pdf_mb: [1, 100],
  default_duration_min: [5, 480],
  attendance_present_ratio: [0, 1],
  late_arrival_minutes: [0, 120],
  room_open_before_minutes: [0, 120],
  room_close_after_minutes: [0, 240],
  invitation_ttl_days: [1, 30],
  reminder_retry_count: [0, 10],
  reminder_retry_minutes: [1, 1440],
  max_login_attempts: [3, 20],
  login_lockout_minutes: [1, 1440],
  max_mfa_attempts: [3, 20],
  mfa_lockout_minutes: [1, 1440],
  retention_recording_months: [1, 120],
  retention_report_months: [1, 120],
};

/**
 * PATCH /api/settings — modification des seuils (RG-06, admin uniquement)
 *
 * Les valeurs sont ecrites avec un UPDATE explicite sur chaque colonne : le
 * nom du champ ne peut pas etre injecte dans la requete, seule la valeur
 * l'est, et toujours comme parametre.
 */
export async function PATCH(request: Request) {
  const raw = await request.json().catch(() => null);
  if (typeof raw !== 'object' || raw === null) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Corps invalide', rule: null } }, 422);
  }
  const b = raw as Record<string, unknown>;

  try {
    const user = await requireUser();
    if (user.role !== 'admin') return requireAdmin(user.role);

    const sets: string[] = [];
    const values: unknown[] = [];

    const add = (column: string, value: unknown, cast = 'numeric') => {
      values.push(value);
      sets.push(`${column} = $${values.length}::${cast}`);
    };

    for (const [key, [min, max]] of Object.entries(NUMERIC)) {
      if (!(key in b)) continue;
      const n = Number(b[key]);
      if (!Number.isFinite(n) || n < min || n > max) {
        return jsonOk(
          { error: { code: 'VALIDATION', message: `${key} hors bornes (${min}..${max})`, rule: null } },
          422,
        );
      }
      add(key, n);
    }

    if ('default_locale' in b) {
      add('default_locale', b.default_locale === 'en' ? 'en' : 'fr', 'varchar');
    }
    if (typeof b.storage_provider === 'string' && ['local', 's3', 'supabase'].includes(b.storage_provider)) {
      add('storage_provider', b.storage_provider, 'varchar');
    }
    if (typeof b.available_locales === 'string' && /^(fr|en)(,(fr|en))*$/.test(b.available_locales)) {
      add('available_locales', b.available_locales, 'varchar');
    }

    if (sets.length === 0) {
      return jsonOk({ error: { code: 'VALIDATION', message: 'Aucun reglage modifiable', rule: null } }, 422);
    }

    const rows = await asUser(user.userId, (sql) =>
      queryWith(sql, `update public.app_settings set ${sets.join(', ')}, updated_at = now() returning *`),
    );
    return jsonOk({ settings: rows[0] ?? null, updated: sets.length });
  } catch (error) {
    return jsonError(error);
  }
}
