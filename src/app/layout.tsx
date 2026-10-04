import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';

export const metadata: Metadata = {
  title: 'Trade House',
  description: 'Plateforme de gestion et de suivi de traders',
  // Sans ce lien, le navigateur ne trouve pas le manifeste et l'application
  // n'est pas installable. Le fichier vit dans public/ : Next le sert tel quel,
  // ce qui evite une route qui n'aurait aucun autre usage.
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    // Pinned : l'icone des onglets, sur ordinateur.
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    // Sans ces deux proprietes, iOS ouvre l'application dans un onglet Safari.
    // C'est precisement le mode qui NE PERMET PAS les notifications : le push
    // iOS n'existe que pour une application ajoutee a l'ecran d'accueil.
    capable: true,
    title: 'Trade House',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Un tableau de bord consulte sur telephone : le zoom reste a l'utilisateur,
  // on ne le bloque pas comme on le ferait pour une application native.
  themeColor: '#0ea5e9',
};

/**
 * Inter auto-hebergee par next/font : aucune requete vers Google au premier
 * rendu, donc pas de passage du texte en flash ni de fuite d'information sur
 * la navigation de l'utilisateur. Le repli systeme reste declare dans la
 * variable --font-sans si le chargement echoue.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
