import { asUser, callApp, queryOneWith, queryWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/me — profil et preferences (A4, RG-53)
 *
 * La langue et le fuseau determine le format des dates et des heures affichees
 * : ils sont stockes en valeur IANA/norme (jamais un libelle), et traduits a
 * l'affichage cote interface.
 *
 * Le role, l'email et le manager ne sont PAS modifiables ici : RG-02 reserve
 * ces changements a l'administrateur, via /api/users.
 */
export async function PATCH(request: Request) {
  const raw = await request.json().catch(() => null);
  if (typeof raw !== 'object' || raw === null) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Corps invalide', rule: null } }, 422);
  }
  const b = raw as Record<string, unknown>;

  const fullName = typeof b.fullName === 'string' ? b.fullName.trim() : null;
  if (fullName !== null && (!fullName || fullName.length > 120)) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Nom invalide', rule: null } }, 422);
  }

  const phone = typeof b.phone === 'string' && b.phone.trim() ? b.phone.trim().slice(0, 30) : null;
  const timezone =
    typeof b.timezone === 'string' && /^[A-Za-z]+\/[A-Za-z_]+$/.test(b.timezone) ? b.timezone : null;
  const locale = typeof b.locale === 'string' && ['fr', 'en'].includes(b.locale) ? b.locale : null;

  if (!fullName && phone === null && !timezone && !locale) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Aucun champ modifiable', rule: null } }, 422);
  }

  try {
    const user = await requireUser();

    const account = await asUser(user.userId, async (sql) => {
      // app.update_profile remplace les quatre champs : on relit l'existant pour
      // ne pas effacer ce que l'appelant n'a pas voulu modifier.
      const current = await queryOneWith<{ full_name: string; phone: string | null; timezone: string; preferred_locale: string }>(
        sql,
        'select full_name, phone, timezone, preferred_locale from public.users where id = $1::uuid',
        [user.userId],
      );
      if (!current) throw new Error('Compte introuvable');

      await callApp(sql, 'update_profile', [
        fullName ?? current.full_name,
        phone ?? current.phone,
        timezone ?? current.timezone,
        locale ?? current.preferred_locale,
      ]);

      return queryOneWith(
        sql,
        `select id, email, full_name, phone, role, timezone, preferred_locale,
                mfa_enrolled, mfa_enforced, last_login_at
           from public.users where id = $1::uuid`,
        [user.userId],
      );
    });

    return jsonOk({ account });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * GET /api/me/notifications — cloche (F4)
 * Liste les notifications de l'utilisateur, les plus recentes d'abord.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const p = new URL(request.url).searchParams;
    const unreadOnly = p.get('unreadOnly') === 'true';
    const limit = Math.min(Number.parseInt(p.get('limit') ?? '50', 10) || 50, 200);

    const rows = await asUser(user.userId, (sql) =>
      queryWith(
        sql,
        `select n.id, n.event, n.channel, n.status, n.related_type, n.related_id,
                n.created_at, n.sent_at, n.opened_at, n.read_at, n.error_message
           from public.notifications_log n
          where ($1::boolean = false or n.read_at is null)
            and n.channel in ('in_app','email')
          order by n.created_at desc
          limit $2`,
        [unreadOnly, limit],
      ),
    );

    const unread = await asUser(user.userId, (sql) =>
      queryOneWith<{ n: number }>(
        sql,
        `select count(*)::int as n from public.notifications_log
          where read_at is null and channel = 'in_app'`,
      ),
    );

    return jsonOk({ notifications: rows, unread: unread?.n ?? 0 });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * PATCH /api/me/notifications — marquer comme lu (F4)
 *   body: { ids: [uuid...] } ou { all: true }
 */
export async function PUT(request: Request) {
  const raw = await request.json().catch(() => null);
  if (typeof raw !== 'object' || raw === null) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Corps invalide', rule: null } }, 422);
  }
  const b = raw as Record<string, unknown>;
  const ids = Array.isArray(b.ids) ? (b.ids as unknown[]).filter((x) => typeof x === 'string') : [];
  const all = b.all === true;

  if (!all && ids.length === 0) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Aucune notification indiquee', rule: null } }, 422);
  }

  try {
    const user = await requireUser();
    // le RLS (user_id = current_user) interdit de marquer celles des autres
    const updated = await asUser(user.userId, (sql) =>
      queryWith(
        sql,
        `update public.notifications_log set read_at = now()
          where read_at is null
            and user_id = $1::uuid
            and ($2::boolean = true or id = any($3::uuid[]))
          returning id`,
        [user.userId, all, ids],
      ),
    );
    return jsonOk({ updated: updated.length });
  } catch (error) {
    return jsonError(error);
  }
}
