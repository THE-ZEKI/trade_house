import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asUser, queryOneWith, queryWith } from '@/lib/db';
import { pageUser } from '@/lib/page';
import Shell from '@/components/Shell';
import { Card, Empty, Badge, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Detail d'une reunion : participants, liens, presence.
 *
 * Aucun bouton « rejoindre » ici. L'entree en salle passe par une URL de jeton
 * a usage unique, qui doit etre emise a la demande et Nvidiae au serveur ;
 * un lien de salle permanent dans une page HTML serait reutilisable par
 * quiconque lit la page. L'ecran affiche donc l'etat, il n'accorde rien.
 */
export default async function MeetingDetail({ params }: Params) {
  const user = await pageUser();
  const { id } = await params;

  const { meeting, participants, attendance } = await asUser(user.userId, async (sql) => ({
    meeting: await queryOneWith<Record<string, unknown>>(
      sql,
      `select m.*, u.full_name as creator_name
         from public.meetings m
         left join public.users u on u.id = m.created_by
        where m.id = $1::uuid`,
      [id],
    ),
    participants: await queryWith(
      sql,
      `select mp.id, mp.rsvp_status, mp.rsvp_at, u.id as user_id,
              u.full_name, u.email, u.role
         from public.meeting_participants mp
         join public.users u on u.id = mp.user_id
        where mp.meeting_id = $1::uuid
        order by u.full_name`,
      [id],
    ),
    attendance: await queryWith(
      sql,
      `select a.*, u.full_name
         from public.meeting_attendance a
         join public.users u on u.id = a.user_id
        where a.meeting_id = $1::uuid
        order by a.joined_at`,
      [id],
    ),
  }));

  if (!meeting) notFound();

  const isEn = user.locale === 'en';
  const fmt = (v: unknown) =>
    v
      ? new Date(String(v)).toLocaleString(isEn ? 'en-GB' : 'fr-FR', {
          weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        })
      : '-';

  const accepted = participants.filter((p) => p.rsvp_status === 'accepted').length;

  return (
    <Shell user={user}>
      <div className="space-y-6">
        <PageHeader
          title={String(meeting.title)}
          subtitle={`${fmt(meeting.starts_at)} · ${String(meeting.duration_min ?? 0)} min`}
          actions={
            <Link href="/meetings" className="text-xs text-accent hover:underline">
              Reunions
            </Link>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={meeting.status === 'completed' ? 'success' : 'info'}>
            {String(meeting.status)}
          </Badge>
          <Badge tone="neutral">{String(meeting.type ?? 'meeting')}</Badge>
          {accepted > 0 && <Badge tone="success">{accepted} confirme(s)</Badge>}
          {meeting.recurrence_rule ? <Badge tone="neutral">recurrente</Badge> : null}
          {meeting.recording_enabled === true ? <Badge tone="neutral">enregistrement</Badge> : null}
        </div>

        <Card title="Details">
          <dl className="divide-y divide-border">
            {(
              [
                ['Description', meeting.description],
                ['Creee par', meeting.creator_name],
                ['Debut reel', fmt(meeting.actual_started_at)],
                ['Fin reelle', fmt(meeting.actual_ended_at)],
                ['Annulee le', fmt(meeting.cancelled_at)],
                ['Motif annulation', meeting.cancellation_reason],
              ] as [string, unknown][]
            ).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <dt className="text-sm text-text-muted">{k}</dt>
                <dd className="text-sm">{v ? String(v) : '-'}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title={`Participants (${accepted}/${participants.length})`}>
          {participants.length === 0 ? (
            <Empty>Aucun participant.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {participants.map((p) => (
                <li key={String(p.id)} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm">{String(p.full_name)}</div>
                    <div className="truncate text-xs text-text-faint">{String(p.email)}</div>
                  </div>
                  <Badge
                    tone={
                      p.rsvp_status === 'accepted' ? 'success'
                        : p.rsvp_status === 'declined' ? 'danger' : 'neutral'
                    }
                  >
                    {String(p.rsvp_status)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Presence">
          {attendance.length === 0 ? (
            <Empty>Aucune connexion enregistree.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {attendance.map((a) => (
                <li key={String(a.id)} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm">{String(a.full_name)}</span>
                  <span className="tnum text-xs text-text-faint">
                    {fmt(a.joined_at)} → {fmt(a.left_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Shell>
  );
}
