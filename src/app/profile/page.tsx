import { asUser, queryOneWith, queryWith } from '@/lib/db';
import { pageUser } from '@/lib/page';
import { t } from '@/lib/i18n';
import Shell from '@/components/Shell';
import { Card, Empty, Badge, PageHeader } from '@/components/ui';
import { ShieldCheck, ShieldOff, KeyRound, FileText } from 'lucide-react';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Mon profil — Trade House' };

/**
 * Profil personnel : consultation seule.
 *
 * Aucune edition en libre. Le nom, l'email et le role sont modifies par la
 * base (`app.update_profile` reserve a certains cas) ; changer son role depuis
 * cette page reviendrait a laisser un utilisateur s'auto-promouvoir, meme
 * partiellement. La langue, elle, se change depuis son compte.
 */
export default async function ProfilePage() {
  const user = await pageUser();

  const { me, sessions, stats } = await asUser(user.userId, async (sql) => ({
    me: await queryOneWith<Record<string, unknown>>(
      sql,
      `select id, email, full_name, phone, role, timezone, preferred_locale,
              is_active, mfa_enrolled, mfa_enforced, last_login_at,
              password_changed_at, created_at
         from public.users where id = $1::uuid`,
      [user.userId],
    ),
    sessions: await queryWith(
      sql,
      `select id, created_at, last_seen_at, ip_address, user_agent
         from public.user_sessions
        where user_id = $1::uuid and revoked_at is null
        order by last_seen_at desc nulls last limit 10`,
      [user.userId],
    ),
    stats: await queryOneWith<{ n: number }>(
      sql,
      'select count(*)::int as n from public.reports where trader_id = $1::uuid',
      [user.userId],
    ),
  }));

  const isEn = user.locale === 'en';
  const fmt = (v: unknown) =>
    v
      ? new Date(String(v)).toLocaleString(isEn ? 'en-GB' : 'fr-FR', {
          day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
        })
      : '-';

  return (
    <Shell user={user}>
      <div className="space-y-6">
        <PageHeader title={t(user.locale, 'nav.profile')} />

        <Card title="Identite">
          <dl className="divide-y divide-border">
            {(
              [
                ['Nom', me?.full_name],
                ['Email', me?.email],
                ['Telephone', me?.phone],
                ['Role', me?.role ? t(user.locale, `role.${me.role}`) : null],
                ['Langue', me?.preferred_locale],
                ['Fuseau', me?.timezone],
                ['Membre depuis', fmt(me?.created_at)],
                ['Mot de passe change', fmt(me?.password_changed_at)],
              ] as [string, unknown][]
            ).map(([label, value]) => (
              <div key={String(label)} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <dt className="text-sm text-text-muted">{label}</dt>
                <dd className="text-sm">{value ? String(value) : '-'}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Securite">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            {me?.mfa_enrolled === true ? (
              <Badge tone="success" Icon={ShieldCheck}>{t(user.locale, 'mfa.enrolled')}</Badge>
            ) : (
              <Badge tone="warn" Icon={ShieldOff}>{t(user.locale, 'mfa.not_enrolled')}</Badge>
            )}
            {me?.mfa_enforced === true && <Badge tone="info" Icon={KeyRound}>{t(user.locale, 'mfa.enforced')}</Badge>}
          </div>
        </Card>

        {user.role === 'trader' && (
          <Card title="Activite">
            <div className="px-4 py-3 text-sm text-text-muted">
              {stats?.n ?? 0} rapport(s) depose(s)
            </div>
          </Card>
        )}

        <Card title="Sessions actives">
          {sessions.length === 0 ? (
            <Empty>Aucune session active.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {sessions.map((s) => (
                <li key={String(s.id)} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="tnum text-sm">{fmt(s.last_seen_at ?? s.created_at)}</div>
                    <div className="truncate text-xs text-text-faint">{String(s.ip_address ?? '')}</div>
                  </div>
                  <span className="truncate text-xs text-text-faint" title={String(s.user_agent ?? '')}>
                    {String(s.user_agent ?? '').slice(0, 40)}
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
