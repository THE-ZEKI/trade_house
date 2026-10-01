'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle, Plus, X } from 'lucide-react';
import { spec, TONE_CLASS, SEVERITY, CORRECTION_TARGET } from '@/lib/status';
import type { SessionUser } from '@/lib/auth';
import { can } from '@/lib/permissions';

/**
 * Ajout d'un correctif (DESIGN_SYSTEM §6.4).
 *
 * Le correctif est la preuve ecrite de la revue : sans lui, « demander des
 * corrections » ne veut rien dire pour le trader. D'ou un formulaire explicite
 * plutot qu'un simple bouton.
 *
 * Une seule regle : une correction « champ » doit nommer le champ, une
 * correction « fichier » doit nommer le fichier. L'API verifie les deux ; on
 * evite ici un aller-retour inutile.
 */

const SEVERITIES = ['mandatory', 'suggestion'] as const;
const TARGETS = ['general', 'field', 'file'] as const;

const INPUT =
  'h-11 w-full rounded-[10px] border border-border-strong bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100';

const SEVERITY_TEXT: Record<string, string> = {
  mandatory: 'Bloquant',
  suggestion: 'Conseil',
};

const TARGET_TEXT: Record<string, string> = {
  general: 'General',
  field: 'Champ',
  file: 'Fichier',
};

/** Petits boutons de choix : meme rendu pour gravite et cible. */
function Choice({
  active,
  tone,
  Icon,
  text,
  onClick,
}: {
  active: boolean;
  tone: ReturnType<typeof spec>['tone'];
  Icon: ReturnType<typeof spec>['Icon'];
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'inline-flex h-11 items-center justify-center gap-1.5 rounded-[10px] border text-sm font-semibold transition-colors '
        + (active
          ? TONE_CLASS[tone] + ' ring-2 ring-sky-300'
          : 'border-border-strong bg-white text-text-muted hover:bg-surface-alt')
      }
    >
      <Icon className="h-4 w-4" strokeWidth={2.5} />
      {text}
    </button>
  );
}

export default function AddCorrection({
  user,
  reportId,
}: {
  user: SessionUser;
  reportId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<string>('mandatory');
  const [targetType, setTargetType] = useState<string>('general');
  const [targetField, setTargetField] = useState('');

  if (!can(user, 'report.add_correction')) return null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${reportId}/corrections`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          severity,
          targetType,
          targetField: targetType === 'field' ? targetField.trim() : null,
          targetFileId: null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Correctif refuse');
        return;
      }
      setMessage('');
      setTargetField('');
      setOpen(false);
      router.refresh();
    } catch {
      setError('Serveur injoignable');
    } finally {
      setBusy(false);
    }
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-border-strong bg-white px-4 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} />
        Ajouter un correctif
      </button>
    );
  }

  const close = () => { setOpen(false); setError(null); };

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Ajouter un correctif</h3>
        <button
          type="button"
          onClick={close}
          aria-label="Fermer"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-faint hover:bg-surface-alt hover:text-text"
        >
          <X className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>

      <div className="grid gap-4">
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-danger-bd bg-danger-bg px-3 py-2 text-sm text-danger-fg">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
            <span>{error}</span>
          </p>
        )}

        <fieldset className="grid gap-2">
          <legend className="text-[13px] font-medium text-text-muted">Gravite</legend>
          <div className="grid grid-cols-2 gap-2">
            {SEVERITIES.map((s) => {
              const p = spec(SEVERITY, s);
              return <Choice key={s} active={severity === s} tone={p.tone} Icon={p.Icon} text={SEVERITY_TEXT[s]} onClick={() => setSeverity(s)} />;
            })}
          </div>
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="text-[13px] font-medium text-text-muted">Cible</legend>
          <div className="grid grid-cols-3 gap-2">
            {TARGETS.map((tg) => {
              const p = spec(CORRECTION_TARGET, tg);
              return <Choice key={tg} active={targetType === tg} tone={p.tone} Icon={p.Icon} text={TARGET_TEXT[tg]} onClick={() => setTargetType(tg)} />;
            })}
          </div>
        </fieldset>

        {targetType === 'field' && (
          <label className="grid gap-1.5">
            <span className="text-[13px] font-medium text-text-muted">
              Champ vise <span className="ml-1 text-danger-fg">*</span>
            </span>
            <input
              value={targetField}
              onChange={(e) => setTargetField(e.target.value)}
              className={INPUT}
              placeholder="plan_respected, rr_realized…"
            />
          </label>
        )}

        <label className="grid gap-1.5">
          <span className="text-[13px] font-medium text-text-muted">
            Message <span className="ml-1 text-danger-fg">*</span>
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="min-h-[110px] w-full rounded-[10px] border border-border-strong bg-white px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
            placeholder="Ce qui doit etre repris, et pourquoi."
          />
        </label>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="inline-flex h-11 items-center rounded-[10px] border border-border-strong bg-white px-4 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50">
            Annuler
          </button>
          <button
            type="button"
            disabled={busy || message.trim().length === 0}
            onClick={submit}
            className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-sky-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            Ajouter
          </button>
        </div>
      </div>
    </div>
  );
}
