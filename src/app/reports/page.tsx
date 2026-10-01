import Link from 'next/link';import { asUser, queryWith } from '@/lib/db';
import { pageUser } from '@/lib/page';
import { can } from '@/lib/permissions';
import { FilePlus2 } from 'lucide-react';
import { t } from '@/lib/i18n';
import Shell from '@/components/Shell';
import { Card, Empty, StatusBadge, ReportFlags, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Rapports — Trade House' };

/**
 * Liste des rapports — vue unique, declintee par role.
 *
 * Le RLS fait la difference : un trader ne voit que ses propres rapports, un
 * manager la file de revision complete. La vue `v_report_worklist` porte deja
 * les indicateurs calcules (obsolete, critique, en retard), donc on ne les
 * recalcule pas en JavaScript — ils seraient inevitably divergents.
 */
export default async function ReportsPage() {
  const user = await pageUser();
  const isTrader = user.role === 'trader';

  const rows = await asUser(user.userId, (sql) =>
    queryWith(
      sql,
      isTrader
        ? `select r.id, r.session_date, r.instrument, r.status, r.current_version,
                  r.submitted_at, r.result_type, r.result_amount
             from public.reports r
            where r.trader_id = $1::uuid
            order by r.session_date desc
            limit 100`
        : `select w.id, w.trader_id, w.trader_name, w.session_date, w.instrument,
                  w.status, w.submitted_at, w.hours_since_submission,
                  w.is_stale, w.is_critical, w.open_corrections, w.is_overdue
             from public.v_report_worklist w
            order by w.submitted_at asc nulls last, w.session_date desc
            limit 100`,
      isTrader ? [user.userId] : [],
    ),
  );

  const isEn = user.locale === 'en';
  const fmtDate = (v: unknown) =>
    v ? new Date(String(v)).toLocaleDateString(isEn ? 'en-GB' : 'fr-FR') : '-';

  return (
    <Shell user={user}>
      <div className="space-y-6">
        <PageHeader
          title={t(user.locale, 'nav.reports')}
          subtitle={
            isTrader
              ? 'Vos rapports de session'
              : 'File de revision, du plus ancien au plus recent'
          }
          actions={
            can(user, 'report.create') ? (
              <Link
                href="/reports/new"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-sky-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-600"
              >
                <FilePlus2 className="h-4 w-4" strokeWidth={2.5} />
                {t(user.locale, 'action.new_report')}
              </Link>
            ) : null
          }
        />

        <Card>
          {rows.length === 0 ? (
            <Empty>{t(user.locale, 'empty.reports')}</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-faint">
                    <th className="px-4 py-2 font-medium">Session</th>
                    {!isTrader && <th className="px-4 py-2 font-medium">Trader</th>}
                    <th className="px-4 py-2 font-medium">Statut</th>
                    <th className="px-4 py-2 font-medium">Depot</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={String(r.id)}>
                      <td className="tnum whitespace-nowrap px-4 py-3">
                        {fmtDate(r.session_date)}
                        {r.instrument ? (
                          <span className="ml-1.5 text-text-faint">{String(r.instrument)}</span>
                        ) : null}
                      </td>
                      {!isTrader && (
                        <td className="px-4 py-3">{String(r.trader_name ?? '')}</td>
                      )}
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={String(r.status)} locale={user.locale} />
                          <ReportFlags
                            locale={user.locale}
                            isCritical={r.is_critical === true}
                            isLate={r.is_overdue === true}
                            isStale={r.is_stale === true}
                          />
                        </div>
                      </td>
                      <td className="tnum whitespace-nowrap px-4 py-3 text-text-muted">
                        {r.submitted_at
                          ? fmtDate(r.submitted_at)
                          : Number(r.hours_since_submission) > 0
                            ? `${Math.round(Number(r.hours_since_submission))} h`
                            : '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/reports/${r.id}`}
                          className="text-xs text-accent hover:underline"
                        >
                          {t(user.locale, 'action.view')}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </Shell>
  );
}
