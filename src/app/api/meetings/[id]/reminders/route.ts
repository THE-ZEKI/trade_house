import { asUser, callApp, queryWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** GET /api/meetings/:id/reminders — envois par destinataire (B9) */
export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const rows = await asUser(user.userId, (sql) =>
      queryWith(
        sql,
        `select p.id as reminder_id, p.kind, p.total, p.sent_count, p.failed_count, p.pending_count,
                n.user_id, u.email, n.status, n.attempts, n.error_message, n.sent_at, n.opened_at
           from public.v_meeting_reminder_progress p
           left join public.notifications_log n on n.reminder_id = p.id and n.channel = 'email'
           left join public.users u on u.id = n.user_id
          where p.meeting_id = $1::uuid
          order by p.send_at, u.email`,
        [id],
      ),
    );

    return jsonOk({ deliveries: rows });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * POST /api/meetings/:id/reminders — B5 : relance immédiate, ciblée ou non.
 * RG-15 : les participants ayant refusé sont exclus par la base.
 */
export async function POST(request: Request, { params }: Params) {
  const raw = await request.json().catch(() => null);
  const userIds =
    typeof raw === 'object' &&
    raw !== null &&
    Array.isArray((raw as Record<string, unknown>).userIds)
      ? ((raw as Record<string, unknown>).userIds as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : null;

  try {
    const user = await requireUser();
    const { id } = await params;

    const count = await asUser(user.userId, (sql) =>
      callApp<number>(sql, 'app.send_manual_reminder', [
        id,
        userIds,
        typeof raw === 'object' && raw !== null
          ? ((raw as Record<string, unknown>).message as string) ?? null
          : null,
      ]),
    );

    return jsonOk({ status: 'queued', recipients: count ?? 0 });
  } catch (error) {
    return jsonError(error);
  }
}
