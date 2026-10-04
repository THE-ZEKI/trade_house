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

  // Le role de chaque interlocuteur est renvoye pour que la liste puisse le
  // distinguer (036) : un manager voit « ses traders », un admin voit « ses
  // interlocuteurs ».
  //
  //   pour un MANAGER, ses interlocuteurs sont ses traders — inchangé.
  //   pour un ADMIN, ce sont TOUS les comptes actifs : le canal d annonces.
  //
  // Le RLS ne filtre pas cette liste : elle porte sur public.users, dont les
  // politiques laissent voir l'annuaire a tout utilisateur authentifie. Le
  // cloisonnement porte sur les MESSAGES (app.can_message), pas sur la
  // connaissance de l annuaire — un admin a toujours besoin de savoir qui
  // existe pour leur ecrire.
  //
  // Le menu deroulant de l'invitation y inscrit aussi l admin lui-meme, ce qui
  // evite de proposer un role a un compte qui ne peut pas inviter.
  const interlocuteurs = await asUser(user.userId, (sql) =>
    // role : la clause WHERE impose IN ('manager','trader'), donc le type
    // Postgres renvoie bien une union, pas un varchar quelconque. Le dire
    // evite un cast `as` au passage de la requete au composant.
    queryWith<{
      id: string;
      full_name: string;
      role: 'manager' | 'trader';
      last_message: string | null;
      last_at: string | null;
      unread: number;
    }>(
      sql,
      `select t.id, t.full_name, t.role,
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
        where t.is_active
          and t.id <> $1::uuid
          and (
                ($2::boolean = false and t.role = 'trader'
                   and app.can_manage_trader(t.id))
             or ($2::boolean = true and t.role in ('manager', 'trader'))
              )
        order by t.role, t.full_name`,
      [user.userId, isAdmin],
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
    //
    // 034 : les DEUX etats sont mis a jour, le message ET sa notification. Les
    // laisser diverger produirait un ecran « lu » sous une cloche « nouveau »,
    // sur le meme message — deux vraies informations contraires.
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

  const managers = await asUser(user.userId, (sql) =>
    queryWith<{ id: string; full_name: string }>(
      sql,
      // Les admins sont exclus : ils ne peuvent rien inviter (RG-02), et leur
      // proposer un role produirait un echec a la soumission.
      `select id, full_name from public.users
        where role = 'manager' and is_active
        order by full_name`,
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
              ? 'Tous vos interlocuteurs — canal d annonces et de retours'
              : `${interlocuteurs.length} trader(s) sous votre supervision`
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
              interlocuteurs={interlocuteurs}
              initialSelected={interlocuteur ?? null}
              messages={messages}
              isAdmin={isAdmin}
            />
          </div>
        </Card>

        <p className="flex items-start gap-2 text-xs text-text-faint">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {isAdmin
            ? 'Canal d annonces : vous échangez avec tous les managers et traders, et eux peuvent vous répondre. Les conversations entre un manager et son équipe vous restent invisibles.'
            : 'Vos conversations avec vos traders sont privees : vous ne voyez pas leurs echanges entre eux, et le contenu n est jamais repris dans un e-mail.'}
        </p>
      </div>
    </Shell>
  );
}
