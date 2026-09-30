import { logout } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout — revoque la session en base puis efface le cookie. */
export async function POST() {
  try {
    await logout();
    return jsonOk({ status: 'logged_out' });
  } catch (error) {
    return jsonError(error);
  }
}
