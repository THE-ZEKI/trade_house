import { asUser, callApp, queryWith, queryOneWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { meetingCreatedEmail } from '@/lib/email-templates';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** GET /api/meetings/:id — détail, participants, liens, rappels (RLS) */
export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const meeting = await asUser(user.userId, (sql) =>
      queryOneWith(
        sql,
        `select m.id, m.title, m.description, m.type, m.starts_at, m.duration_min, m.status,
                m.current_link_id, m.recurrence_rule, m.created_at, m.cancelled_at,
                v.opens_at, v.closes_at, v.is_room_open
           from public.meetings m
           join public.v_meeting_room_window v on v.id = m.id
          where m.id = $1::uuid`,
        [id],
      ),
    );
    if (!meeting) {
      return jsonOk({ error: { code: 'NOT_FOUND', message: 'Reunion introuvable', rule: null } }, 404);
    }

    const [participants, links, reminders] = await Promise.all([
      asUser(user.userId, (sql) =>
        queryWith(
          sql,
          `select mp.user_id, mp.rsvp_status, mp.rsvp_at, u.full_name, u.email
             from public.meeting_participants mp
             join public.users u on u.id = mp.user_id
            where mp.meeting_id = $1::uuid
            order by u.full_name`,
          [id],
        ),
      ),
      asUser(user.userId, (sql) =>
        queryWith(
          sql,
          `select id, url, provider, added_via, is_current, created_at
             from public.meeting_links where meeting_id = $1::uuid order by created_at desc`,
          [id],
        ),
      ),
      asUser(user.userId, (sql) =>
        queryWith(
          sql,
          `select id, kind, send_at, status, sent_at, link_id, replaces_main_link
             from public.meeting_reminders where meeting_id = $1::uuid order by send_at`,
          [id],
        ),
      ),
    ]);

    return jsonOk({ meeting, participants, links, reminders });
  } catch (error) {
    return jsonError(error);
  }
}

/** PATCH /api/meetings/:id — RG-17 : déplacement de la réunion + rappels reprogrammés */
export async function PATCH(request: Request, { params }: Params) {
  const raw = await request.json().catch(() => null);
  const startsAt = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).startsAt : null;
  const durationMin = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).durationMin : null;

  if (typeof startsAt !== 'string' || Number.isNaN(Date.parse(startsAt))) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Donnees invalides', rule: null } }, 422);
  }

  try {
    const user = await requireUser();
    const { id } = await params;

    await asUser(user.userId, (sql) =>
      callApp(sql, 'app.reschedule_meeting', [
        id,
        new Date(startsAt).toISOString(),
        typeof durationMin === 'number' ? Math.trunc(durationMin) : null,
      ]),
    );

    // email de mise à jour à tous les participants (RG-17)
    const meeting = await asUser(user.userId, (sql) =>
      queryOneWith<{ title: string; starts_at: string }>(
        sql,
        'select title, starts_at from public.meetings where id = $1::uuid',
        [id],
      ),
    );
    const participants = await asUser(user.userId, (sql) =>
      queryWith(
        sql,
        `select u.email, u.preferred_locale from public.meeting_participants mp
           join public.users u on u.id = mp.user_id
          where mp.meeting_id = $1::uuid and u.is_active`,
        [id],
      ),
    );
    for (const p of participants) {
      await sendEmail(
        meetingCreatedEmail({
          email: p.email,
          title: meeting?.title ?? 'Reunion',
          startsAt: meeting?.starts_at ?? new Date(startsAt).toISOString(),
          locale: p.preferred_locale,
        }),
      );
    }

    return jsonOk({ status: 'rescheduled', meetingId: id });
  } catch (error) {
    return jsonError(error);
  }
}

/** DELETE /api/meetings/:id — RG-18 : annulation + suppression des rappels en attente */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const reason = 'Annulation depuis l\'application';

    await asUser(user.userId, (sql) => callApp(sql, 'app.cancel_meeting', [id, reason]));

    const participants = await asUser(user.userId, (sql) =>
      queryWith(
        sql,
        `select u.email, u.preferred_locale from public.meeting_participants mp
           join public.users u on u.id = mp.user_id
          where mp.meeting_id = $1::uuid and u.is_active`,
        [id],
      ),
    );
    for (const p of participants) {
      await sendEmail(
        meetingCreatedEmail({
          email: p.email,
          title: 'Reunion annulee',
          startsAt: new Date().toISOString(),
          locale: p.preferred_locale,
        }),
      );
    }

    return jsonOk({ status: 'cancelled', meetingId: id });
  } catch (error) {
    return jsonError(error);
  }
}