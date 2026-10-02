import { asUser, callApp } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'accepted', 'declined', 'maybe'];

/** POST /api/meetings/:id/rsvp — B7 : Accepté / Refusé / Peut-être */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const raw = await request.json().catch(() => null);
  const status = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).status : null;

  if (typeof status !== 'string' || !STATUSES.includes(status)) {
    return jsonOk(
      { error: { code: 'VALIDATION', message: 'Statut invalide', rule: null } },
      422,
    );
  }

  try {
    const user = await requireUser();
    const { id } = await params;

    // app.rsvp utilise app.current_user_id() : la session doit etre active
    await asUser(user.userId, (sql) => callApp(sql, 'app.rsvp', [id, status]));

    return jsonOk({ status: 'ok', meetingId: id, rsvp: status });
  } catch (error) {
    return jsonError(error);
  }
}
