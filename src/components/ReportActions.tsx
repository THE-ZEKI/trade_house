'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, AlertCircle, MessageSquareWarning, RotateCcw,
} from 'lucide-react';
import { reportActionsFor } from '@/lib/permissions';
import type { SessionUser } from '@/lib/auth';

/**
 * Actions de revue d'un rapport (DESIGN_SYSTEM §6.4).
 *
 * Ce composant ne DECIDE rien : `reportActionsFor` filtre par role ET par
 * statut, et la base revalide tout dans les fonctions `app.*`. Si les deux
 * divergent, la base gagne et l'utilisateur voit un refus comprehensible.
 *
 * Deux actions exigent un motif — « rejeter » et « rouvrir ». Un refus sans
 * motif laisse le trader sans moyen de progresser : le motif est donc
 * obligatoire ici ET dans la fonction SQL.
 */

type Spec = {
  apiAction: string;
  labelKey: string;
  variant?: 'primary' | 'secondary' | 'danger';
  needsReason?: boolean;
  needsDeadline?: boolean;
};

const VARIANT: Record<string, string> = {
  primary: 'bg-sky-500 text-white hover:bg-sky-600 border border-transparent',
  secondary: 'bg-white text-sky-700 hover:bg-sky-50 border border-border-strong',
  danger: 'bg-danger-bg text-danger-fg hover:brightness-97 border border-danger-bd',
};

/** Libelles des actions du cycle de vie. */
export const ACTION_LABEL: Record<string, string> = {
  submit: 'Deposer le rapport',
  resubmit: 'Resoumettre',
  'start-review': 'Prendre en revue',
  'request-corrections': 'Demander des correctifs',
  validate: 'Valider',
  dismiss: 'Rejeter',
  reopen: 'Rouvrir',
};

const DEADLINE_DAYS = 3;

export default function ReportActions({
  user,
  reportId,
  status,
}: {
  user: SessionUser;
  reportId: string;
  status: string;
}) {
  const router = useRouter();
  const actions = reportActionsFor(user, status);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `pending` designe l'action dont on gathers les arguments, pas l'action en
  // cours d'execution : les deux peuvent coexister.
  const [pending, setPending] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [deadline, setDeadline] = useState(
    new Date(Date.now() + DEADLINE_DAYS * 864e5).toISOString().slice(0, 10),
  );

  async function run(apiAction: string, extra: Record<string, unknown>) {
    setBusy(apiAction);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${reportId}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: apiAction, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Action refusee');
        return;
      }
      setPending(null);
      setReason('');
      router.refresh();
    } catch {
      setError('Serveur injoignable');
    } finally {
      setBusy(null);
    }
  }

  if (actions.length === 0) return null;

  const pendingSpec = actions.find((a) => a.apiAction === pending);

  return (
    <div className="space-y-3">
      {/* Message de refus : celui de la base, jamais un texte genere. */}
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-danger-bd bg-danger-bg px-3 py-2.5 text-sm text-danger-fg"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
          <span>{error}</span>
        </p>
      )}

      <div className="grid gap-2">
        {actions.map((a: Spec) => (
          <button
            key={a.apiAction}
            type="button"
            disabled={busy !== null}
            onClick={() => {
              setError(null);
              // Une action avec arguments ouvre le panneau ; sinon elle part
              // directement. Le clic sur un panneau deja ouvert referme.
              if (a.needsReason || a.needsDeadline) {
                setPending(pending === a.apiAction ? null : a.apiAction);
                setReason('');
              } else {
                run(a.apiAction, {});
              }
            }}
            aria-expanded={pending === a.apiAction || undefined}
            className={
              'inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-semibold transition-colors disabled:opacity-50 '
              + VARIANT[a.variant ?? 'secondary']
            }
          >
            {busy === a.apiAction
              ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
              : null}
            {ACTION_LABEL[a.apiAction]}
          </button>
        ))}
      </div>

      {pendingSpec && (
        <div className="rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-sm)]">
          {pendingSpec.needsDeadline && (
            <label className="grid gap-1.5">
              <span className="text-[13px] font-medium text-text-muted">
                Echeance des correctifs
              </span>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="h-11 w-full rounded-[10px] border border-border-strong bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
              />
              <span className="text-xs text-text-faint">
                Au-dela, le rapport passe en « critique » et la relance est automatique.
              </span>
            </label>
          )}

          {pendingSpec.needsReason && (
            <label className="grid gap-1.5">
              <span className="text-[13px] font-medium text-text-muted">
                Motif <span className="ml-1 text-danger-fg">*</span>
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="min-h-[90px] w-full rounded-[10px] border border-border-strong bg-white px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                placeholder="Expliquez la decision : le trader doit pouvoir y repondre."
              />
            </label>
          )}

          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setPending(null); setReason(''); }}
              className="inline-flex h-11 items-center rounded-[10px] border border-border-strong bg-white px-4 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={busy !== null || (pendingSpec.needsReason === true && reason.trim().length === 0)}
              onClick={() =>
                run(pendingSpec.apiAction, {
                  ...(pendingSpec.needsReason ? { reason: reason.trim() } : {}),
                  ...(pendingSpec.needsDeadline ? { deadline } : {}),
                })
              }
              className={
                'inline-flex h-11 items-center gap-2 rounded-[10px] px-4 text-sm font-semibold transition-colors disabled:opacity-50 '
                + VARIANT[pendingSpec.variant ?? 'primary']
              }
            >
              {busy === pendingSpec.apiAction
                ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
                : null}
              {ACTION_LABEL[pendingSpec.apiAction]}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
