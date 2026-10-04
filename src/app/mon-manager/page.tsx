import Link from 'next/link';
import { pageUser } from '@/lib/page';
import { asUser, queryOneWith, queryWith } from '@/lib/db';
import Shell from '@/components/Shell';
import { Card, Empty, PageHeader } from '@/components/ui';
import type { Msg } from '@/components/MessageThread';
import TeamPanel from '@/components/TeamPanel';
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
export default async function MyManagerPage({
  searchParams,
}: {
  // 036 : la page est devenue une liste, donc elle a besoin du meme parametre
  // que /equipe pour savoir quel fil ouvrir. Sans lui, le composant trouverait
  // un interlocuteur selectionne sans avoir le fil correspondant a afficher.
  searchParams: Promise<{ with?: string }>;
}) {
  const user = await pageUser();
  const { with: interlocuteur } = await searchParams;

  // Le manager est resolu par une fonction : le JOIN echouerait, puisque la
  // ligne du manager n'est pas lisible par le trader qui la demande.
  // 036 : L'ECRAN N'EST PLUS UN FIL UNIQUE.
  //
  // Il l'etait parce qu'un trader a exactement un manager de tutelle (RG-06).
  // Mais le canal d'annonces ajoute un second interlocuteur possible — les
  // administrateurs — et il est BILATERAL : un trader doit pouvoir y repondre.
  // Sans ce changement, l'admin ecrivait au trader, la notification arrivait,
  // et /mon-manager affichait un fil vide : le message etait en base mais
  // n'atteignable par aucun ecran. Exactement le symptome constate.
  //
  // Le manager passe par app.manager_of (le JOIN echouerait : la ligne du
  // manager n'est pas lisible par son trader, migration 029). Les admins, eux,
  // passent par une requete simple : un administrateur est dans l'annuaire.
  // 037 : les admins viennent de fn_admin_contacts(), pas de public.users.
//
// La ligne du compte admin est invisible pour un trader — RLS de public.users
// (008), qui ne laisse passer que soi-meme, les admins, et SES propres traders.
// Une requete ordinaire sur public.users renvoie donc zero ligne, et l'admin
// disparait de l'ecran alors qu'il peut-ecrire au trader. C'etait le symptome :
// message bien envoye, notification presente, interlocuteur introuvable.
//
// Le nom du manager suit la meme contrainte : sa ligne n'est pas lisible par son
// trader (029), il faut donc passer par fn_user_display_name, que le RLS
// autorise. La liste est donc assemblee en SQL plutot qu'en JavaScript — le
//-JS n'aurait pas moins de droits que la base.
const interlocuteurs = await asUser(user.userId, (sql) =>
  queryWith<{
    id: string;
    full_name: string;
    role: 'admin' | 'manager' | 'trader';
    last_message: string | null;
    last_at: string | null;
    unread: number;
  }>(
    sql,
    `with mes_contacts as (
       -- le manager de tutelle, resolu par app.manager_of : le JOIN echouerait,
       -- sa ligne n'etant pas lisible par son propre trader (029)
       select app.manager_of($1::uuid) as id, 'manager'::text as role
        where app.manager_of($1::uuid) is not null
       union all
       -- les admins : seule voie d'acces a l'annuaire (037)
       select a.id, 'admin'::text from app.fn_admin_contacts() a
     )
     select c.id,
            coalesce(app.fn_user_display_name(c.id, $1::uuid), c.id::text) as full_name,
            c.role as role,
            lm.body as last_message, lm.created_at as last_at,
            (select count(*)::int from public.messages m
              where m.sender_id = c.id and m.recipient_id = $1::uuid
                and m.read_at is null) as unread
       from mes_contacts c
       left join lateral (
         select m.body, m.created_at
           from public.messages m
          where (m.sender_id = c.id and m.recipient_id = $1::uuid)
             or (m.recipient_id = c.id and m.sender_id = $1::uuid)
          order by m.created_at desc
          limit 1
       ) lm on true
      order by c.role, full_name`,
    [user.userId],
  ),
);

  const manager = interlocuteurs.find((c) => c.role === 'manager') ?? null;

  const messages: Msg[] =
    interlocuteurs.length > 0
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
          title="Mes contacts"
          subtitle={
            interlocuteurs.length > 1
              ? 'Votre manager de tutelle et les administrateurs de la plateforme'
              : manager?.full_name
                ? `Votre conversation avec ${manager.full_name}`
                : undefined
          }
        />

        {interlocuteurs.length > 0 ? (
          <Card title="Conversations">
            <div className="px-4 py-4">
              {/* TeamPanel : meme composant que /equipe. Le trader obtient donc
                  la recherche, la pastille de non-lus et la gestion du fil
                  ouvert sans code duplique. */}
              <TeamPanel
                meId={user.userId}
                interlocuteurs={interlocuteurs}
                initialSelected={interlocuteur ?? null}
                messages={messages.filter((m) =>
                  interlocuteur
                    ? m.sender_id === interlocuteur || m.recipient_id === interlocuteur
                    : true,
                )}
                isAdmin={false}
                backHref="/mon-manager"
                backLabel="Mes contacts"
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
