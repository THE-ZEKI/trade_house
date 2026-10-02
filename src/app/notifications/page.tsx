import { asUser, queryWith } from '@/lib/db';
import { pageUser } from '@/lib/page';
import { t } from '@/lib/i18n';
import Shell from '@/components/Shell';
import { Card, Empty, CodeBadge, PageHeader } from '@/components/ui';
import { NOTIFY_STATUS} from '@/lib/status';


export const dynamic = 'force-dynamic';

export const metadata = { title: 'Notifications — Trade House' };

/**
 * Notifications de l'utilisateur (F4), lectures via `notifications_log`.
 *
 * Seules les notifications de l'utilisateur courant sont accessibles : la
 * table est protegee par RLS sur `user_id`, donc pas de filtre necessaire
 * ici — et c'est le RLS qui gagne meme si le code evolue.
 *
 * Volontairement sans bouton « marquer comme lu » : cela appellerait
 * `app.mark_notification_read`, qui n'existe pas encore. Un ecran qui affiche
 * un etat qu'il ne sait pas corriger mentirait sur son propre contenu.
 */
export default async function NotificationsPage() {
  const user = await pageUser();

  const rows = await asUser(user.userId, (sql) =>
    queryWith(
      sql,
      `select n.id, n.event, n.channel, n.status, n.created_at, n.sent_at,
              n.read_at, n.related_type, n.related_id, n.error_message
         from public.notifications_log n
        order by n.created_at desc
        limit 100`,
    ),
  );

  const unread = rows.filter((n) => !n.read_at && n.status === 'sent').length;

  const isEn = user.locale === 'en';
  const fmt = (v: unknown) =>
    v
      ? new Date(String(v)).toLocaleString(isEn ? 'en-GB' : 'fr-FR', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        })
      : '-';

  return (
    <Shell user={user} unread={unread}>
      <div className="space-y-6">
        <PageHeader
          title={t(user.locale, 'nav.notifications')}
          subtitle={`${rows.length} dernieres notifications`}
        />

        <Card>
          {rows.length === 0 ? (
            <Empty>{t(user.locale, 'empty.notifications')}</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((n) => (
                <li key={String(n.id)} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm">{String(n.event)}</span>
                      
                      
                    </div>
                    <div className="tnum mt-0.5 text-xs text-text-faint">
                      {fmt(n.created_at)} · {String(n.channel)}
                      {n.related_type ? ` · ${String(n.related_type)}` : ''}
                    </div>
                    {n.error_message ? (
                      <div className="mt-1 text-xs text-danger">
                        {String(n.error_message)}
                      </div>
                    ) : null}
                  </div>
                  <CodeBadge table={NOTIFY_STATUS} code={n.status} locale={user.locale} prefix="send" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Shell>
  );
}
