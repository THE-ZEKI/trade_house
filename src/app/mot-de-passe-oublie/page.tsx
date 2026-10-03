import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import ForgotForm from './ForgotForm';
import PasswordForm from '../invitation/PasswordForm';

export const metadata = { title: 'Mot de passe oublie — Trade House' };

/**
 * La page a DEUX etats distincts, decides par la presence du jeton :
 *
 *   sans ?token=  -> formulaire de demande (adresse email)
 *   avec ?token=  -> definition du nouveau mot de passe
 *
 * Elle ne montrait que le premier. Le lien envoye par email aboutissait donc
 * sur le formulaire de demande : le destinataire devait recopier le jeton a
 * la main, et rien ne le faisait. C'etait le second maillon casse du parcours
 * (le premier etait app.issue_invitation, corrige en 035).
 *
 * useSearchParams est sous Suspense : sans ce delimiteur, Next.js bloque le
 * rendu statique de la page.
 */
function Body() {
  const params = useSearchParams();
  const token = params.get('token');

  if (token) {
    return <PasswordForm mode="reset" />;
  }

  return (
    <>
      <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 22px' }}>
        Indiquez votre adresse : vous recevrez un lien valable une heure.
      </p>
      <ForgotForm />
    </>
  );
}

export default function ForgotPage() {
  return (
    <main style={{ maxWidth: 420, margin: '48px auto' }}>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 28 }}>
        <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Mot de passe oublie</h1>
        <Suspense fallback={<p style={{ fontSize: 13 }}>Chargement…</p>}>
          <Body />
        </Suspense>
        <p style={{ marginTop: 18, marginBottom: 0 }}>
          <a href="/login" style={{ color: '#374151', fontSize: 13 }}>
            Retour a la connexion
          </a>
        </p>
      </div>
    </main>
  );
}
