/**
 * Page d'accueil provisoire : elle affiche l'etat de la phase 1.
 * Elle sera remplacee par l'ecran de connexion en fin de phase 1.
 */
const phases = [
  { n: 1, titre: 'Socle & authentification', etat: 'en cours' },
  { n: 2, titre: 'Reunions & rappels', etat: 'a venir' },
  { n: 3, titre: 'Rapports & cycle de correction', etat: 'a venir' },
  { n: 4, titre: 'Visio, tableau de bord & production', etat: 'a venir' },
];

export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Trade House</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>
        Plateforme de gestion et de suivi de traders — phase 1
      </p>

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
        <p>
          Etat : voir la route <code>GET /api/health</code> (verifie la connexion et
          l&apos;efficacite du RLS).
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
        <ul style={{ listStyle: 'none', padding: 0 }}>
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
