import { asUser, callApp, queryWith, queryOneWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { meetingCreatedEmail, reminderEmail } from '@/lib/email-templates';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

const TYPES = ['internal', 'external', 'instant'];
const PROVIDERS = ['zoom', 'meet', 'teams', 'other'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CreateMeeting = {
  title: string;
  description: string | null;
  type: string;
  startsAt: string;
  durationMin: number;
  participants: string[];
  linkUrl: string | null;
  linkProvider: string;
  message: string | null;
};

/** Validation explicite : pas de dependance externe (zod v4 casse ici). */
function parseBody(raw: unknown): CreateMeeting | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const b = raw as Record<string, unknown>;

  const title = typeof b.title === 'string' ? b.title.trim() : '';
  const type = typeof b.type === 'string' ? b.type : '';
  const startsAt = typeof b.startsAt === 'string' ? b.startsAt : '';
  const participants = Array.isArray(b.participants) ? b.participants : [];

  if (!title || title.length > 200) return null;
  if (!TYPES.includes(type)) return null;
  if (Number.isNaN(Date.parse(startsAt))) return null;
  if (participants.length < 1 || !participants.every((p) => typeof p === 'string' && UUID.test(p))) {
    return null;
  }
  const durationMin = typeof b.durationMin === 'number' ? Math.trunc(b.durationMin) : 60;
  if (durationMin < 5 || durationMin > 1440) return null;

  const linkUrl = typeof b.linkUrl === 'string' ? b.linkUrl : null;
  if (linkUrl && !linkUrl.startsWith('https://')) return null;

  return {
    title,
    description: typeof b.description === 'string' ? b.description : null,
    type,
    startsAt: new Date(startsAt).toISOString(),
    durationMin,
    participants: participants as string[],
    linkUrl,
    linkProvider: typeof b.linkProvider === 'string' && PROVIDERS.includes(b.linkProvider)
      ? b.linkProvider
      : 'other',
    message: typeof b.message === 'string' ? b.message : null,
  };
}

/** GET /api/meetings — liste filtrée par le RLS (RG-04, RG-06) */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const upcoming = searchParams.get('upcoming') !== 'false';

    const rows = await asUser(user.userId, (sql) =>
      queryWith(
        sql,
        `select m.id, m.title, m.description, m.type, m.starts_at, m.duration_min,
                m.status, m.current_link_id, m.recurrence_rule, m.created_at,
                (select count(*)::int from public.meeting_participants mp
                  where mp.meeting_id = m.id) as participants_count,
                (select v.is_room_open from public.v_meeting_room_window v where v.id = m.id) as room_open,
                (select mp.rsvp_status from public.meeting_participants mp
                  where mp.meeting_id = m.id and mp.user_id = $1::uuid) as my_rsvp
           from public.meetings m
          where ($2::meeting_status is null or m.status = $2::meeting_status)
            and ($3::boolean = false or m.starts_at >= now() - interval '1 day')
          order by m.starts_at desc
          limit 200`,
        [user.userId, status, upcoming],
      ),
    );

    return jsonOk({ meetings: rows });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * POST /api/meetings — B1, B2, RG-10, RG-11, RG-14
 * Les règles (participant minimum, date future, lien https, rappels par défaut,
 * notifications) sont appliquées par app.create_meeting, en une transaction.
 */
export async function POST(request: Request) {
  const body = parseBody(await request.json().catch(() => null));
  if (!body) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Donnees invalides', rule: null } }, 422);
  }

  try {
    const user = await requireUser();

    // RG-10 : les conflits d'horaires sont un AVERTISSEMENT, pas un blocage
    const conflicts = await asUser(user.userId, (sql) =>
      queryWith(
        sql,
        'select * from app.meeting_conflicts($1::uuid[], $2::timestamptz, $3::int)',
        [body.participants, body.startsAt, body.durationMin],
      ),
    );

    const meeting = await asUser(user.userId, (sql) =>
      callApp<{ id: string; title: string; starts_at: string; type: string }>(
        sql,
        'app.create_meeting',
        [
          body.title,
          body.description ?? null,
          body.type,
          body.startsAt,
          body.durationMin,
          body.participants,
          body.linkUrl ?? null,
          body.linkProvider,
          null,
          body.message ?? null,
        ],
      ),
    );
    if (!meeting) return jsonOk({ error: { code: 'INTERNAL', message: 'Creation impossible' } }, 500);

    // email d'invitation a chaque participant (la base a deja cree les
    // notifications in-app et les rappels)
    const participants = await asUser(user.userId, (sql) =>
      queryWith(
        sql,
        `select u.email, u.full_name, u.preferred_locale
           from public.meeting_participants mp
           join public.users u on u.id = mp.user_id
          where mp.meeting_id = $1::uuid and u.is_active`,
        [meeting.id],
      ),
    );
    for (const p of participants) {
      await sendEmail(
        meetingCreatedEmail({
          email: p.email,
          title: meeting.title,
          startsAt: meeting.starts_at,
          locale: p.preferred_locale,
        }),
      );
    }

    return jsonOk(
      { status: 'created', meeting, warnings: conflicts.length ? { conflicts } : undefined },
      201,
    );
  } catch (error) {
    return jsonError(error);
  }
}
