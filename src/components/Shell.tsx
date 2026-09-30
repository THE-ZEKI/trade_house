import Link from 'next/link';
import type { SessionUser } from '@/lib/auth';
import { t } from '@/lib/i18n';
import LogoutButton from '@/app/LogoutButton';

type NavItem = { href: string; labelKey: string; roles: SessionUser['role'][] };

/**
 * Navigation par role (RG-06).
 *
 * Un manager ne voit NI les comptes NI le journal d'audit : ce n'est pas une
 * simple question d'affichage, c'est une interdiction. Les entrees sont donc
 * declarees ici par role, et non filtrees en CSS — un element masque reste
 * dans le HTML et dans l'API derriere.
 */
const NAV: NavItem[] = [
  { href: '/', labelKey: 'nav.dashboard', roles: ['admin', 'manager', 'trader'] },
  { href: '/reports', labelKey: 'nav.reports', roles: ['admin', 'manager', 'trader'] },
  { href: '/meetings', labelKey: 'nav.meetings', roles: ['admin', 'manager', 'trader'] },
  { href: '/users', labelKey: 'nav.users', roles: ['admin'] },
  { href: '/audit', labelKey: 'nav.audit', roles: ['admin'] },
  { href: '/settings', labelKey: 'nav.settings', roles: ['admin'] },
];

export default function Shell({
  user,
  unread = 0,
  children,
}: {
  user: SessionUser;
  unread?: number;
  children: React.ReactNode;
}) {
  const items = NAV.filter((n) => n.roles.includes(user.role));

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      {/* Navigation laterale : fixe sur grand ecran, tiroir sur mobile. */}
      <aside className="hidden lg:flex lg:flex-col lg:border-r lg:border-border lg:bg-surface">
        <div className="px-5 py-5">
          <div className="text-[15px] font-semibold tracking-tight">{t(user.locale, 'app.name')}</div>
          <div className="mt-0.5 text-xs text-text-faint">{t(user.locale, 'app.tagline')}</div>
        </div>

        <nav className="flex-1 space-y-0.5 px-3">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="block rounded-lg px-3 py-2 text-sm text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
            >
              {t(user.locale, n.labelKey)}
            </Link>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <Link href="/profile" className="block rounded-lg px-3 py-2 hover:bg-surface-3">
            <div className="truncate text-sm font-medium">{user.fullName}</div>
            <div className="text-xs text-text-faint">{t(user.locale, `role.${user.role}`)}</div>
          </Link>
          <LogoutButton label={t(user.locale, 'action.logout')} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Barre haute : mobile d'abord, et compteur de notifications (F4). */}
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 lg:px-8">
          <div className="text-sm font-medium lg:hidden">{t(user.locale, 'app.name')}</div>
          <div className="hidden text-sm text-text-muted lg:block" />
          <Link
            href="/notifications"
            className="relative rounded-lg px-2 py-1.5 text-sm text-text-muted hover:bg-surface-3"
          >
            {t(user.locale, 'nav.notifications')}
            {unread > 0 && (
              <span className="tnum ml-1.5 inline-flex min-w-[20px] items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[11px] font-medium text-white">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Link>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
