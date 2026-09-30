import { redirect } from 'next/navigation';
import { currentUser, requireUser, logout } from '@/lib/auth';
import LogoutButton from './LogoutButton';

export const dynamic = 'force-dynamic';

const phases = [
  { n: 1, titre: 'Socle & authentification', etat: 'en cours' },
  { n: 2, titre: 'Reunions & rappels', etat: 'a venir' },
  { n: 3, titre: 'Rapports & cycle de correction', etat: 'a venir' },
  { n: 4, titre: 'Visio, tableau de bord & production', etat: 'a venir' },
];

/**
 * Accueil temporaire de la phase 1.
 * Cette page exige une session valide en base : c'est la vraie barriere,
 * le middleware ne fait que la commodite de navigation.
 */
export default async function Home() {
  // si requireUser leve une erreur 401, on renvoie vers l'ecran de connexion
  let user: Awaited<ReturnType<typeof currentUser>> = null;
  try {
    user = await requireUser();
  } catch {
    redirect('/login');
  }
  if (!user) redirect('/login');

  return (
    <main style={{ maxWidth: 720, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ fontSize: 28, marginBottom: 4 }}>Trade House</h1>
          <p style={{ color: '#6b7280', marginTop: 0 }}>
            Connecte en tant que <strong>{user.fullName}</strong> ({user.role}) —{' '}
            {user.email}
          </p>
        </div>
        <LogoutButton />
      </div>

      <section
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 20,
          margin: '24px 0',
        }}
      >
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Base de donnees</h2>
        <p style={{ margin: 0 }}>
          Etat : <code>GET /api/health</code> — connexion et efficacite du RLS.
        </p>
        <p style={{ margin: '8px 0 0', color: '#6b7280', fontSize: 13 }}>
          Les requetes de cette page passent par <code>asUser()</code> : PostgreSQL filtre les
          lignes selon le role (RG-04, RG-06).
        </p>
      </section>

      <section
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 20,
        }}
      >
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Decoupage</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {phases.map((p) => (
            <li
              key={p.n}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderBottom: '1px solid #f3f4f6',
              }}
            >
              <span>
                <strong>{p.n}.</strong> {p.titre}
              </span>
              <span style={{ color: p.etat === 'en cours' ? '#2563eb' : '#9ca3af' }}>
                {p.etat}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

