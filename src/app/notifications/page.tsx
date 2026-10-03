import { asUser, queryWith } from '@/lib/db';
import { pageUser } from '@/lib/page';
import { t } from '@/lib/i18n';
import Shell from '@/components/Shell';
import { Card, Empty, PageHeader } from '@/components/ui';
import NotificationList, { type Notif } from '@/components/NotificationList';


export const dynamic = 'force-dynamic';

export const metadata = { title: 'Notifications — Trade House' };

/**
 * Notifications de l'utilisateur (F4), lectures via `notifications_log`.
 *
 * Seules les notifications de l'utilisateur courant sont accessibles : la
 * table est protegee par RLS sur `user_id`, donc pas de filtre necessaire
 * ici — et c'est le RLS qui gagne meme si le code evolue.
 *
 * 034 : chaque ligne est cliquable et se marque lue au clic (NotificationList).
 * L'ecran ne passe plus `unread` au Shell : le compteur est lu par le Shell
 * lui-meme, sinon la pastille ne vivait que sur CET ecran et disparaissait des
 * la navigation — une pastille qu on ne voit pas n annonce rien.
 */
export default async function NotificationsPage() {
  const user = await pageUser();

  const rows = await asUser(user.userId, (sql) =>
    queryWith<Notif>(
      sql,
      `select n.id, n.event, n.channel, n.status, n.created_at, n.sent_at,
              n.read_at, n.related_type, n.related_id, n.error_message
         from public.notifications_log n
        order by n.created_at desc
        limit 100`,
    ),
  );

  return (
    <Shell user={user}>
      <div className="space-y-6">
        <PageHeader
          title={t(user.locale, 'nav.notifications')}
          subtitle={`${rows.length} dernieres notifications`}
        />

        <Card>
          {rows.length === 0 ? (
            <Empty>{t(user.locale, 'empty.notifications')}</Empty>
          ) : (
            <NotificationList rows={rows} locale={user.locale} role={user.role} />
          )}
        </Card>
      </div>
    </Shell>
  );
}
