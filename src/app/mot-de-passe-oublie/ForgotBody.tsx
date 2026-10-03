'use client';

import { useSearchParams } from 'next/navigation';
import ForgotForm from './ForgotForm';
import PasswordForm from '../invitation/PasswordForm';

/**
 * La page a DEUX etats distincts, decides par la presence du jeton :
 *
 *   sans ?token=  -> formulaire de demande (adresse email)
 *   avec ?token=  -> definition du nouveau mot de passe
 *
 * Elle ne montrait que le premier. Le lien envoye par email aboutissait donc
 * sur le formulaire de demande : le destinataire devait recopier le jeton a la
 * main, et rien ne le faisait. C'etait le second maillon casse du parcours (le
 * premier etait app.issue_invitation, corrige en 035).
 *
 * Ce composant est separe de page.tsx et marque « use client » parce que
 * useSearchParams est un hook : l'importer dans un composant serveur fait
 * echouer le build (« This React Hook only works in a Client Component »).
 * page.tsx le rend sous Suspense, ce qui evite aussi de rendre toute la route
 * dynamique.
 */
export default function ForgotBody() {
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
