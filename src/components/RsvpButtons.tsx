'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, HelpCircle, X, Loader2, AlertCircle } from 'lucide-react';
import { t } from '@/lib/i18n';

/**
 * Reponse a une reunion (DESIGN_SYSTEM §6.2, §6.6).
 *
 * Trois boutons en ligne plutot qu'un menu : c'est une decision binaire posee
 * en permanence, et la cacher derriere un menu la transforme en corvee.
 *
 * Chaque choix a sa propre teinte (succes / neutre / danger) mais surtout sa
 * propre icone : en niveaux de gris, la reponse reste identifiable.
 */

const CHOICES = [
  { value: 'accepted', labelKey: 'action.rsvp_accept', Icon: Check, on: 'border-success-bd bg-success-bg text-success-fg' },
  { value: 'maybe', labelKey: 'action.rsvp_maybe', Icon: HelpCircle, on: 'border-neutral-bd bg-neutral-bg text-neutral-fg' },
  { value: 'declined', labelKey: 'action.rsvp_decline', Icon: X, on: 'border-danger-bd bg-danger-bg text-danger-fg' },
] as const;

export default function RsvpButtons({
  meetingId,
  current,
  locale,
  compact,
}: {
  meetingId: string;
  current: string | null;
  /*
   * La locale, pas une fonction de traduction : ce composant est client, et
   * une fonction ne peut pas traverser la frontiere serveur/client.
   */
  locale: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(status: string) {
    setBusy(status);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/rsvp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Reponse refusee');
        return;
      }
      router.refresh();
    } catch {
      setError('Serveur injoignable');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-2">
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-danger-fg">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
          <span>{error}</span>
        </p>
      )}
      <div className={compact ? 'grid grid-cols-3 gap-1.5' : 'grid gap-2'}>
        {CHOICES.map((c) => {
          const Icon = c.Icon;
          const active = current === c.value;
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => answer(c.value)}
              disabled={busy !== null}
              aria-pressed={active}
              className={[
                'inline-flex items-center justify-center gap-1.5 rounded-[10px] border font-semibold transition-colors disabled:opacity-50',
                compact ? 'h-10 px-2 text-xs' : 'h-11 px-3 text-sm',
                active
                  ? c.on
                  : 'border-border-strong bg-white text-text-muted hover:bg-surface-alt',
              ].join(' ')}
            >
              {busy === c.value
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
                : <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />}
              <span className="truncate">{t(locale, c.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
