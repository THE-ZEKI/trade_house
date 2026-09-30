import { asUser, queryWith, queryOneWith } from '@/lib/db';
import { pageUserAs } from '@/lib/page';
import { t } from '@/lib/i18n';
import Shell from '@/components/Shell';
import { Card, Empty, Badge, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata = { title: "Journal d'audit — Trade House" };

/**
 * Journal des actions sensibles (F5) — administrateur uniquement (RG-06).
 *
 * Affichage en lecture seule et sans aucun formulaire : un journal que l'on
 * peut modifier n'est plus un journal. C'est aussi pour cela que la table est
 * en insertion seule, refusee aux updates comme aux deletes.
 */
export default async function AuditPage() {
  const user = await pageUserAs(['admin']);

  const { entries, total } = await asUser(user.userId, async (sql) => ({
    entries: await queryWith(
      sql,
      `select a.id, a.action, a.entity_type, a.entity_id, a.details,
              a.ip_address, a.created_at,
              au.full_name as actor_name, au.email as actor_email, au.role as actor_role
         from public.audit_log a
         left join public.users au on au.id = a.actor_id
        order by a.created_at desc
        limit 200`,
    ),
    total: await queryOneWith<{ n: number }>(
      sql,
      'select count(*)::int as n from public.audit_log',
    ),
  }));

  const isEn = user.locale === 'en';
  const fmt = (v: unknown) =>
    v
      ? new Date(String(v)).toLocaleString(isEn ? 'en-GB' : 'fr-FR', {
          day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
        })
      : '-';

  return (
    <Shell user={user}>
      <div className="space-y-6">
        <PageHeader
          title={t(user.locale, 'nav.audit')}
          subtitle={`${total?.n ?? entries.length} evenements · lecture seule`}
        />

        <Card>
          {entries.length === 0 ? (
            <Empty>Aucune action enregistree.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-faint">
                    <th className="px-4 py-2 font-medium">Quand</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                    <th className="px-4 py-2 font-medium">Acteur</th>
                    <th className="px-4 py-2 font-medium">Entite</th>
                    <th className="px-4 py-2 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((a) => (
                    <tr key={String(a.id)}>
                      <td className="tnum whitespace-nowrap px-4 py-2.5 text-text-muted">
                        {fmt(a.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <Badge
                          tone={
                            String(a.action).startsWith('user') ? 'info'
                              : String(a.action).startsWith('report') ? 'neutral'
                                : 'neutral'
                          }
                        >
                          {String(a.action)}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        {String(a.actor_name ?? 'systeme')}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-text-muted">
                        {String(a.entity_type ?? '-')}
                      </td>
                      <td className="max-w-md truncate px-4 py-2.5 text-xs text-text-faint">
                        {a.details ? JSON.stringify(a.details) : '-'}
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
