export const metadata = {
  title: 'Trade House',
  description: 'Plateforme de gestion et de suivi de traders',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body
        style={{
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          margin: 0,
          padding: '2rem',
          background: '#f6f7f9',
          color: '#111827',
        }}
      >
        {children}
      </body>
    </html>
  );
}
