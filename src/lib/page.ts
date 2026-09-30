import { redirect } from 'next/navigation';
import { currentUser, type SessionUser } from './auth';

/**
 * Garde de page pour les ecrans proteges.
 *
 * Sept pages repetaient sinon le meme bloc try/catch + redirect. Le detail
 * compte : on intercepte `notFound()` aussi. Sans cela, un identifiant
 * inexistant provoquerait une page d'erreur 500 — une fuite d'information :
 * l'existance d'un rapport est elle-meme une donnee sensible pour un trader.
 */
export async function pageUser(): Promise<SessionUser> {
  let user: SessionUser | null = null;
  try {
    user = await currentUser();
  } catch {
    redirect('/login');
  }
  if (!user) redirect('/login');
  return user;
}

/**
 * Reserve un ecran a certains roles (RG-06).
 *
 * Un role non autorise est renvoye vers l'accueil, pas vers une page 403 :
 * l'accueil reste la seule destination connue de tous les roles.
 */
export async function pageUserAs(
  roles: SessionUser['role'][],
): Promise<SessionUser> {
  const user = await pageUser();
  if (!roles.includes(user.role)) redirect('/');
  return user;
}
