import { asUser, query, queryOne, queryOneWith, queryWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard — tableau de bord (F1, F3)
 *
 * Une seule route, deux lectures : le role decide de ce qui est renvoye, car
 * un trader n'a rien a faire d'une file de revision qui ne le concerne pas.
 *
 *   admin / manager : reunions a venir, rapports a reviser, corrections en
 *                     retard, traders sans rapport depuis X jours (F1)
 *   trader          : prochaines reunions, rapports a completer, correctifs
 *                     a traiter (F3)
 *
 * Les seuils viennent de app_settings : les changer en base suffit, sans
 * redéployer. Aucun seuil n'est codé en dur ici.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const settings = await queryOne<{
      stale_submission_hours: number;
      correction_critical_days: number;
      room_open_before_minutes: number;
    }>('select stale_submission_hours, correction_critical_days, room_open_before_minutes from app.settings()');

    if (user.role === 'trader') {
      const { meetings, items } = await asUser(user.userId, async (sql) => ({
        meetings: await queryWith(
          sql,
          `select m.id, m.title, m.starts_at, m.duration_min, m.type, m.status,
                  mp.rsvp_status,
                  (select ml.url from public.meeting_links ml
                    where ml.meeting_id = m.id and ml.is_current) as link_url
             from public.meeting_participants mp
             join public.meetings m on m.id = mp.meeting_id
            where m.starts_at >= now() - interval '15 minutes'
              and m.status = 'scheduled'
            order by m.starts_at
            limit 10`,
        ),
        items: await queryWith(
          sql,
          `select * from public.v_trader_open_items where user_id = $1::uuid`,
          [user.userId],
        ),
      }));

      // rapports a completer : ecrits mais pas encore soumis
      const drafts = await asUser(user.userId, (sql) =>
        queryWith(
          sql,
          `select id, session_date, instrument, result_type, status, updated_at
             from public.reports
            where status in ('draft','correction_requested')
            order by session_date desc
            limit 20`,
        ),
      );

      return jsonOk({ role: 'trader', meetings, drafts, open: items[0] ?? null, settings });
    }

    // --- admin / manager ---------------------------------------------------
    const { worklist, meetings, silent, lateReviews } = await asUser(user.userId, async (sql) => ({
      // F1 : rapports a examiner, les plus anciens d'abord
      worklist: await queryWith(
        sql,
        `select w.id, w.trader_id, w.trader_name, w.session_date, w.instrument,
                w.status, w.submitted_at, w.hours_since_submission,
                w.is_stale, w.is_critical, w.open_mandatory, w.open_corrections,
                w.correction_deadline, w.is_overdue
           from public.v_report_worklist w
          where w.status in ('submitted','in_review','resubmitted','correction_requested')
          order by w.submitted_at asc nulls last
          limit 50`,
      ),
      meetings: await queryWith(
        sql,
        `select m.id, m.title, m.starts_at, m.duration_min, m.type, m.status,
                (select count(*)::int from public.meeting_participants p
                  where p.meeting_id = m.id) as participants_count,
                (select count(*)::int from public.meeting_participants p
                  join public.users pu on pu.id = p.user_id
                 where p.meeting_id = m.id and p.rsvp_status = 'accepted') as accepted_count
           from public.meetings m
          where m.starts_at >= now() and m.status = 'scheduled'
          order by m.starts_at
          limit 10`,
      ),
      // F1 : traders sans rapport ni declaration « pas de trading » (RG-37)
      silent: await queryWith(
        sql,
        `select u.id, u.full_name, u.email, r.last_report_date,
                (current_date - r.last_report_date) as days_since
           from public.users u
           left join lateral (
             select max(session_date) as last_report_date
               from public.reports rp where rp.trader_id = u.id
           ) r on true
          where u.role = 'trader' and u.is_active
            and (r.last_report_date is null
                 or current_date - r.last_report_date > 3)
          order by r.last_report_date asc nulls first
          limit 25`,
      ),
      // corrections echues : relance necessaire
      lateReviews: await queryWith(
        sql,
        `select w.id as report_id, w.trader_id, w.trader_name, w.correction_deadline,
                w.open_mandatory, w.is_critical
           from public.v_report_worklist w
          where w.correction_deadline is not null
            and w.correction_deadline < now()
            and w.open_mandatory > 0
          order by w.correction_deadline
          limit 25`,
      ),
    }));

    const totals = await asUser(user.userId, (sql) =>
      queryOneWith<{ to_review: number; corrections_open: number; overdue: number }>(
        sql,
        `select
           (select count(*)::int from public.v_report_worklist
             where status in ('submitted','resubmitted')) as to_review,
           (select count(*)::int from public.v_report_worklist
             where open_corrections > 0) as corrections_open,
           (select count(*)::int from public.v_report_worklist
             where correction_deadline is not null
               and correction_deadline < now() and open_mandatory > 0) as overdue`,
      ),
    );

    return jsonOk({ role: user.role, totals, worklist, meetings, silent, lateReviews, settings });
  } catch (error) {
    return jsonError(error);
  }
}
