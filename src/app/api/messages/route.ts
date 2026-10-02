import { asUser, callApp, queryWith } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/messages?with=<id> — le fil avec un interlocuteur
 *
 * AUCUN filtre n est applique ici, et c est volontaire : la table est cloisonnee
 * par RLS (je suis l un des deux expediteur/destinataire), donc la liste ne
 * peut contenir que mes messages. Un `where` ajoute ici serait une seconde
 * regle, qui divergerait de la premiere un jour.
 *
 * `with` designe l'interlocuteur. Sans lui, on liste tous les messages de
 * l'utilisateur, ce qui alimente la boite de reception.
 *
 * Le nom de l'interlocuteur vient de app.fn_can_message et non d'un JOIN :
 * le RLS de public.users rend un manager invisible a son propre trader (cf.
 * migration 029), et l'ecran afficherait un expediteur anonyme.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const withId = new URL(request.url).searchParams.get('with');

    if (withId && !UUID.test(withId)) {
      throw new AppError('VALIDATION', 'Identifiant invalide', { status: 422 });
    }

    const messages = await asUser(user.userId, (sql) =>
      queryWith<{
        id: string;
        body: string;
        sender_id: string;
        recipient_id: string;
        read_at: string | null;
        created_at: string;
        sender_name: string | null;
        recipient_name: string | null;
      }>(
        sql,
        // Les deux noms sont résolus par app.fn_user_display_name, qui refuse de
        // nommer quelqu'un avec qui aucun échange n'est possible. Sans ce
        // filtre, un identifiant deviné afficherait le nom d'un compte.
        `select m.id, m.body, m.sender_id, m.recipient_id, m.read_at, m.created_at,
                app.fn_user_display_name(m.sender_id, app.current_user_id())   as sender_name,
                app.fn_user_display_name(m.recipient_id, app.current_user_id()) as recipient_name
           from public.messages m
          where ($1::uuid is null or m.sender_id = $1::uuid or m.recipient_id = $1::uuid)
          order by m.created_at asc
          limit 200`,
        [withId ?? null],
      ),
    );

    // Les messages reçus sont marques lus a l'ouverture du fil : c'est le seul
    // moment ou l'utilisateur les a vus. La fonction ne touche que read_at, et
    // seulement sur les messages recus. L UPDATE passe par app.mark_message_read
    // parce que le role n a volontairement pas le droit d UPDATE sur la table.
    if (withId) {
      for (const m of messages) {
        if (m.recipient_id === user.userId && !m.read_at) {
          await asUser(user.userId, (sql) =>
            callApp(sql, 'app.mark_message_read', [m.id]),
          );
        }
      }
    }

    const unread = await asUser(user.userId, (sql) =>
      queryWith<{ n: number }>(sql, `select app.unread_message_count() as n`),
    );

    return jsonOk({ messages, unread: Number(unread[0]?.n ?? 0) });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * POST /api/messages — ecrire un message
 *
 * Le droit d'ecrire est decide par app.send_message : ni le role ni la relation
 * ne sont verifies ici, sinon la regle existerait deux fois. Un trader qui
 * viserait un autre compte serait refuse par la base, pas par cette route.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json().catch(() => null)) as {
      recipientId?: string;
      body?: string;
    } | null;

    if (!body?.recipientId || !UUID.test(body.recipientId)) {
      throw new AppError('VALIDATION', 'Destinataire requis', { status: 422 });
    }
    // 4000 caracteres : la meme borne que la contrainte en base. On la verifie
    // ici pour rendre un message clair plutot qu une erreur PostgreSQL.
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!text) {
      throw new AppError('VALIDATION', 'Le message est vide', { status: 422 });
    }
    if (text.length > 4000) {
      throw new AppError('VALIDATION', 'Message trop long (4000 caracteres maximum)', { status: 422 });
    }

    const id = await asUser(user.userId, (sql) =>
      callApp<string>(sql, 'app.send_message', [body.recipientId, text]),
    );

    return jsonOk({ id }, 201);
  } catch (error) {
    return jsonError(error);
  }
}