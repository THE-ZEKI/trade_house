import { asUser, queryWith } from '@/lib/db';
import { pageUserAs } from '@/lib/page';
import { t } from '@/lib/i18n';
import Shell from '@/components/Shell';
import { Card, Empty, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Reglages — Trade House' };

type Row = { key: string; value: string };

/** Rang des groupes : un reglage inconnu atterrit dans « Autres ». */
const GROUPS: { title: string; match: RegExp }[] = [
  { title: 'Rapports et fichiers', match: /report|submission|files|screenshot|pdf|stale|late/i },
  { title: 'Reunions et salle', match: /meeting|duration|attendance|room|video|token/i },
  { title: 'Rappels et invitations', match: /reminder|invitation|retry/i },
  { title: 'Securite', match: /login|mfa|lockout|locale|secret|storage|bucket/i },
];

/** Regles internes : jamais presentees comme reglages, ce ne sont pas des choix. */
const TECHNICAL = new Set(['id', 'updated_at']);

/**
 * Reglages — administrateur, lecture seule pour l'instant.
 *
 * Un ecran sans bouton « Enregistrer » est assume : les seuils et les delais
 * sont des regles metier (RG-37, RG-38). Ils doivent changer par
 * `app.update_settings`, avec controle du role et trace dans le journal — pas
 * par un formulaire libre. Un superviseur doit en revanche pouvoir verifier
 * d'ou viennent les rappels sans ouvrir la base.
 *
 * Les cles sont lues depuis la base (`jsonb_each_text`) et non ecrites en dur :
 * une liste codee en dur deriverait silencieusement a l'ajout d'un reglage.
 */
export default async function SettingsPage() {
  const user = await pageUserAs(['admin']);

  const rows = await asUser(user.userId, (sql) =>
    queryWith<Row>(
      sql,
      `select e.key, e.value
         from app.settings() s, lateral jsonb_each_text(to_jsonb(s)) e
        order by e.key`,
    ),
  );

  const settings = rows.filter((r) => !TECHNICAL.has(r.key));
  const used = new Set<string>();
  const buckets = GROUPS.map((g) => {
    const items = settings.filter((r) => g.match.test(r.key) && !used.has(r.key));
    items.forEach((r) => used.add(r.key));
    return { title: g.title, items };
  }).filter((b) => b.items.length > 0);

  const rest = settings.filter((r) => !used.has(r.key));

  return (
    <Shell user={user}>
      <div className="space-y-6">
        <PageHeader
          title={t(user.locale, 'nav.settings')}
          subtitle="Seuils et delais · modifies en base, jamais depuis un formulaire"
        />

        {settings.length === 0 ? (
          <Card>
            <Empty>Aucun reglage expose.</Empty>
          </Card>
        ) : (
          <>
            {buckets.map((b) => (
              <Card key={b.title} title={b.title}>
                <dl className="divide-y divide-border">
                  {b.items.map((r) => (
                    <div key={r.key} className="flex items-center justify-between gap-4 px-4 py-2.5">
                      <dt className="font-mono text-xs text-text-muted">{r.key}</dt>
                      <dd className="tnum max-w-[50%] truncate text-sm" title={r.value}>
                        {r.value || '-'}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>
            ))}

            {rest.length > 0 && (
              <Card title="Autres reglages">
                <dl className="divide-y divide-border">
                  {rest.map((r) => (
                    <div key={r.key} className="flex items-center justify-between gap-4 px-4 py-2.5">
                      <dt className="font-mono text-xs text-text-muted">{r.key}</dt>
                      <dd className="tnum max-w-[50%] truncate text-sm" title={r.value}>
                        {r.value || '-'}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
