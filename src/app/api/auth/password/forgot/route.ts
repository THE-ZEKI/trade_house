import { queryOne, withTransaction, callApp } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { appUrl, mayExposeToken, sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/password/forgot — A1
 *
 * Repond TOUJOURS 200, que l'adresse existe ou non : sinon la page Allowait
 * de recenser les comptes de la plateforme.
 * Le jeton est emis par app.issue_invitation(purpose = 'password_reset'),
 * expire apres 1 heure (contre 7 jours pour une invitation, RG-05).
 */
export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const email =
    typeof raw === 'object' && raw !== null && typeof (raw as Record<string, unknown>).email === 'string'
      ? ((raw as Record<string, unknown>).email as string).trim().toLowerCase()
      : null;

  if (!email) {
    return jsonOk({ status: 'ignored' });
  }

  try {
    // SECURITY DEFINER obligatoire : sans contexte utilisateur, le RLS de
    // public.users ne laisserait passer aucune ligne (on ne verrait jamais
    // que l'email est inconnu).
    const account = await queryOne<{ id: string; email: string; full_name: string; is_active: boolean }>(
      'select * from app.account_for_recovery($1::citext)',
      [email],
    );

    if (account?.is_active) {
      const token = await withTransaction((sql) =>
        callApp<string>(sql, 'app.issue_invitation', [account.id, 'password_reset']),
      );
      const link = `${appUrl()}/mot-de-passe-oublie?token=${token}`;
      await sendEmail({
        to: account.email,
        subject: 'Reinitialisation de votre mot de passe',
        text: `Bonjour ${account.full_name},\n\nChoisissez un nouveau mot de passe : ${link}\n\nCe lien expire dans 1 heure. Si vous n'etes pas a l'origine de cette demande, ignorez ce message.`,
      });

      if (mayExposeToken()) {
        return jsonOk({ status: 'sent', devToken: token, devLink: link });
      }
    }

    // meme reponse dans tous les cas : pas d'enumeration de comptes
    return jsonOk({ status: 'sent' });
  } catch (error) {
    return jsonError(error);
  }
}
