import { currentUser } from '@/lib/auth';
import { jsonOk } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/me
 * Renvoie l'utilisateur de la session courante, ou 200 { user: null }.
 * Sert au client pour afficher la bonne interface selon le role.
 */
export async function GET() {
  const user = await currentUser();
  return jsonOk({ user });
}
