import type { ComponentType, ReactNode } from 'react';
import Link from 'next/link';
import { t } from '@/lib/i18n';
import {
  spec, TONE_CLASS, REPORT_STATUS, RSVP, ALERT_FLAGS, PLAN,
  type Table, type Tone,
} from '@/lib/status';

/**
 * Composants de base (DESIGN_SYSTEM §5).
 *
 * Regle 0.2 appliquee partout : un statut = icone + libelle + teinte. Jamais
 * une pastille de couleur seule — en niveaux de gris, ou pour un daltonien,
 * l'information doit rester entiere.
 */

type IconType = ComponentType<{ className?: string; strokeWidth?: number }>;

export function Badge({
  children,
  tone = 'neutral',
  Icon,
  className = '',
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  Icon?: IconType;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-1 text-xs font-semibold ${TONE_CLASS[tone]} ${className}`}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />}
      {children}
    </span>
  );
}

/** Statut de rapport — le cas le plus courant, donc un raccourci. */
export function StatusBadge({
  status,
  locale,
  className,
}: {
  status: string;
  locale: string | null;
  className?: string;
}) {
  const { Icon, tone, known } = spec(REPORT_STATUS, status);
  // Statut inconnu : le code s'affiche tel quel, en teinte neutre. Un manque
  // doit se voir ; le disparaitre laisserait croire a un bug.
  const label = known ? t(locale, `status.${status}`) : status;
  return (
    <Badge tone={tone} Icon={Icon} className={className} title={known ? undefined : 'statut inconnu'}>
      {label}
    </Badge>
  );
}

export function RsvpBadge({
  status,
  locale,
  className,
}: {
  status: unknown;
  locale: string | null;
  className?: string;
}) {
  const key = typeof status === 'string' && status ? status : 'pending';
  const { Icon, tone, known } = spec(RSVP, key);
  return (
    <Badge tone={tone} Icon={Icon} className={className}>
      {known ? t(locale, `rsvp.${key}`) : key}
    </Badge>
  );
}

/** Badge generique pilote par une table code -> presentation. */
export function CodeBadge({
  table,
  code,
  locale,
  prefix,
  className,
}: {
  table: Table;
  code: unknown;
  locale: string | null;
  /** Prefixe i18n : `status`, `rsvp`, `meeting`, `send`… */
  prefix: string;
  className?: string;
}) {
  const key = typeof code === 'string' ? code : '';
  const { Icon, tone, known } = spec(table, key);
  return (
    <Badge tone={tone} Icon={Icon} className={className}>
      {known ? t(locale, `${prefix}.${key}`) : key}
    </Badge>
  );
}

/** Les trois badges d'alerte d'un rapport. Ils peuvent coexister. */
export function ReportFlags({
  locale,
  isCritical,
  isLate,
  isStale,
}: {
  locale: string | null;
  isCritical?: boolean | null;
  isLate?: boolean | null;
  isStale?: boolean | null;
}) {
  const on = { critical: isCritical === true, late: isLate === true, stale: isStale === true };


  if (!on.critical && !on.late && !on.stale) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {on.critical && (
        <Badge tone={ALERT_FLAGS.critical.tone} Icon={ALERT_FLAGS.critical.icon}>
          {t(locale, ALERT_FLAGS.critical.labelKey)}
        </Badge>
      )}
      {on.late && (
        <Badge tone={ALERT_FLAGS.late.tone} Icon={ALERT_FLAGS.late.icon}>
          {t(locale, ALERT_FLAGS.late.labelKey)}
        </Badge>
      )}
      {on.stale && (
        <Badge tone={ALERT_FLAGS.stale.tone} Icon={ALERT_FLAGS.stale.icon}>
          {t(locale, ALERT_FLAGS.stale.labelKey)}
        </Badge>
      )}
    </span>
  );
}

/** Plan respecte ou non. Le libelle reste toujours visible. */
export function PlanBadge({
  respected,
  locale,
}: {
  respected: boolean | null | undefined;
  locale: string | null;
}) {
  const s = respected ? PLAN.yes : PLAN.no;
  return (
    <Badge tone={s.tone} Icon={s.icon}>
      {t(locale, s.labelKey)}
    </Badge>
  );
}

export function Card({
  title,
  action,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-border bg-surface shadow-[var(--shadow-sm)] ${className}`}
    >
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
          {action}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/**
 * Carte de chiffre cle.
 *
 * Le sous-texte porte la REGLE (« aucun rapport depuis 3 jours »), pas une
 * precision : c'est ce qui transforme un chiffre en information.
 */
export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  Icon,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: Tone;
  Icon?: IconType;
  href?: string;
}) {
  const valueColor =
    tone === 'danger' ? 'text-danger-fg' : tone === 'warn' ? 'text-warn-fg' : 'text-text';

  const body = (
    <div className="rounded-lg border border-border bg-surface px-5 py-4 shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)]">
      <div className="flex items-center gap-2.5">
        {Icon && (
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-pill bg-sky-100">
            <Icon className="h-[18px] w-[18px] text-sky-700" strokeWidth={2.5} />
          </span>
        )}
        <span className="text-sm text-text-muted">{label}</span>
      </div>
      <div className={`tnum mt-2 text-[32px] font-bold leading-none ${valueColor}`}>{value}</div>
      {hint && <div className="mt-1.5 text-xs text-text-faint">{hint}</div>}
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

/** En-tete d'ecran : titre, sous-titre, actions a droite. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-bold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Etat vide (design system §8).
 *
 * Trois elements toujours presents : illustration, titre, action. Un etat vide
 * qui constate seulement l'absence laisse l'utilisateur devant un mur.
 */
export function Empty({
  title,
  children,
  action,
  Icon,
}: {
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  Icon?: IconType;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {Icon && (
        <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-pill bg-sky-100">
          <Icon className="h-7 w-7 text-sky-500" strokeWidth={1.8} />
        </span>
      )}
      {title && <p className="text-base font-semibold">{title}</p>}
      {children && <p className="mt-1 max-w-sm text-sm text-text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Bouton : primaire, secondaire, ghost ou danger doux. */
export function Button({
  children,
  variant = 'primary',
  Icon,
  className = '',
  ...rest
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  Icon?: IconType;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles: Record<string, string> = {
    primary: 'bg-sky-500 text-white hover:bg-sky-600 border border-transparent',
    secondary: 'bg-white text-sky-700 border border-border-strong hover:bg-sky-50',
    ghost: 'bg-transparent text-text-muted border border-transparent hover:bg-surface-alt',
    danger: 'bg-danger-bg text-danger-fg border border-danger-bd hover:brightness-97',
  };
  return (
    <button
      {...rest}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 md:h-10 ${styles[variant]} ${className}`}
    >
      {Icon && <Icon className="h-4 w-4" strokeWidth={2.5} />}
      {children}
    </button>
  );
}
