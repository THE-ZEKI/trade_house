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

/**
 * PATCH /api/settings — modification des seuils (RG-06, admin uniquement)
 *
 * L'ecran etait en lecture seule : la validation etait ici, cote API, et
 * jamais appellee. Ce qui est pire, un UPDATE direct ecrivait dans app_settings
 * sans journal ni `updated_by` : un changement de regle de securite n etait
 * donc pas tracable (RG-63).
 *
 * Tout passe maintenant par app.update_settings(), qui :
 *   - refuse une cle absente du catalogue ;
 *   - verifie le type et les bornes ;
 *   - journalise l avant et l apres.
 *
 * Les bornes ne sont donc PAS redefinies ici : elles vivent en base. Les
 * dupliquer dans l API les ferait diverger, et c est precisement le piege que
 * la regle « les regles vivent en base » cherche a eviter.
 */
export async function PATCH(request: Request) {
  const raw = await request.json().catch(() => null);
  if (typeof raw !== 'object' || raw === null) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Corps invalide', rule: null } }, 422);
  }
  const patch = raw as Record<string, unknown>;

  try {
    const user = await requireUser();
    if (user.role !== 'admin') return requireAdmin(user.role);

    const keys = Object.keys(patch);
    if (keys.length === 0) {
      return jsonOk({ error: { code: 'VALIDATION', message: 'Aucun reglage modifiable', rule: null } }, 422);
    }

    // Le refus vient de la base : le message est celui de app.update_settings,
    // pas un texte concurrent ecrit ici.
    await asUser(user.userId, (sql) =>
      callApp(sql, 'app.update_settings', [JSON.stringify(patch)]),
    );

    const rows = await asUser(user.userId, (sql) =>
      queryWith(sql, 'select * from app.settings()'),
    );
    return jsonOk({ settings: rows[0] ?? null, updated: keys.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    // Les bornes sont refusees par la base : on renvoie 422 avec son message,
    // et non une erreur generique que l administrateur ne peut pas comprendre.
    if (/hors bornes|inconnu|non modifiable|langue invalide/i.test(message)) {
      return jsonOk({ error: { code: 'VALIDATION', message, rule: null } }, 422);
    }
    return jsonError(error);
  }
}
