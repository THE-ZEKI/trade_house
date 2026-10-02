'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  LayoutDashboard,  FileText,  CalendarDays,  Users,  ScrollText,  Settings, 
  Bell,  UserCircle,  Menu,  X,  ShieldCheck,  GraduationCap, 
} from 'lucide-react';
import type { SessionUser } from '@/lib/auth';
import { t } from '@/lib/i18n';
import type { Table, Tone } from '@/lib/status';
import { spec, TONE_CLASS } from '@/lib/status';
import LogoutButton from '@/app/LogoutButton';

/**
 * Navigation par role (regle 0.4 et DESIGN_SYSTEM §4).
 *
 * Un manager ne voit NI les comptes NI le journal d'audit. Ce n'est pas une
 * question d'affichage : les entrees sont declarees ici par role, donc absentes
 * du HTML. Un element masque en CSS resterait dans la page et dans l'API
 * derriere — ce serait une fausse securite.
 */

type NavItem = {
  href: string;
  labelKey: string;
  roles: SessionUser['role'][];
  Icon: typeof LayoutDashboard;
  /** Onglet de la barre basse en dessous de 640px. */
  tab?: boolean;
};

const NAV: NavItem[] = [
  { href: '/', labelKey: 'nav.dashboard', roles: ['admin', 'manager', 'trader'], Icon: LayoutDashboard, tab: true },
  { href: '/reports', labelKey: 'nav.reports', roles: ['admin', 'manager', 'trader'], Icon: FileText, tab: true },
  { href: '/meetings', labelKey: 'nav.meetings', roles: ['admin', 'manager', 'trader'], Icon: CalendarDays, tab: true },
  // Formation : visible par tous, mais le contenu differe entierement selon le
  // role (cours a ecrire et a attribuer / cours a suivre). Le masquer au trader
  // le priverait de sa propre page de travail.
  { href: '/training', labelKey: 'nav.training', roles: ['admin', 'manager', 'trader'], Icon: GraduationCap },
  { href: '/users', labelKey: 'nav.users', roles: ['admin'], Icon: Users },
  { href: '/audit', labelKey: 'nav.audit', roles: ['admin'], Icon: ScrollText },
  { href: '/settings', labelKey: 'nav.settings', roles: ['admin'], Icon: Settings },
];

/** Compteur de presence : initiales sur fond bleu ciel. */
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function NavLink({
  item,
  active,
  locale,
  onNavigate,
  compact,
}: {
  item: NavItem;
  active: boolean;
  locale: string | null;
  onNavigate?: () => void;
  compact?: boolean;
}) {
  const label = t(locale, item.labelKey);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={compact ? label : undefined}
      className={[
        'flex items-center gap-3 rounded-md text-sm transition-colors',
        'border-l-[3px] pl-3 pr-3 py-2.5',
        active
          ? 'border-l-sky-500 bg-sky-100 font-semibold text-sky-700'
          : 'border-l-transparent text-text-muted hover:bg-surface-alt hover:text-text',
        compact ? 'justify-center' : '',
      ].join(' ')}
    >
      <item.Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2.2} />
      {!compact && <span className="truncate">{label}</span>}
    </Link>
  );
}

