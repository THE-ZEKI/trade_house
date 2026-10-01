import Link from 'next/link';
import { asUser, queryWith } from '@/lib/db';
import { pageUser } from '@/lib/page';
import { t } from '@/lib/i18n';
import Shell from '@/components/Shell';
import { Card, Empty, RsvpBadge, CodeBadge, PageHeader } from '@/components/ui';
import { MEETING_STATUS, LINK_PROVIDER } from '@/lib/status';
import RsvpButtons from '@/components/RsvpButtons';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Reunions — Trade House' };

/**
 * Reunion a venir et reunions passees (F2).
 *
 * Le RLS restreint aux participants : un trader qui ouvre l'URL d'une reunion
 * dont il n'est pas invite ne recoit rien. On ne se contente donc pas de
 * masquer le bouton de connexion — l'absence de ligne EST la protection.
 */
export default async function MeetingsPage() {
  const user = await pageUser();
  const isTrader = user.role === 'trader';

  const { upcoming, past } = await asUser(user.userId, async (sql) => ({
    upcoming: await queryWith(
      sql,
      `select m.id, m.title, m.starts_at, m.duration_min, m.type, m.status,
              m.recurrence_rule,
              (select count(*)::int from public.meeting_participants p
                where p.meeting_id = m.id) as participants_count,
              (select count(*)::int from public.meeting_participants p
                where p.meeting_id = m.id and p.rsvp_status = 'accepted') as accepted_count,
              (select mp.rsvp_status from public.meeting_participants mp
                where mp.meeting_id = m.id and mp.user_id = $1::uuid) as rsvp_status
         from public.meetings m
        where m.starts_at >= now() - interval '2 hours' and m.status = 'scheduled'
        order by m.starts_at
        limit 50`,
      [user.userId],
    ),
    // L'historique est necessaire au coach, pas au trader : limite a 20.
    past: await queryWith(
      sql,
      isTrader
        ? `select m.id, m.title, m.starts_at, m.actual_ended_at, m.status
             from public.meetings m
             join public.meeting_participants mp on mp.meeting_id = m.id
            where mp.user_id = $1::uuid and m.starts_at < now() - interval '2 hours'
            order by m.starts_at desc limit 20`
        : `select m.id, m.title, m.starts_at, m.actual_ended_at, m.status
             from public.meetings m
            where m.starts_at < now() - interval '2 hours'
            order by m.starts_at desc limit 20`,
      isTrader ? [user.userId] : [],
    ),
  }));

  const isEn = user.locale === 'en';
  const fmtWhen = (v: unknown) =>
    v
      ? new Date(String(v)).toLocaleString(isEn ? 'en-GB' : 'fr-FR', {
          weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        })
      : '-';

  return (
    <Shell user={user}>
      <div className="space-y-6">
        <PageHeader
          title={t(user.locale, 'nav.meetings')}
          subtitle={upcoming.length > 0 ? `${upcoming.length} a venir` : undefined}
        />

        <Card title="A venir">
          {upcoming.length === 0 ? (
            <Empty>{t(user.locale, 'empty.meetings')}</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {upcoming.map((m) => (
                <li key={String(m.id)} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <Link href={`/meetings/${m.id}`} className="block truncate text-sm hover:underline">
                      {String(m.title)}
                    </Link>
                    <div className="tnum mt-0.5 text-xs text-text-faint">
                      {fmtWhen(m.starts_at)} · {String(m.duration_min ?? 0)} min
                      {m.recurrence_rule ? ' · recurrente' : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {isTrader ? (
                      <RsvpButtons
                        meetingId={String(m.id)}
                        current={typeof m.rsvp_status === 'string' ? m.rsvp_status : null}
                        locale={user.locale}
                        compact
                      />
                    ) : (
                      <span className="tnum text-xs text-text-faint">
                        {String(m.accepted_count ?? 0)}/{String(m.participants_count ?? 0)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Passees">
          {past.length === 0 ? (
            <Empty>Aucune reunion passee.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {past.map((m) => (
                <li key={String(m.id)} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <Link href={`/meetings/${m.id}`} className="block truncate text-sm hover:underline">
                      {String(m.title)}
                    </Link>
                    <div className="tnum mt-0.5 text-xs text-text-faint">{fmtWhen(m.starts_at)}</div>
                  </div>
                  <CodeBadge table={MEETING_STATUS} code={m.status} locale={user.locale} prefix="meeting" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Shell>
  );
}
