import type { Metadata, Viewport } from 'next';
import './globals.css';
import { t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Trade House',
  description: 'Plateforme de gestion et de suivi de traders',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // un tableau de bord consulte sur telephone : zoom laisse a l'utilisateur,
  // on ne le bloque pas comme on le ferait pour une application native.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
