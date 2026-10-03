import { queryOne, withTransaction, callApp } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { appUrl, mayExposeToken, sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * Les valeurs sont inserees dans du HTML construit a la main : le nom vient
 * d'une saisie utilisateur. Sans echappement, un nom contenant « < » ou une
 * balise modifierait le message rendu, et un guillemet dans un attribut
 * casserait le href du bouton.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
      // app.issue_invitation NE PEUT PAS servir ici : pour purpose
      // 'password_reset' elle exige app.is_admin(), et cette route est anonyme
      // (personne n'est connecte au moment de la demande) -> 409 systematique.
      // app.issue_password_reset est le chemin dedie au parcours autonome : meme
      // jeton, meme duree, mais limite a CE compte-la (035).
      const token = await withTransaction((sql) =>
        callApp<string>(sql, 'app.issue_password_reset', [account.id]),
      );
      const link = `${appUrl()}/mot-de-passe-oublie?token=${token}`;
      await sendEmail({
        to: account.email,
        subject: 'Reinitialisation de votre mot de passe',
        text: `Bonjour ${account.full_name},\n\nChoisissez un nouveau mot de passe : ${link}\n\nCe lien expire dans 1 heure. Si vous n'etes pas a l'origine de cette demande, ignorez ce message.`,
        // Version HTML indispensable : en text/plain seul, Gmail n'auto-lienifie
        // pas une URL longue renforcee d'un jeton, et le destinataire doit
        // selectionner la ligne a la main — ce qu'il ne fait jamais. Le bouton
        // ci-dessous porte le lien ; le texte reste en repli pour les clients
        // qui n'affichent pas le HTML.
        html: `<p>Bonjour ${escapeHtml(account.full_name)},</p>
<p>Choisissez un nouveau mot de passe :</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#0284c7;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Definir mon mot de passe</a></p>
<p style="font-size:13px;color:#64748b">Ou copiez ce lien :<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
<p style="font-size:13px;color:#64748b">Ce lien expire dans 1 heure. Si vous n'etes pas a l'origine de cette demande, ignorez ce message.</p>`,
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
