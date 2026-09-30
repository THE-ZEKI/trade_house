import type { ReactNode } from 'react';
import { t, type Lang } from '@/lib/i18n';

/**
 * Petits composants partages.
 *
 * Volontairement peu de briques : un tableau de bord se juge a la lisibilite,
 * pas a la richesse du design system. Chaque composant qui existe ici existe
 * parce qu'il est utilise au moins trois fois.
 */

const TONES = {
  neutral: 'bg-surface-3 text-text-muted',
  info: 'bg-accent-soft text-accent',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  success: 'bg-success-soft text-success',
} as const;

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Teinte d'un statut de rapport.
 * Le code est stocke en base (RG-53) ; la couleur est une convention de
 * presentation. Les statuts « en attente d'action » ressortent volontairement.
 */
const STATUS_TONE: Record<string, keyof typeof TONES> = {
  draft: 'neutral',
  submitted: 'info',
  in_review: 'info',
  correction_requested: 'warn',
  resubmitted: 'info',
  validated: 'success',
  dismissed: 'danger',
  declared: 'neutral',
};

export function StatusBadge({ status, locale }: { status: string; locale: string | null }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'}>
      {t(locale as Lang, `status.${status}`)}
    </Badge>
  );
}

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-border bg-surface shadow-[var(--shadow-card)] ${className}`}
    >
      {(title || action) && (
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          {title && <h2 className="text-sm font-medium">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  tone = 'neutral',
  href,
}: {
  label: string;
  value: ReactNode;
  tone?: keyof typeof TONES;
  href?: string;
}) {
  const body = (
    <div className="rounded-xl border border-border bg-surface px-4 py-3 shadow-[var(--shadow-card)]">
      <div className="text-xs text-text-muted">{label}</div>
      <div
        className={`tnum mt-1 text-2xl font-semibold ${
          tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
  return href ? (
    <a href={href} className="block transition-opacity hover:opacity-80">
      {body}
    </a>
  ) : (
    body
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 py-8 text-center text-sm text-text-faint">{children}</p>
  );
}
