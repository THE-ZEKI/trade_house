import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asUser, queryOneWith, queryWith } from '@/lib/db';
import { pageUser } from '@/lib/page';
import { t } from '@/lib/i18n';
import Shell from '@/components/Shell';
import { Card, Empty, StatusBadge, ReportFlags, PlanBadge, CodeBadge, PageHeader, Badge } from '@/components/ui';
import { RESULT_TYPE } from '@/lib/status';
import { Layers, MessageSquareWarning } from 'lucide-react';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Detail d'un rapport : versions, correctifs, decisions.
 *
 * `notFound()` sur absence. C'est volontaire : repondre « 500 » ou une page
 * vide laisserait croire que le rapport existe. Le RLS fait qu'un trader qui
 * force l'URL d'un rapport d'un autre ne voit aucune ligne — l'identifiant
 * n'existe pas pour lui, et l'interface doit le dire honnetement.
 */
export default async function ReportDetail({ params }: Params) {
  const user = await pageUser();
  const { id } = await params;

  const { report, versions, corrections } = await asUser(user.userId, async (sql) => ({
    report: await queryOneWith<Record<string, unknown>>(
      sql,
      `select r.*, u.full_name as trader_name
         from public.reports r
         join public.users u on u.id = r.trader_id
        where r.id = $1::uuid`,
      [id],
    ),
    versions: await queryWith(
      sql,
      `select v.id, v.version_number, v.submitted_at, u.full_name as author
         from public.report_versions v
         left join public.users u on u.id = v.submitted_by
        where v.report_id = $1::uuid
        order by v.version_number desc`,
      [id],
    ),
    corrections: await queryWith(
      sql,
      `select c.id, c.target_type, c.target_field, c.message, c.severity, c.status,
              c.trader_reply, c.created_at, u.full_name as author
         from public.report_corrections c
         left join public.users u on u.id = c.author_id
        where c.report_id = $1::uuid
        order by c.created_at`,
      [id],
    ),
  }));

  if (!report) notFound();

  const isEn = user.locale === 'en';
  const fmt = (v: unknown) =>
    v
      ? new Date(String(v)).toLocaleString(isEn ? 'en-GB' : 'fr-FR', {
          day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
        })
      : '-';

  const openCorrections = corrections.filter(
    (c) => c.status !== 'resolved' && c.status !== 'rejected',
  ).length;

  return (
    <Shell user={user}>
      <div className="space-y-6">
        <PageHeader
          title={`Rapport du ${fmt(report.session_date)}`}
          subtitle={String(report.trader_name ?? '')}
          actions={
            <Link href="/reports" className="text-xs text-accent hover:underline">
              {t(user.locale, 'nav.reports')}
            </Link>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={String(report.status)} locale={user.locale} />
          <ReportFlags
            locale={user.locale}
            isLate={report.is_late === true}
            isCritical={report.is_critical === true}
            isStale={report.is_stale === true}
          />
          <Badge tone="info" Icon={Layers}>version {String(report.current_version ?? 1)}</Badge>
          {report.plan_respected !== null && report.plan_respected !== undefined && (
            <PlanBadge respected={report.plan_respected === true} locale={user.locale} />
          )}
          {openCorrections > 0 && (
            <Badge tone="danger" Icon={MessageSquareWarning}>{openCorrections} correctif(s)</Badge>
          )}
        <div className="grid gap-4 lg:grid-cols-2">
        </div>
          <Card title="Donnees de session">
            <dl className="divide-y divide-border">
              {(
                [
                  ['Instrument', report.instrument],
                  ['Resultat', report.result_type],
                  ['Montant', report.result_amount],
                  ['Nombre de trades', report.nb_trades],
                  ['Ratio R prevu', report.rr_planned],
                  ['Ratio R reel', report.rr_realized],
                  ['Depose le', fmt(report.submitted_at)],
                  ['Echeance correctifs', fmt(report.correction_deadline)],
                ] as [string, unknown][]
              ).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <dt className="text-sm text-text-muted">{k}</dt>
                  <dd className="tnum text-sm">
                    {v === null || v === undefined || v === '' ? '-' : String(v)}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="Contexte">
            <div className="space-y-3 px-4 py-3 text-sm">
              <div>
                <div className="text-xs text-text-faint">Strategie</div>
                <p>{report.strategy ? String(report.strategy) : '-'}</p>
              </div>
              <div>
                <div className="text-xs text-text-faint">Emotions</div>
                <p>{report.emotions ? String(report.emotions) : '-'}</p>
              </div>
              <div>
                <div className="text-xs text-text-faint">Reussites</div>
                <p className="whitespace-pre-wrap">{report.highlights ? String(report.highlights) : '-'}</p>
              </div>
              <div>
                <div className="text-xs text-text-faint">Erreurs</div>
                <p className="whitespace-pre-wrap">{report.mistakes ? String(report.mistakes) : '-'}</p>
              </div>
              {report.no_trade_reason ? (
                <div>
                  <div className="text-xs text-text-faint">Motif « pas de trading »</div>
                  <p>{String(report.no_trade_reason)}</p>
                </div>
              ) : null}
            </div>
          </Card>
        </div>

        <Card title="Correctifs">
          {corrections.length === 0 ? (
            <Empty>Aucun correctif.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {corrections.map((c) => (
                <li key={String(c.id)} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={c.severity === 'major' ? 'danger' : c.severity === 'minor' ? 'warn' : 'info'}
                    >
                      {String(c.severity ?? 'info')}
                    </Badge>
                    <span className="text-sm">{String(c.target_field ?? c.target_type)}</span>
                    <Badge tone={c.status === 'resolved' ? 'success' : 'neutral'}>
                      {String(c.status)}
                    </Badge>
                    <span className="tnum ml-auto text-xs text-text-faint">{fmt(c.created_at)}</span>
                  </div>
                  <p className="mt-1.5 text-sm">{String(c.message ?? '')}</p>
                  {c.trader_reply ? (
                    <p className="mt-1 text-xs text-text-muted">Reponse : {String(c.trader_reply)}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Versions">
          {versions.length === 0 ? (
            <Empty>Aucune version enregistree.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {versions.map((v) => (
                <li key={String(v.id)} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm">
                    Version {String(v.version_number)}
                    <span className="ml-2 text-xs text-text-faint">{String(v.author ?? '')}</span>
                  </span>
                  <span className="tnum text-xs text-text-faint">{fmt(v.submitted_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Shell>
  );
}
