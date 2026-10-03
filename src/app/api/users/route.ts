import { asUser, callApp, queryWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { sendEmail, appUrl, emailProvider } from '@/lib/email';
import { invitationEmail } from '@/lib/email-templates';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ROLES = ['admin', 'manager', 'trader'];

/**
 * GET /api/users — annuaire (A2, A3, RG-04)
 *
 * Le RLS fait le tri : l'admin voit tout, un manager voit ses traders, un
 * trader ne voit que lui-meme. La colonne days_since_report alimente F1 :
 * c'est l'indicateur qui declenche une relance, pas un simple affichage.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const p = new URL(request.url).searchParams;
    const role = p.get('role');
    const q = p.get('q');
    const activeOnly = p.get('activeOnly') !== 'false';

    if (role && !ROLES.includes(role)) {
      return jsonOk({ error: { code: 'VALIDATION', message: 'Role invalide', rule: null } }, 422);
    }

    const rows = await asUser(user.userId, (sql) =>
      queryWith(
        sql,
        `select u.id, u.email, u.full_name, u.phone, u.role, u.timezone, u.is_active,
                u.mfa_enrolled, u.mfa_enforced, u.invited_at, u.invite_expires_at,
                u.last_login_at, u.created_at,
                m.full_name as manager_name, m.id as manager_id,
                (select count(*)::int from public.user_sessions s
                  where s.user_id = u.id and s.revoked_at is null
                    and s.expires_at > now()) as active_sessions,
                r.last_report_date,
                -- Parentheses indispensables : date moins date rend un entier,
                -- et "a and entier" fait echouer PostgreSQL (« l'argument de
                -- AND doit etre de type boolean »). Sans elles, cette route
                -- renvoyait 500 — la page /users, qui interroge la base
                -- directement, fonctionnait et masquait donc le defaut.
                case when r.last_report_date is not null
                     then (current_date - r.last_report_date)
                end as days_since_report
           from public.users u
           left join public.users m on m.id = u.manager_id
           left join lateral (
             select max(session_date) as last_report_date
               from public.reports rp where rp.trader_id = u.id
           ) r on true
          where ($1::user_role is null or u.role = $1::user_role)
            and ($2::text is null
                 or u.full_name ilike '%' || $2 || '%'
                 or u.email::text ilike '%' || $2 || '%')
            and ($3::boolean = false or u.is_active)
          order by u.role, u.full_name
          limit 500`,
        [role, q, activeOnly],
      ),
    );

    return jsonOk({ users: rows });
  } catch (error) {
    return jsonError(error);
  }
}

function parseCreate(raw: unknown) {
  if (typeof raw !== 'object' || raw === null) return null;
  const b = raw as Record<string, unknown>;

  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const fullName = typeof b.fullName === 'string' ? b.fullName.trim() : '';
  const role = typeof b.role === 'string' ? b.role : '';

  if (!EMAIL.test(email) || email.length > 254) return null;
  if (!fullName || fullName.length > 120) return null;
  if (!ROLES.includes(role)) return null;

  const managerId = typeof b.managerId === 'string' && b.managerId ? b.managerId : null;
  if (managerId && !UUID.test(managerId)) return null;

  return {
    email,
    fullName,
    role,
    managerId,
    phone: typeof b.phone === 'string' && b.phone.trim() ? b.phone.trim().slice(0, 30) : null,
    // un fuseau invalide ferait echouer l'affichage des heures cote interface
    timezone:
      typeof b.timezone === 'string' && /^[A-Za-z]+\/[A-Za-z_]+$/.test(b.timezone)
        ? b.timezone
        : 'UTC',
    locale: typeof b.locale === 'string' && ['fr', 'en'].includes(b.locale) ? b.locale : 'fr',
    mfaEnforced: b.mfaEnforced === true,
  };
}

/**
 * POST /api/users — creation de compte et invitation (A2, RG-02, RG-05, RG-06)
 *
 * Deux chemins, et la difference est le coeur de la feature :
 *
 *   - l'ADMIN passe par app.create_user et choisit librement le role et le
 *     manager de tutelle ;
 *   - le MANAGER passe par app.invite_trader, qui n'accepte que le role
 *     'trader' et impose le manager courant. La couverture n'est donc pas
 *     demandee par le client : elle resulte de la fonction. Un manager qui
 *     tenterait de s'attribuer un autre tuteur, ou de creer un admin, se
 *     verrait refuser par la base.
 *
 * Le jeton ne quitte JAMAIS la reponse en production : seul le fournisseur
 * « log » le renvoie, pour permettre les tests en developpement.
 */
export async function POST(request: Request) {
  const body = parseCreate(await request.json().catch(() => null));
  if (!body) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Donnees invalides', rule: null } }, 422);
  }

  try {
    const user = await requireUser();

    // Le trader ne fait rien de tout cela, quel que soit le corps envoye.
    if (!can(user, 'trader.invite')) {
      return jsonOk(
        { error: { code: 'FORBIDDEN', message: 'Vous ne pouvez pas creer de compte', rule: 'RG-02' } },
        403,
      );
    }

    const isAdmin = user.role === 'admin';

    // Un manager n'a qu'un droit : creer un trader. Le role est impose par la
    // fonction ; on le verifie ici aussi pour ne pas depenser un appel base
    // quand la demande est deja hors sujet.
    if (!isAdmin && body.role !== 'trader') {
      return jsonOk(
        { error: { code: 'FORBIDDEN', message: 'Un manager invite uniquement un trader', rule: 'RG-06' } },
        403,
      );
    }

    const created = await asUser(user.userId, async (sql) => {
      const id: string = isAdmin
        ? (
            await sql.query(
              `select (app.create_user($1::citext,$2::varchar,$3::user_role,$4::uuid,$5::varchar,
                                        $6::varchar,$7::varchar,$8::boolean)).id`,
              [body.email, body.fullName, body.role, body.managerId, body.phone,
                body.timezone, body.locale, body.mfaEnforced],
            )
          ).rows[0].id
        : (
            await sql.query(
              `select (app.invite_trader($1::citext,$2::varchar,$3::varchar,$4::varchar,$5::boolean)).id`,
              [body.email, body.fullName, body.timezone, body.locale, body.mfaEnforced],
            )
          ).rows[0].id;

      // RG-05 : lien valable 7 jours ; un renvoi invalide le precedent
      const token = await callApp<string>(sql, 'issue_invitation', [id, 'invite']);
      // 032 : l'echo in-app de l'invitation. L'email d'accueil part par un
      // autre chemin (sendEmail plus bas, et uniquement en mode `log`) ; ceci
      // est la trace en base, lisible des que le compte existe.
      await callApp(sql, 'notify_account_invited', [id]);
      return { id, token };
    });

    if (!created) {
      return jsonOk({ error: { code: 'CONFLICT', message: 'Creation impossible', rule: null } }, 409);
    }

    const link = `${appUrl()}/invitation?token=${encodeURIComponent(created.token ?? '')}`;
    await sendEmail(invitationEmail(body.fullName, body.email, link, user.locale === 'en' ? 'en' : 'fr'));

    const preview = emailProvider() === 'log' ? { previewLink: link } : {};
    return jsonOk({ user: { id: created.id, ...body, is_active: true }, ...preview }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if ((error as { code?: string })?.code === '23505') {
      return jsonOk({ error: { code: 'CONFLICT', message: 'Cet email est deja utilise', rule: 'RG-01' } }, 409);
    }
    if (/RG-02/.test(message)) {
      return jsonOk({ error: { code: 'FORBIDDEN', message, rule: 'RG-02' } }, 403);
    }
    return jsonError(error);
  }
}
