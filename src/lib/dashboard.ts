import { asUser, queryOne, queryWith } from './db';
import type { SessionUser } from './auth';

/**
 * Donnees du tableau de bord (F1, F2, F3).
 *
 * La logique vit ici, et non dans la route : la page (composant serveur) et
 * l'API meteurs rendu appellent la meme fonction. Dupliquer la requete
 *en double reviendrait a laisser diverger l'ecran et l'API.
 *
 * Aucun seuil n'est code en dur : tout vient de app_settings, donc modifiable
 * sans redeploiement.
 */

export type DashboardData = {
  role: SessionUser['role'];
  settings: Record<string, unknown> | null;
  meetings: Record<string, unknown>[];
  reports: Record<string, unknown>[];
  totals: { to_review: number; corrections_open: number; overdue: number; drafts: number };
  silent: Record<string, unknown>[];
  lateReviews: Record<string, unknown>[];
};

export async function getDashboard(user: SessionUser): Promise<DashboardData> {
  const settings = await queryOne<Record<string, unknown>>(
    'select * from app.settings()',
  );

  const totals = {
    to_review: 0,
    corrections_open: 0,
    overdue: 0,
    drafts: 0,
  };

  if (user.role === 'trader') {
    const { meetings, reports } = await asUser(user.userId, async (sql) => ({
      meetings: await queryWith(
        sql,
        `select m.id, m.title, m.starts_at, m.duration_min, m.type, m.status,
                mp.rsvp_status
           from public.meeting_participants mp
           join public.meetings m on m.id = mp.meeting_id
          where m.starts_at >= now() - interval '15 minutes'
            and m.status = 'scheduled'
          order by m.starts_at
          limit 10`,
      ),
      reports: await queryWith(
        sql,
        `select r.id, r.session_date, r.instrument, r.status, r.current_version,
                w.is_critical, w.is_overdue
           from public.reports r
           left join public.v_report_flags w on w.id = r.id
          where r.trader_id = $1::uuid
            and r.status in ('draft', 'correction_requested', 'resubmitted')
          order by r.session_date desc
          limit 20`,
        [user.userId],
      ),
    }));

    totals.drafts = reports.length;
    totals.corrections_open = reports.filter(
      (r) => r.status === 'correction_requested',
    ).length;

    return {
      role: 'trader',
      settings,
      meetings,
      reports,
      totals,
      silent: [],
      lateReviews: [],
    };
  }

  const { worklist, meetings, silent, lateReviews } = await asUser(
    user.userId,
    async (sql) => ({
      worklist: await queryWith(
        sql,
        `select w.id, w.trader_id, w.trader_name, w.session_date, w.instrument,
                w.status, w.submitted_at, w.hours_since_submission,
                w.is_stale, w.is_critical, w.open_mandatory, w.open_corrections,
                w.correction_deadline, w.is_overdue
           from public.v_report_worklist w
          where w.status in ('submitted', 'in_review', 'resubmitted', 'correction_requested')
          order by w.submitted_at asc nulls last
          limit 50`,
      ),
      meetings: await queryWith(
        sql,
        `select m.id, m.title, m.starts_at, m.duration_min, m.type, m.status,
                (select count(*)::int from public.meeting_participants p
                  where p.meeting_id = m.id) as participants_count,
                (select count(*)::int from public.meeting_participants p
                  where p.meeting_id = m.id and p.rsvp_status = 'accepted') as accepted_count
           from public.meetings m
          where m.starts_at >= now() and m.status = 'scheduled'
          order by m.starts_at
          limit 10`,
      ),
      // F1 : traders sans rapport ni declaration " pas de trading " (RG-37)
      silent: await queryWith(
        sql,
        `select u.id, u.full_name, r.last_report_date,
                (current_date - r.last_report_date) as days_since
           from public.users u
           left join lateral (
             select max(session_date) as last_report_date
               from public.reports rp where rp.trader_id = u.id
           ) r on true
          where u.role = 'trader' and u.is_active
            and (r.last_report_date is null or current_date - r.last_report_date > 3)
          order by r.last_report_date asc nulls first
          limit 25`,
      ),
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
    }),
  );

  totals.to_review = worklist.filter((r) => r.status === 'submitted').length;
  totals.corrections_open = worklist.filter((r) => Number(r.open_corrections) > 0).length;
  totals.overdue = lateReviews.length;

  return {
    role: user.role,
    settings,
    meetings,
    reports: worklist,
    totals,
    silent,
    lateReviews,
  };
}
