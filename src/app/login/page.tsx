import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Connexion — Trade House' };

/**
 * Ecran de connexion.
 * Si une session valide existe deja, le middleware renvoie vers l'accueil ;
 * cette verification en base sert de filet de securite.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await currentUser();
  if (user) redirect('/');

  const { next } = await searchParams;
  const target = next && next.startsWith('/') ? next : '/';

  return (
    <main style={{ maxWidth: 380, margin: '48px auto' }}>
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 14,
          padding: 28,
        }}
      >
        <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Trade House</h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 22px' }}>
          Gestion et suivi de traders
        </p>

        <LoginForm next={target} />

        <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 18, marginBottom: 0 }}>
          Acces reserve aux comptes autorises. En cas d&apos;oubli de mot de passe,
          utilisez la demande de reinitialisation.
        </p>
      </div>
    </main>
  );
}
