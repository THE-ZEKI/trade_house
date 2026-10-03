import Link from 'next/link';
import { pageUser } from '@/lib/page';
import { asUser, queryOneWith, queryWith } from '@/lib/db';
import Shell from '@/components/Shell';
import { Card, Empty, PageHeader } from '@/components/ui';
import MessageThread, { type Msg } from '@/components/MessageThread';
import { can } from '@/lib/permissions';
import { ArrowLeft, MessagesSquare, ShieldCheck } from 'lucide-react';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Mon manager — Trade House' };

/**
 * Mon manager : la conversation du trader avec son tuteur.
 *
 * UN SEUL INTERLOCUTEUR, et c est structurel : un trader a exactement un
 * manager de tutelle (RG-06). L'ecran n'offre donc pas de liste de contacts —
 * il n'y en a pas. Ajouter un selecteur donnerait l'illusion d'un choix, et
 * le RLS refuserait tout choix.
 *
 * Le nom vient de app.fn_user_display_name, pas d'un JOIN sur public.users : le
 * RLS de users rend un manager invisible a son propre trader (migration 029).
 */
export default async function MyManagerPage() {
  const user = await pageUser();

  // Le manager est resolu par une fonction : le JOIN echouerait, puisque la
  // ligne du manager n'est pas lisible par le trader qui la demande.
  const manager = await asUser(user.userId, (sql) =>
    queryOneWith<{ id: string; full_name: string | null }>(
      sql,
      `select app.manager_of($1::uuid) as id,
              app.fn_user_display_name(app.manager_of($1::uuid), $1::uuid) as full_name`,
      [user.userId],
    ),
  );

  const messages: Msg[] = manager
    ? await asUser(user.userId, (sql) =>
        queryWith<Msg>(
          sql,
          `select msg.id, msg.body, msg.sender_id, msg.recipient_id,
                  msg.read_at, msg.created_at,
                  app.fn_user_display_name(msg.sender_id, $1::uuid)   as sender_name,
                  app.fn_user_display_name(msg.recipient_id, $1::uuid) as recipient_name
             from public.messages msg
            where msg.sender_id = $1::uuid or msg.recipient_id = $1::uuid
            order by msg.created_at asc
            limit 200`,
          [user.userId],
        ),
      )
    : [];

  // Le fil du trader a UN SEUL interlocuteur : on le charge toujours, et on le
  // marque lu a l'ouverture, comme /equipe. Avant 034 cette page n'ecrivait
  // rien : le message devenait « lu » a l'ecran, et sa notification restait
  // « non lue » dans la cloche pour toujours. Deux etats contraires pour le
  // meme evenement, dont aucun ne reprenait l'autre.
  if (manager) {
    for (const m of messages) {
      if (m.recipient_id === user.userId && !m.read_at) {
        await asUser(user.userId, (sql) =>
          queryOneWith(sql, `select app.mark_message_read($1::uuid) as ok`, [m.id]),
        );
        await asUser(user.userId, (sql) =>
          queryOneWith(sql, `select app.mark_message_notification_read($1::uuid) as ok`, [m.id]),
        );
      }
    }
  }

  return (
    <Shell user={user}>
      <div className="space-y-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.2} /> Accueil
        </Link>

        <PageHeader
          title="Mon manager"
          subtitle={
            manager?.full_name
              ? `Votre conversation avec ${manager.full_name}`
              : undefined
          }
        />

        {manager ? (
          <Card title="Conversation">
            <div className="px-4 py-4">
              <MessageThread
                messages={messages}
                meId={user.userId}
                counterpartId={manager.id}
                counterpartName={manager.full_name ?? 'votre manager'}
              />
            </div>
          </Card>
        ) : (
          <Card>
            <Empty Icon={MessagesSquare} title="Aucun manager rattache">
              {can(user, 'trader.invite')
                ? 'Vous n\'etes pas encore rattache a un manager.'
                : 'Votre compte n\'est pas encore rattache a un manager. Contactez votre administrateur.'}
            </Empty>
          </Card>
        )}

        <p className="flex items-start gap-2 text-xs text-text-faint">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Votre conversation est privee : ni votre manager ne voit vos echanges avec
          d&apos;autres personnes, ni un administrateur, sauf s&apos;il y participe
          lui-meme. Le contenu n&apos;est jamais repris dans un e-mail.
        </p>
      </div>
    </Shell>
  );
}