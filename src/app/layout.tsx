import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trade House',
  description: 'Plateforme de gestion et de suivi de traders',
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
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
