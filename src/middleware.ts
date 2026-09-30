import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/constants';

/**
 * Protection des routes.
 *
 * ATTENTION — ce fichier tourne sur le runtime EDGE, ou le pilote PostgreSQL
 * n'est pas disponible. On ne peut donc PAS interroger la base ici : on se
 * contente de verifier la PRESENCE du cookie.
 *
 * Ce n'est pas une barriere de securite, c'est un confort : sans cela,
 * un utilisateur sans session verrait clignoter l'ecran de connexion avant
 * d'etre redirige. La verification reelle se fait dans currentUser()
 * (runtime Node) sur chaque page et chaque route : un cookie present ne
 * prouve rien, il est revalide en base a chaque requete.
 */

const PUBLIC_FILE = /\.(?:svg|png|jpg|jpeg|gif|ico|webmanifest|woff2?|ttf)$/i;

const PUBLIC_PAGES = ['/login', '/mot-de-passe-oublie', '/invitation'];

const PUBLIC_API = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/accept-invitation',
  '/api/auth/password/forgot',
  '/api/auth/password/reset',
  '/api/auth/mfa/challenge',
  // les jobs cron s'authentifient eux-memes via l'en-tete Authorization
  // et le secret CRON_SECRET (cf. src/app/api/cron/send-reminders/route.ts)
  '/api/cron',
  '/api/health',
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_FILE.test(pathname)) return true;
  if (PUBLIC_PAGES.includes(pathname)) return true;
  return PUBLIC_API.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) {
    // deja connecte et sur une page publique -> on renvoie vers l'accueil
    if (pathname === '/login' && request.cookies.has(SESSION_COOKIE)) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  if (!request.cookies.has(SESSION_COOKIE)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Session absente', rule: null } },
        { status: 401 },
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'],
};
