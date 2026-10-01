import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TrendingUp } from 'lucide-react';
import { currentUser } from '@/lib/auth';
import { t } from '@/lib/i18n';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Connexion — Trade House' };

/**
 * Ecran de connexion (DESIGN_SYSTEM §6.1).
 *
 * Fond degrade ciel, carte blanche centree. C'est la toute premiere impression
 * de l'application : elle doit etre calme, et ne rien reveler de l'etat du
 * compte avant d'avoir demande le mot de passe.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await currentUser();
  if (user) redirect('/');

  const { next } = await searchParams;
  // On n'accepte qu'un chemin interne : une URL complete permettrait une
  // redirection ouverte vers un site tiers apres connexion.
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-lg bg-sky-500 shadow-[var(--shadow-md)]">
            <TrendingUp className="h-7 w-7 text-white" strokeWidth={2.5} />
          </span>
          <div>
            <h1 className="text-[26px] font-bold leading-tight tracking-tight">
              {t('fr', 'app.name')}
            </h1>
            <p className="mt-0.5 text-sm text-text-muted">{t('fr', 'app.tagline')}</p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface px-6 py-6 shadow-[var(--shadow-md)]">
          <LoginForm next={target} />

          <p className="mt-6 border-t border-border pt-4 text-center text-xs leading-relaxed text-text-faint">
            Acces reserve aux comptes autorises.
            <br />
            Mot de passe oublie ?{' '}
            <Link href="/mot-de-passe-oublie" className="font-semibold text-sky-700 hover:underline">
              Reinitialiser
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
