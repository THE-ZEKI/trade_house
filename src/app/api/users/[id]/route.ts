import { asUser, callApp, queryWith, queryOneWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { sendEmail, appUrl, emailProvider } from '@/lib/email';
import { invitationEmail } from '@/lib/email-templates';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ['admin', 'manager', 'trader'];

/**
 * GET /api/users/:id — fiche compte (A2, A3, F2)
 *
 * Sessions, invitations et dernieres connexions : c'est ce qui permet de
 * repondre a « pourquoi est-il deconnecte ? » sans aller en base.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!UUID.test(id)) return notFound();

    const detail = await asUser(user.userId, async (sql) => {
      const account = await queryOneWith(
        sql,
        `select u.id, u.email, u.full_name, u.phone, u.role, u.timezone, u.is_active,
                u.mfa_enrolled, u.mfa_enforced, u.invited_at, u.invite_expires_at,
                u.last_login_at, u.created_at, u.manager_id,
                m.full_name as manager_name
           from public.users u
           left join public.users m on m.id = u.manager_id
          where u.id = $1::uuid`,
        [id],
      );
      if (!account) return null;

      const sessions = await queryWith(
        sql,
        `select id, ip_address, user_agent, created_at, last_seen_at, expires_at, revoked_at
           from public.user_sessions where user_id = $1::uuid
          order by created_at desc limit 20`,
        [id],
      );
      const logins = await queryWith(
        sql,
        `select * from app.recent_logins($1::uuid, 10)`,
        [id],
      );
      return { account, sessions, logins };
    });

    if (!detail) return notFound();
    return jsonOk(detail);
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * PATCH /api/users/:id — actions sur un compte (A3, RG-02, RG-06)
 *
 *   action=deactivate     desactive et revoque les sessions (jamais de suppression)
 *   action=reactivate     reactive
 *   action=invite         renvoie une invitation ; RG-05 invalide l'ancien lien
 *   action=revoke-sessions ferme toutes les sessions ouvertes
 *   action=mfa-required   rend la 2FA obligatoire (recommandee pour les admins)
 *
 * Toutes ces actions passent par des fonctions app.* : c'est la que sont
 * verifies le role de l'appelant et la protection du dernier administrateur.
 */
export async function PATCH(request: Request, { params }: Params) {
  const raw = await request.json().catch(() => null);
  if (typeof raw !== 'object' || raw === null) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Corps invalide', rule: null } }, 422);
  }
  const body = raw as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : '';
  const { id } = await params;
  if (!UUID.test(id)) return notFound();

  try {
    const user = await requireUser();

    const result = await asUser(user.userId, async (sql) => {
      switch (action) {
        case 'deactivate':
          await callApp(sql, 'deactivate_user', [id]);
          return { is_active: false };

        case 'reactivate':
          await callApp(sql, 'reactivate_user', [id]);
          return { is_active: true };

        case 'revoke-sessions': {
          const n = await callApp<number>(sql, 'revoke_all_sessions', [id]);
          return { revoked: n ?? 0 };
        }

        case 'mfa-required': {
          if (typeof body.enabled !== 'boolean') {
            throw new Error('Valeur « enabled » requise');
          }
          await callApp(sql, 'set_mfa_enforced', [id, body.enabled]);
          return { mfa_enforced: body.enabled };
        }

        case 'invite': {
          // RG-05 : le nouveau jeton invalide le precedent
          const token = await callApp<string>(sql, 'issue_invitation', [id, 'invite']);
          const link = `${appUrl()}/invitation?token=${encodeURIComponent(token ?? '')}`;
          const account = await queryOneWith<{ email: string; full_name: string }>(
            sql,
            'select email, full_name from public.users where id = $1::uuid',
            [id],
          );
          if (account) {
            await sendEmail(
              invitationEmail(account.full_name, account.email, link, user.locale === 'en' ? 'en' : 'fr'),
            );
          }
          const show = emailProvider() === 'log' ? { previewLink: link } : {};
          return { invited: true, ...show };
        }

        case 'update': {
          // 018 : modification d'un compte. Les regles (role, manager, retrait
          // du dernier administrateur) sont verifiees par app.update_user_account.
          const role = typeof body.role === 'string' ? body.role : null;
          if (role && !ROLES.includes(role)) {
            throw new AppError('VALIDATION', 'Role invalide', { status: 422 });
          }
          const managerId =
            typeof body.managerId === 'string' && body.managerId ? body.managerId : null;
          return {
            user: await callApp<{ id: string }>(sql, 'update_user_account', [
              id,
              role,
              managerId,
              typeof body.phone === 'string' ? body.phone : null,
              typeof body.timezone === 'string' ? body.timezone : null,
              typeof body.locale === 'string' ? body.locale : null,
              typeof body.fullName === 'string' ? body.fullName : null,
            ]),
          };
        }

        case 'assign-manager':
          // 028 : le manager rattache un de ses traders a LUI-MEME. La fonction
          // ne prend pas de manager_id : il n'y a rien a choisir. Detacher un
          // trader reste reserve a l'admin (interdit 2 de la migration).
          return { user: { id: await callApp<string>(sql, 'assign_trader_manager', [id]) } };

        case 'unassign-manager':
          // Administrateur uniquement : decide par app.unassign_trader_manager.
          return { user: { id: await callApp<string>(sql, 'unassign_trader_manager', [id]) } };

        case 'anonymize': {
          // 018 : droit a l'oubli. On n'efface pas la ligne, seulement
          // l'identite — l'historique des rapports reste rattache.
          // Confirmation explicite exigee : action irreversible.
          if (body.confirm !== true) {
            throw new AppError('VALIDATION', 'Confirmation requise', { status: 422 });
          }
          return { anonymized: await callApp<string>(sql, 'anonymize_user', [id]) };
        }

        default:
          throw new Error(`Action inconnue : ${action}`);
      }
    });

    return jsonOk(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/RG-02|administrateur/i.test(message)) {
      return jsonOk({ error: { code: 'FORBIDDEN', message, rule: 'RG-02' } }, 403);
    }
    if (/Action inconnue|Valeur/.test(message)) {
      return jsonOk({ error: { code: 'VALIDATION', message, rule: null } }, 422);
    }
    return jsonError(error);
  }
}


function notFound() {
  return jsonOk({ error: { code: 'NOT_FOUND', message: 'Compte introuvable', rule: null } }, 404);
}
