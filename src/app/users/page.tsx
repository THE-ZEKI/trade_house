import Link from 'next/link';
import { asUser, queryWith } from '@/lib/db';
import { pageUserAs } from '@/lib/page';
import { t } from '@/lib/i18n';
import Shell from '@/components/Shell';
import { Card, Empty, Badge, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Comptes — Trade House' };

/**
 * Comptes utilisateurs — administrateur uniquement (RG-06).
 *
 * `pageUserAs(['admin'])` renvoie un manager vers l'accueil. Ce n'est qu'un
 * confort : meme en forçant l'URL, le RLS ne renverrait aucune ligne.
 */
export default async function UsersPage() {
  const user = await pageUserAs(['admin']);

  const users = await asUser(user.userId, (sql) =>
    queryWith(
      sql,
      `select u.id, u.email, u.full_name, u.role, u.is_active,
              u.mfa_enrolled, u.invited_at, u.last_login_at, u.created_at,
              u.anonymized_at,
              (select count(*)::int from public.reports r where r.trader_id = u.id) as reports_count,
              (select count(*)::int from public.meeting_participants mp where mp.user_id = u.id) as meetings_count,
              m.full_name as manager_name
         from public.users u
         left join public.users m on m.id = u.manager_id
        order by u.role, u.full_name`,
    ),
  );

  const isEn = user.locale === 'en';
  const fmt = (v: unknown) =>
    v ? new Date(String(v)).toLocaleDateString(isEn ? 'en-GB' : 'fr-FR') : '-';

  const active = users.filter((u) => u.is_active === true).length;

  return (
    <Shell user={user}>
      <div className="space-y-6">
        <PageHeader
          title={t(user.locale, 'nav.users')}
          subtitle={`${users.length} comptes · ${active} actifs`}
        />

        <Card>
          {users.length === 0 ? (
            <Empty>Aucun compte.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-faint">
                    <th className="px-4 py-2 font-medium">Nom</th>
                    <th className="px-4 py-2 font-medium">Email</th>
                    <th className="px-4 py-2 font-medium">Role</th>
                    <th className="px-4 py-2 font-medium">Etat</th>
                    <th className="tnum px-4 py-2 font-medium">Rapports</th>
                    <th className="px-4 py-2 font-medium">Derniere connexion</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((u) => (
                    <tr key={String(u.id)}>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link href={`/traders/${u.id}`} className="hover:underline">
                          {String(u.full_name)}
                        </Link>
                        {u.manager_name ? (
                          <div className="text-xs text-text-faint">
                            {String(u.manager_name)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-text-muted">{String(u.email)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={u.role === 'admin' ? 'info' : 'neutral'}>
                          {t(user.locale, `role.${u.role}`)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          {u.is_active === true ? (
                            <Badge tone="success">actif</Badge>
                          ) : (
                            <Badge tone="danger">desactive</Badge>
                          )}
                          {u.mfa_enrolled === true && <Badge tone="info">2FA</Badge>}
                        </div>
                      </td>
                      <td className="tnum px-4 py-3 text-text-muted">{String(u.reports_count ?? 0)}</td>
                      <td className="tnum whitespace-nowrap px-4 py-3 text-text-muted">
                        {fmt(u.last_login_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/traders/${u.id}`}
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
