import Link from 'next/link';
import { pageUserAs } from '@/lib/page';
import { asUser, queryOneWith, queryWith } from '@/lib/db';
import Shell from '@/components/Shell';
import { Card, PageHeader } from '@/components/ui';
import InviteUser from '@/components/InviteUser';
import TeamPanel from '@/components/TeamPanel';
import type { Msg } from '@/components/MessageThread';
import { can } from '@/lib/permissions';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Mon equipe — Trade House' };

/**
 * Mon equipe : le manager invite ses traders, et converse avec chacun.
 *
 * L'invitation vit ici plutot qu dans /users, qui reste l'administration. Un
 * manager n'a pas de page d'administration des comptes : lui en donner une
 * l'obligerait a voir des commandes qu'il ne peut pas utiliser. Cette page ne
 * montre que ce qui lui appartient — son equipe, et ce qu'il peut y faire.
 *
 * Le RLS fait le cloisonnement : un manager ne voit que SES traders, un admin
 * voit tous. Aucun filtre n est ajoute ici, pour la meme raison qu ailleurs —
 * une regle ecrite deux fois diverge un jour.
 */
export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ with?: string }>;
}) {
  const user = await pageUserAs(['admin', 'manager']);
  const { with: interlocuteur } = await searchParams;
  const isAdmin = user.role === 'admin';

  const traders = await asUser(user.userId, (sql) =>
    queryWith<{ id: string; full_name: string; last_message: string | null; last_at: string | null; unread: number }>(
      sql,
      // Dernier message et compteur de non-lus par LEFT JOIN LATERAL : une seule
      // requete pour toute la liste. Le RLS de public.messages garantit qu'un
      // trader n'apparait jamais avec le dernier message d'un autre.
      `select t.id, t.full_name,
              lm.body as last_message, lm.created_at as last_at,
              (select count(*)::int from public.messages m
                where m.sender_id = t.id and m.recipient_id = $1::uuid
                  and m.read_at is null) as unread
         from public.users t
         left join lateral (
           select m.body, m.created_at
             from public.messages m
            where (m.sender_id = t.id and m.recipient_id = $1::uuid)
               or (m.recipient_id = t.id and m.sender_id = $1::uuid)
            order by m.created_at desc
            limit 1
         ) lm on true
        where t.role = 'trader' and t.is_active
          and (app.is_admin() or app.can_manage_trader(t.id))
        order by t.full_name`,
      [user.userId],
    ),
  );

  // Le fil n est charge que si un interlocuteur est choisi : sinon la page
  // chargerait tous les echanges d une equipe de vingt personnes pour n
  //afficher que la liste.
  let messages: Msg[] = [];
  if (interlocuteur) {
    messages = await asUser(user.userId, (sql) =>
      queryWith<Msg>(
        sql,
        `select msg.id, msg.body, msg.sender_id, msg.recipient_id,
                msg.read_at, msg.created_at,
                app.fn_user_display_name(msg.sender_id, $1::uuid)   as sender_name,
                app.fn_user_display_name(msg.recipient_id, $1::uuid) as recipient_name
           from public.messages msg
          where (msg.sender_id = $1::uuid and msg.recipient_id = $2::uuid)
             or (msg.recipient_id = $1::uuid and msg.sender_id = $2::uuid)
          order by msg.created_at asc
          limit 200`,
        [user.userId, interlocuteur],
      ),
    );

    // Ouverture du fil = lecture. On marque ici, et pas dans la route GET de
    // l API, parce que cette page lit en base : la regle reste dans un seul
    // endroit et l appel est explicite.
    for (const m of messages) {
      if (m.recipient_id === user.userId && !m.read_at) {
        await asUser(user.userId, (sql) =>
          queryOneWith(sql, `select app.mark_message_read($1::uuid) as ok`, [m.id]),
        );
      }
    }
  }

  const managers = await asUser(user.userId, (sql) =>
    queryWith<{ id: string; full_name: string }>(
      sql,
      `select id, full_name from public.users where role = 'manager' and is_active order by full_name`,
    ),
  );

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
          title="Mon equipe"
          subtitle={
            isAdmin
              ? 'Tous les traders — aucun compte de ce groupe ne vous est propre'
              : `${traders.length} trader(s) sous votre supervision`
          }
          actions={
            can(user, 'trader.invite') ? (
              <InviteUser
                managers={managers}
                isAdmin={isAdmin}
                managerName={user.fullName}
              />
            ) : undefined
          }
        />

        <Card title="Conversations">
          <div className="px-4 py-4">
            <TeamPanel
              meId={user.userId}
              traders={traders}
              initialSelected={interlocuteur ?? null}
              messages={messages}
              isAdmin={isAdmin}
            />
          </div>
        </Card>

        <p className="flex items-start gap-2 text-xs text-text-faint">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {isAdmin
            ? 'En tant qu administrateur, vous voyez tous les traders mais aucune de leurs conversations : la messagerie est cloisonnee par equipe.'
            : 'Vos conversations avec vos traders sont privees : vous ne voyez pas leurs echanges entre eux, et le contenu n est jamais repris dans un e-mail.'}
        </p>
      </div>
    </Shell>
  );
}