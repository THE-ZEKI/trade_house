import { asUser, callApp, callAppSet, queryWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** GET /api/meetings/:id/occurrences — dates calculées de la série (B10) */
export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const { searchParams } = new URL(_request.url);
    const from = searchParams.get('from') ?? new Date().toISOString().slice(0, 10);
    const to = searchParams.get('to') ?? new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);

    const dates = await asUser(null, (sql) =>
      callAppSet<{ occurrence_date: string; occurrence_number: number }>(
        sql,
        'app.meeting_occurrences',
        [id, from, to],
      ),
    );
    const existing = await asUser(user.userId, (sql) =>
      queryWith(
        sql,
        `select occurrence_number, starts_at, status from public.meetings
          where parent_meeting_id = $1::uuid order by occurrence_number`,
        [id],
      ),
    );

    return jsonOk({ rule: { weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY' }, dates, existing });
  } catch (error) {
    return jsonError(error);
  }
}

/** POST — matérialise les occurrences en réunions filles (idempotent) */
export async function POST(request: Request, { params }: Params) {
  const raw = await request.json().catch(() => null);
  const from = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).from : null;
  const to = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).to : null;

  try {
    const user = await requireUser();
    const { id } = await params;

    const created = await asUser(user.userId, (sql) =>
      callApp<number>(sql, 'app.generate_occurrences', [
        id,
        from ?? new Date().toISOString().slice(0, 10),
        to ?? new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10),
      ]),
    );

    return jsonOk({ status: 'generated', created: created ?? 0 });
  } catch (error) {
    return jsonError(error);
  }
}
