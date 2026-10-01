import { notFound } from 'next/navigation';
import { asUser, queryOneWith, queryWith } from '@/lib/db';
import { pageUserAs } from '@/lib/page';
import { t } from '@/lib/i18n';
import Shell from '@/components/Shell';
import { Card, Empty, PageHeader, Stat, PlanBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Fiche d'un trader — reservee aux roles de supervision (RG-06).
 *
 * Un trader n'a pas de « fiche » de lui-meme : c'est un outil de coaching
 * reserve au manager et a l'administrateur. `pageUserAs` renvoie le trader vers
 * l'accueil ; le RLS ferait le reste en l'absence du controle applicatif.
 *
 * Le taux de respect du plan est un chiffre cle du coaching : c'est
 * l'indicateur que le manager suit en premier.
 */
export default async function TraderPage({ params }: Params) {
  const user = await pageUserAs(['admin', 'manager']);
  const { id } = await params;

  const { trader, stats, recent } = await asUser(user.userId, async (sql) => ({
    trader: await queryOneWith<Record<string, unknown>>(
      sql,
      `select u.id, u.email, u.full_name, u.role, u.is_active, u.phone,
              u.timezone, u.mfa_enrolled, u.last_login_at, u.created_at,
              m.full_name as manager_name
         from public.users u
         left join public.users m on m.id = u.manager_id
        where u.id = $1::uuid`,
      [id],
    ),
    stats: await queryOneWith<Record<string, unknown>>(
      sql,
      `select count(*)::int as total,
              count(*) filter (where plan_respected)::int as plan_ok,
              count(*) filter (where status = 'validated')::int as validated,
              count(*) filter (where is_late)::int as late,
              avg(coalesce(rr_planned, rr_realized))::numeric(10,2) as avg_rr
         from public.reports
        where trader_id = $1::uuid`,
      [id],
    ),
    recent: await queryWith(
      sql,
      `select r.id, r.session_date, r.status, r.plan_respected, r.rr_realized,
              r.instrument
         from public.reports r
        where r.trader_id = $1::uuid
        order by r.session_date desc
        limit 12`,
      [id],
    ),
  }));

  if (!trader) notFound();

  const total = Number(stats?.total ?? 0);
  const planOk = Number(stats?.plan_ok ?? 0);
  const ratio = total > 0 ? Math.round((planOk / total) * 100) : 0;

  const isEn = user.locale === 'en';
  const fmtDate = (v: unknown) =>
    v ? new Date(String(v)).toLocaleDateString(isEn ? 'en-GB' : 'fr-FR') : '-';

  return (
    <Shell user={user}>
      <div className="space-y-6">
        <PageHeader
          title={String(trader.full_name)}
          subtitle={String(trader.email)}
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Rapports" value={total} />
          <Stat
            label="Plan respecte"
            value={`${ratio}%`}
            tone={total > 0 && ratio < 60 ? 'warn' : 'neutral'}
          />
          <Stat label="Valides" value={String(stats?.validated ?? 0)} />
          <Stat
            label="Depots en retard"
            value={String(stats?.late ?? 0)}
            tone={Number(stats?.late ?? 0) > 0 ? 'danger' : 'neutral'}
          />
        </div>

        <Card title="Compte">
          <dl className="divide-y divide-border">
            {(
              [
                ['Role', t(user.locale, `role.${trader.role}`)],
                ['Manager', trader.manager_name],
                ['Etat', trader.is_active ? 'actif' : 'desactive'],
                ['2FA', trader.mfa_enrolled ? 'activee' : 'inactive'],
                ['Derniere connexion', fmtDate(trader.last_login_at)],
                ['Membre depuis', fmtDate(trader.created_at)],
                ['Ratio R moyen', stats?.avg_rr ? String(stats.avg_rr) : '-'],
              ] as [string, unknown][]
            ).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <dt className="text-sm text-text-muted">{k}</dt>
                <dd className="text-sm">{v ? String(v) : '-'}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Rapports recents">
          {recent.length === 0 ? (
            <Empty>Aucun rapport depose.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((r) => (
                <li key={String(r.id)} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="tnum text-sm">{fmtDate(r.session_date)}</span>
                  <div className="flex items-center gap-1.5">
                    <PlanBadge respected={r.plan_respected === true} locale={user.locale} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Shell>
  );
}
