import { Suspense } from 'react';
import ForgotForm from './ForgotForm';

export const metadata = { title: 'Mot de passe oublie — Trade House' };

export default function ForgotPage() {
  return (
    <main style={{ maxWidth: 420, margin: '48px auto' }}>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 28 }}>
        <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Mot de passe oublie</h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 22px' }}>
          Indiquez votre adresse : vous recevrez un lien valable une heure.
        </p>
        <Suspense fallback={<p style={{ fontSize: 13 }}>Chargement…</p>}>
          <ForgotForm />
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
