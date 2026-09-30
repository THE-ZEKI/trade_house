import { Suspense } from 'react';
import PasswordForm from './PasswordForm';

export const metadata = { title: 'Activer votre compte — Trade House' };

/** RG-05 : le lien d'invitation expire apres 7 jours. */
export default function InvitationPage() {
  return (
    <main style={{ maxWidth: 420, margin: '48px auto' }}>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 28 }}>
        <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Activer votre compte</h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 22px' }}>
          Choisissez un mot de passe conforme a la politique de securite.
        </p>
        <Suspense fallback={<p style={{ fontSize: 13 }}>Chargement…</p>}>
          <PasswordForm mode="invitation" />
        </Suspense>
      </div>
    </main>
  );
}
