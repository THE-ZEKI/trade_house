import { asUser, queryWith, queryOne } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const INTRO = 'abcdefghijklmnopqrstuvwxyz';
const ACTIONS = [...INTRO];
const MAX = 200;

/**
 * GET /api/audit — journal des actions sensibles (F5, RG-06)
 *
 * Le RLS limite la lecture aux administrateurs : un manager qui appelerait
 * directement cette route ne recevrait rien, meme sans controle applicatif.
 * C'est volontairement le seul endroit ou l'on s'appuie uniquement sur le RLS
 * pour un acces « boutique d'admin ».
 *
 * Les details sont du JSONB libre : on ne renvoie que les cles connues pour
 * ne pas exposer par megarde une charge utile interne.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const p = new URL(request.url).searchParams;
    const action = p.get('action');
    const entityType = p.get('entityType');
    const entityId = p.get('entityId');
    const actorId = p.get('actorId');
    const from = p.get('from');
    const to = p.get('to');
    const limit = Math.min(Number.parseInt(p.get('limit') ?? '100', 10) || 100, MAX);

    const rows = await asUser(user.userId, (sql) =>
      queryWith(
        sql,
        `select a.id, a.action, a.entity_type, a.entity_id, a.details,
                a.ip_address, a.created_at,
                u.full_name as actor_name, u.email as actor_email, u.role as actor_role
           from public.audit_log a
           left join public.users u on u.id = a.actor_id
          where ($1::text is null or a.action like $1 || '%')
            and ($2::text is null or a.entity_type = $2)
            and ($3::uuid is null or a.entity_id = $3::uuid)
            and ($4::uuid is null or a.actor_id = $4::uuid)
            and ($5::timestamptz is null or a.created_at >= $5::timestamptz)
            and ($6::timestamptz is null or a.created_at <= $6::timestamptz)
          order by a.created_at desc
          limit $7`,
        [action, entityType, entityId, actorId, from, to, limit],
      ),
    );

    // le nombre total sert a l'interface pour afficher « 1 sur N »
    const total = await asUser(user.userId, (sql) =>
      queryOne<{ n: number }>('select count(*)::int as n from public.audit_log'),
    );

    // alphabet des actions rencontrees : alimente un menu de filtre
    const known = await asUser(user.userId, (sql) =>
      queryWith<{ action: string }>(
        sql,
        'select distinct action from public.audit_log order by action limit 60',
      ),
    );

    return jsonOk({
      entries: rows,
      total: total?.n ?? 0,
      knownActions: known.map((r) => r.action).filter((a) => ACTIONS.includes(a[0])),
    });
  } catch (error) {
    return jsonError(error);
  }
}
