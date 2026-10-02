import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getDashboard } from '@/lib/dashboard';
import { t } from '@/lib/i18n';
import Shell from '@/components/Shell';
import { Card, Empty, Stat, StatusBadge, ReportFlags, RsvpBadge} from '@/components/ui';
import { ClipboardCheck, MessageSquareWarning, ClockAlert, UserX, FileText } from 'lucide-react';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Tableau de bord — Trade House' };

/**
 * Tableau de bord (F1 pour admin/manager, F3 pour trader).
 *
 * Composant serveur : les donnees sont lues en base dans le contexte de
 * l'utilisateur, jamais via fetch sur notre propre API. L'API reste ouverte
 * pour un client mobile ou une integration tierce.
 */
export default async function Home() {
  let user: Awaited<ReturnType<typeof currentUser>> = null;
  try {
    user = await currentUser();
  } catch {
    redirect('/login');
  }
  if (!user) redirect('/login');

  const data = await getDashboard(user);
  const isTrader = user.role === 'trader';
  const isEn = user.locale === 'en';

  const fmtDate = (v: unknown) =>
    v ? new Date(String(v)).toLocaleDateString(isEn ? 'en-GB' : 'fr-FR') : '-';
  const fmtWhen = (v: unknown) =>
    v
      ? new Date(String(v)).toLocaleString(isEn ? 'en-GB' : 'fr-FR', {
          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        })
      : '-';

  return (
    <Shell user={user}>
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">{t(user.locale, 'nav.dashboard')}</h1>
          <p className="mt-0.5 text-sm text-text-muted">
            {user.fullName} — {t(user.locale, `role.${user.role}`)}
          </p>
        </header>

        {/* Chiffres cles : ce qu'un superviseur veut voir sans cliquer. Le
            sous-texte porte la REGLE, pas une precision : c'est ce qui
            transforme un chiffre en information. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {isTrader ? (
            <>
              <Stat
                label={t(user.locale, 'dash.my_drafts')}
                value={data.totals.drafts}
                Icon={FileText}
              />
              <Stat
                label={t(user.locale, 'dash.my_corrections')}
                value={data.totals.corrections_open}
                tone={data.totals.corrections_open > 0 ? 'warn' : 'neutral'}
                Icon={MessageSquareWarning}
              />
            </>
          ) : (
            <>
              <Stat
                label={t(user.locale, 'dash.to_review')}
                value={data.totals.to_review}
                href="/reports"
                Icon={ClipboardCheck}
              />
              <Stat
                label={t(user.locale, 'dash.corrections')}
                value={data.totals.corrections_open}
                tone={data.totals.corrections_open > 0 ? 'warn' : 'neutral'}
                Icon={MessageSquareWarning}
              />
              <Stat
                label={t(user.locale, 'dash.overdue')}
                value={data.totals.overdue}
                tone={data.totals.overdue > 0 ? 'danger' : 'neutral'}
                Icon={ClockAlert}
              />
              <Stat
                label={t(user.locale, 'dash.silent')}
                value={data.silent.length}
                Icon={UserX}
              />
            </>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* File de revision, ou rapports a traiter pour le trader */}
          <Card
            title={isTrader ? t(user.locale, 'dash.my_drafts') : t(user.locale, 'dash.to_review')}
            action={
              <Link href="/reports" className="text-xs text-accent hover:underline">
                {t(user.locale, 'action.view')}
              </Link>
            }
          >
            {data.reports.length === 0 ? (
              <Empty>{t(user.locale, 'empty.reports')}</Empty>
            ) : (
              <ul className="divide-y divide-border">
                {data.reports.slice(0, 8).map((r) => (
                  <li key={String(r.id)} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <Link href={`/reports/${r.id}`} className="block truncate text-sm hover:underline">
                        {fmtDate(r.session_date)}
                        {r.instrument ? ` · ${String(r.instrument)}` : ''}
                      </Link>
                      <div className="tnum mt-0.5 text-xs text-text-faint">
                        {String(r.trader_name ?? '')}
                        {r.hours_since_submission ? ` · ${Math.round(Number(r.hours_since_submission))} h` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      <ReportFlags
                        locale={user.locale}
                        isCritical={r.is_critical === true}
                        isLate={r.is_overdue === true}
                        isStale={r.is_stale === true}
                      />
                      <StatusBadge status={String(r.status)} locale={user.locale} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t(user.locale, 'dash.upcoming')}>
            {data.meetings.length === 0 ? (
              <Empty>{t(user.locale, 'empty.meetings')}</Empty>
            ) : (
              <ul className="divide-y divide-border">
                {data.meetings.map((m) => (
                  <li key={String(m.id)} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <Link href={`/meetings/${m.id}`} className="block truncate text-sm hover:underline">
                        {String(m.title)}
                      </Link>
                      <div className="tnum mt-0.5 text-xs text-text-faint">{fmtWhen(m.starts_at)}</div>
                    </div>
                    {isTrader ? (
                      <RsvpBadge status={m.rsvp_status} locale={user.locale} />
                    ) : (
                      <span className="tnum shrink-0 text-xs text-text-faint">
                        {String(m.accepted_count ?? 0)}/{String(m.participants_count ?? 0)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* F1 : les silences. L'indicateur qui declenche une relance. */}
        {!isTrader && data.silent.length > 0 && (
          <Card title="Traders sans rapport recent">
            <ul className="divide-y divide-border">
              {data.silent.slice(0, 6).map((s) => (
                <li key={String(s.id)} className="flex items-center justify-between gap-3 px-4 py-3">
                  <Link href={`/traders/${s.id}`} className="truncate text-sm hover:underline">
                    {String(s.full_name)}
                  </Link>
                  <span className="tnum shrink-0 text-xs text-warn">
                    {s.last_report_date ? `${Number(s.days_since)} j` : 'jamais'}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </Shell>
  );
}
