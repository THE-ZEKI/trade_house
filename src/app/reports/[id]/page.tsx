import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asUser, queryOneWith, queryWith } from '@/lib/db';
import { pageUser } from '@/lib/page';
import { t } from '@/lib/i18n';
import { can } from '@/lib/permissions';
import Shell from '@/components/Shell';
import { Card, Empty, StatusBadge, ReportFlags, PlanBadge, CodeBadge, PageHeader, Badge } from '@/components/ui';
import { SEVERITY, CORRECTION_STATUS } from '@/lib/status';
import { Layers, MessageSquareWarning } from 'lucide-react';
import ReportActions from '@/components/ReportActions';
import AddCorrection from '@/components/AddCorrection';
import FileUploader from '@/components/FileUploader';
import AnnotationEditor, { type Annotation } from '@/components/AnnotationEditor';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Champs corrigibles d'un rapport.
 *
 * Cette liste est la seule source des cibles « un champ precis » proposees au
 * manager. Elle est ecrite a la main plutot que deduite de information_schema :
 * le RLS interdit a l'application de consulter le catalogue, et surtout une
 * cible affichee doit etre un champ reellement comprehensible par le trader.
 * Une colonne technique apparaitrait ici sans qu'aucun trader ne sache de quoi
 * elle parle.
 */
const REPORT_FIELDS = [
  'instrument',
  'result_type',
  'result_amount',
  'strategy',
  'nb_trades',
  'plan_respected',
  'rr_planned',
  'rr_realized',
  'emotions',
  'highlights',
  'mistakes',
  'notes',
];

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

  const { report, versions, corrections, files, annotations } = await asUser(user.userId, async (sql) => ({
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
files: await queryWith<{
      id: string;
      kind: 'screenshot' | 'pdf';
      original_name: string;
      mime_type: string;
      size_bytes: string;
      created_at: string;
    }>(
      sql,
      `select f.id, f.kind, f.original_name, f.mime_type, f.size_bytes, f.created_at
         from public.report_files f
        where f.report_id = $1::uuid
        order by f.created_at`,
      [id],
    ),
    // Les annotations sont regroupees par fichier pour que l editeur soit rendu
    // cote serveur, sans un aller-retour par capture.
    annotations: await queryWith<{
      id: string;
      file_id: string;
      shape: 'rectangle' | 'circle' | 'arrow' | 'freehand' | 'text';
      data: Record<string, unknown>;
      correction_id: string | null;
      created_at: string;
      author: string | null;
    }>(
      sql,
      `select a.id, a.file_id, a.shape, a.data, a.correction_id, a.created_at,
              u.full_name as author
         from public.file_annotations a
         left join public.users u on u.id = a.author_id
         join public.report_files f on f.id = a.file_id
        where f.report_id = $1::uuid
        order by a.created_at`,
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

  // Un correctif est « ouvert » au sens du tableau de bord tant qu'il n'a pas
// ete traite. L'enum est open | done | rejected | dropped : un statut
// inexistant comme « resolved » ne serait jamais compare, et les correctifs
// traites continueraient d'etre comptes comme ouverts.
const openCorrections = corrections.filter((c) => c.status === 'open').length;

  // RG-31 : le rapport n'est modifiable que tant qu'il est chez le trader.
  const modifiable = report.status === 'draft' || report.status === 'correction_requested';
  const ownReport = report.trader_id === user.userId;
  const canUpload = modifiable && ownReport;
  const canAnnotate = can(user, 'report.annotate');

  // Regroupement des annotations par fichier pour l editeur.
  const byFile = new Map<string, Annotation[]>();
  for (const a of annotations) {
    const key = String(a.file_id);
    const list = byFile.get(key) ?? [];
    list.push(a);
    byFile.set(key, list);
  }

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
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="grid content-start gap-4">
          <Card title="Pieces jointes">
            <div className="px-4 py-4">
              <FileUploader
                user={user}
                reportId={id}
                files={files}
                canUpload={canUpload}
              />
            </div>
          </Card>

          {/* L editeur n existe que s'il y a une capture a annoter : un cadre vide
              n apprendrait rien au lecteur. */}
          {files.length > 0 && (
            <Card title="Annotations sur les captures">
              <div className="space-y-4 px-4 py-4">
                {files.map(
                  (f) =>
                    f.kind === 'screenshot' ? (
                      <AnnotationEditor
                        key={f.id}
                        fileId={f.id}
                        fileName={f.original_name}
                        mimeType={f.mime_type}
                        initial={byFile.get(f.id) ?? []}
                        canAnnotate={canAnnotate}
                      />
                    ) : null,
                )}
              </div>
            </Card>
          )}

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

        <Card title="Correctifs">
          {corrections.length === 0 ? (
            <Empty>Aucun correctif.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {corrections.map((c) => (
                <li key={String(c.id)} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <CodeBadge table={SEVERITY} code={c.severity} locale={user.locale} prefix="severity" />
                    <span className="text-sm">{String(c.target_field ?? c.target_type ?? "")}</span>
                    <CodeBadge table={CORRECTION_STATUS} code={c.status} locale={user.locale} prefix="correction" />
                    <span className="tnum ml-auto text-xs text-text-faint">{fmt(c.created_at)}</span>
                  </div>
                  <p className="mt-1.5 text-sm">{String(c.message ?? "")}</p>
                  {c.trader_reply ? (
                    <p className="mt-1 text-xs text-text-muted">Reponse : {String(c.trader_reply)}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-border p-4">
            <AddCorrection user={user} reportId={String(report.id)} />
          </div>
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
          <div className="lg:sticky lg:top-20 lg:self-start">
            <Card title="Actions">
              <div className="p-4">
                <ReportActions
                  user={user}
                  reportId={String(report.id)}
                  status={String(report.status)}
                  files={files.map((f) => ({ id: f.id, original_name: f.original_name }))}
                  fields={REPORT_FIELDS}
                />
              </div>
            </Card>
          </div>
        </div>
      </div>
    </Shell>
  );
}