/** Puce de statut : reutilisee par le profil et la barre du drawer. */
export function RolePill({ role, locale }: { role: string; locale: string | null }) {
  const table: Table = {
    admin: { icon: ShieldCheck, tone: 'accent' as Tone },
    manager: { icon: Users, tone: 'info' as Tone },
    trader: { icon: UserCircle, tone: 'neutral' as Tone },
  };
  const { Icon, tone } = spec(table, role);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill border px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASS[tone]}`}
    >
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {t(locale, `role.${role}`)}
    </span>
  );
}

export default function Shell({
  user,
  unread = 0,
  children,
}: {
  user: SessionUser;
  unread?: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => n.roles.includes(user.role));
  const tabs = items.filter((n) => n.tab);
  const locale = user.locale;

  // Le drawer se referme a chaque navigation : le laisser ouvert sur la page
  // suivante est le comportement le plus deroutant en mobile.
  useEffect(() => { setOpen(false); }, [pathname]);

  // Echap referme le drawer, comme attendu de tout panneau modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Le corps ne doit plus defiler quand le drawer est ouvert.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const sidebar = (
    <>
      <div className="px-5 py-5">
        <div className="text-[15px] font-bold tracking-tight text-text">{t(locale, 'app.name')}</div>
        <div className="mt-0.5 text-xs text-text-faint">{t(locale, 'app.tagline')}</div>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {items.map((n) => (
          <NavLink key={n.href} item={n} active={isActive(n.href)} locale={locale} />
        ))}
      </nav>
      <div className="border-t border-border p-3">
        <Link
          href="/profile"
          className="flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-surface-alt"
        >
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-sky-100 text-xs font-bold text-sky-700">
            {initials(user.fullName)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{user.fullName}</span>
            <RolePill role={user.role} locale={locale} />
          </span>
        </Link>
        <LogoutButton label={t(locale, 'action.logout')} />
      </div>
    </>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      {/* Desktop : sidebar pleine. Tablette : rail d'icones 72px avec
          infobulle au survol. Sous 1024px : rien, la navigation passe en
          topbar + barre d'onglets. */}
      <aside className="hidden border-r border-border bg-surface lg:flex lg:flex-col">
        {sidebar}
      </aside>

      <aside className="hidden w-[72px] flex-col border-r border-border bg-surface md:flex lg:hidden">
        <div className="flex justify-center px-3 py-5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-pill bg-sky-100 text-xs font-bold text-sky-700">
            {initials(user.fullName)}
          </span>
        </div>
        <nav className="flex-1 space-y-1 px-2">
          {items.map((n) => (
            <NavLink key={n.href} item={n} active={isActive(n.href)} locale={locale} compact />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-2 border-b border-border bg-surface/90 px-4 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Ouvrir le menu"
              aria-expanded={open}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-text-muted hover:bg-surface-alt lg:hidden"
            >
              <Menu className="h-5 w-5" strokeWidth={2.2} />
            </button>
            <div className="text-[15px] font-bold tracking-tight md:hidden">
              {t(locale, 'app.name')}
            </div>
          </div>

          <Link
            href="/notifications"
            className="relative inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm text-text-muted hover:bg-surface-alt"
          >
            <Bell className="h-5 w-5" strokeWidth={2.2} />
            <span className="hidden sm:inline">{t(locale, 'nav.notifications')}</span>
            {unread > 0 && (
              <span className="tnum inline-flex min-w-[20px] items-center justify-center rounded-pill bg-sky-500 px-1.5 py-0.5 text-[11px] font-bold text-white">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Link>
        </header>

        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-5 pb-24 md:px-6 md:py-6 lg:pb-6">
          {children}
        </main>
      </div>



      {/* Drawer mobile : plein hauteur, hors-champ, fermable par Echap. */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Fermer le menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-[#0c4a6e]/40"
          />
          <div className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col bg-surface shadow-[var(--shadow-lg)]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-bold">{t(locale, 'app.name')}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                className="inline-flex h-11 w-11 items-center justify-center rounded-md text-text-muted hover:bg-surface-alt"
              >
                <X className="h-5 w-5" strokeWidth={2.2} />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{sidebar}</div>
          </div>
        </div>
      )}

      {/* Barre d'onglets fixe : le seul point d'acces stable en mobile, ou la
          sidebar n'existe pas. Le nombre de colonnes suit le nombre d'onglets
          autorises par le role. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
        style={{ gridTemplateColumns: `repeat(${Math.max(tabs.length, 1)}, minmax(0, 1fr))` }}
      >
        {tabs.map((n) => {
          const active = isActive(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? 'page' : undefined}
              className={[
                'flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium',
                active ? 'text-sky-700' : 'text-text-muted',
              ].join(' ')}
            >
              <n.Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
              <span className="truncate">{t(locale, n.labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
