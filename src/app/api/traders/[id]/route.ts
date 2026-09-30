import { asUser, queryWith, queryOneWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/traders/:id — fiche trader (F2)
 *
 * Reunit ce qu'un superviseur veut savoir d'un coup : sa regularite
 * (rapports rendus, taux de validation), sa presence aux reunions, et ce qui
 * est encore en attente de sa part.
 *
 * L'acces est double : le RLS filtre la lecture, et app.can_view_trader
 * verifie que l'appelant a le droit de voir CE trader (RG-04). Un trader qui
 * demanderait sa propre fiche est servi : c'est un cas legitime.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!UUID.test(id)) return notFound();

    const detail = await asUser(user.userId, async (sql) => {
      // RG-04 : le RLS ne garantit que la visibilite, pas l'intention
      const allowed = await queryOneWith<{ ok: boolean }>(
        sql,
        'select app.can_view_trader($1::uuid) as ok',
        [id],
      );
      if (!allowed?.ok) return null;

      const trader = await queryOneWith(
        sql,
        `select u.id, u.full_name, u.email, u.phone, u.timezone, u.is_active,
                u.last_login_at, u.created_at,
                (select count(*)::int from public.reports rp where rp.trader_id = u.id) as reports_total,
                (select count(*)::int from public.reports rp
                  where rp.trader_id = u.id and rp.status = 'validated') as reports_validated,
                (select count(*)::int from public.reports rp
                  where rp.trader_id = u.id and rp.is_late) as reports_late,
                (select count(*)::int from public.report_corrections c
                   join public.reports r2 on r2.id = c.report_id
                  where r2.trader_id = u.id and c.status = 'open') as corrections_open,
                -- F2 : taux de validation, calcule et non stocke
                (select round(100.0 * count(*) filter (where rp.status = 'validated')
                              / nullif(count(*), 0), 1)
                   from public.reports rp where rp.trader_id = u.id) as validation_rate
           from public.users u
          where u.id = $1::uuid`,
        [id],
      );
      if (!trader) return null;

      const reports = await queryWith(
        sql,
        `select r.id, r.session_date, r.instrument, r.result_type, r.result_amount,
                r.rr_planned, r.rr_realized, r.plan_respected, r.status, r.is_late,
                r.current_version, r.submitted_at, r.validated_at,
                w.is_critical, w.is_stale
           from public.reports r
           left join public.v_report_flags w on w.id = r.id
          where r.trader_id = $1::uuid
          order by r.session_date desc
          limit 60`,
        [id],
      );

      // F2 : presence aux reunions (resultat fige par meeting_attendance_result)
      const meetings = await queryWith(
        sql,
        `select m.id, m.title, m.starts_at, m.status, m.type, mp.rsvp_status,
                a.total_seconds, a.first_joined_at, a.status as attendance_status
           from public.meeting_participants mp
           join public.meetings m on m.id = mp.meeting_id
           left join public.meeting_attendance_result a
                  on a.meeting_id = m.id and a.user_id = mp.user_id
          where mp.user_id = $1::uuid and m.starts_at < now()
          order by m.starts_at desc
          limit 30`,
        [id],
      );

      return { trader, reports, meetings };
    });

    if (!detail) return notFound();
    return jsonOk(detail);
  } catch (error) {
    return jsonError(error);
  }
}

function notFound() {
  return jsonOk({ error: { code: 'NOT_FOUND', message: 'Trader introuvable', rule: null } }, 404);
}
