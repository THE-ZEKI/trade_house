'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, AlertCircle, CalendarPlus, X, TriangleAlert, Check, UserRound,
} from 'lucide-react';
import { t } from '@/lib/i18n';

/**
 * Planification d'une reunion (DESIGN_SYSTEM §6.6).
 *
 * Point important : les conflits d'horaire sont un AVERTISSEMENT, jamais un
 * blocage (RG-10). L'API renvoie `warnings.conflicts` sans refuser la creation ;
 * on les affiche donc, mais le bouton reste actif.
 *
 * Les rappels (invitation, J-1, H-1) sont crees par la base dans la meme
 * transaction que la reunion : rien a cocher ici.
 */

const TYPES = [
  { value: 'internal', label: 'Interne' },
  { value: 'external', label: 'Externe' },
  { value: 'instant', label: 'Instantanee' },
];

const PROVIDERS = [
  { value: 'other', label: 'Autre' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'meet', label: 'Meet' },
  { value: 'teams', label: 'Teams' },
];

const DURATIONS = [30, 45, 60, 90, 120];

const INPUT =
  'h-11 w-full rounded-[10px] border border-border-strong bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100';
const LABEL = 'text-[13px] font-medium text-text-muted';

/** Datetime-local attend `YYYY-MM-DDTHH:mm`, sans fuseau : l'API convertit. */
function defaultStart() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}

export default function CreateMeeting({
  traders,
}: {
  traders: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('internal');
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [durationMin, setDurationMin] = useState(60);
  const [participants, setParticipants] = useState<string[]>([]);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkProvider, setLinkProvider] = useState('other');
  const [message, setMessage] = useState('');

  const close = () => {
    setOpen(false);
    setError(null);
    setConflicts([]);
  };

  function toggle(id: string) {
    setParticipants((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setConflicts([]);
    try {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          type,
          startsAt: new Date(startsAt).toISOString(),
          durationMin,
          participants,
          linkUrl: linkUrl.trim() || null,
          linkProvider,
          message: message.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Creation refusee');
        return;
      }
      // RG-10 : conflit signale, jamais bloquant. On l'affiche et on continue.
      const warned = data.warnings?.conflicts ?? [];
      if (warned.length > 0) {
        setConflicts(
          warned.map((c: Record<string, unknown>) => String(c.title ?? 'une autre reunion')),
        );
      }
      setCreatedId(String(data.meeting?.id ?? ''));
      setTitle('');
      setParticipants([]);
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
        className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-sky-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-600"
      >
        <CalendarPlus className="h-4 w-4" strokeWidth={2.5} />
        Planifier une reunion
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0c4a6e]/40 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-[560px] overflow-y-auto rounded-t-lg bg-surface shadow-[var(--shadow-lg)] sm:rounded-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">Planifier une reunion</h2>
          <button type="button" onClick={close} aria-label="Fermer" className="inline-flex h-11 w-11 items-center justify-center rounded-md text-text-faint hover:bg-surface-alt hover:text-text">
            <X className="h-5 w-5" strokeWidth={2.2} />
          </button>
        </div>

        <div className="grid gap-4 px-5 py-5">
          {createdId && (
            <p className="flex items-start gap-2 rounded-md border border-success-bd bg-success-bg px-3 py-2.5 text-sm text-success-fg">
              <Check className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
              <span>Reunion creee. Les invitations et les rappels sont envoyes.</span>
            </p>
          )}

          {conflicts.length > 0 && (
            <p className="flex items-start gap-2 rounded-md border border-warn-bd bg-warn-bg px-3 py-2.5 text-sm text-warn-fg">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
              <span>
                Chevauchement avec {conflicts.join(', ')}. La reunion est tout de meme
                creee : les conflits signalent, ils ne bloquent pas.
              </span>
            </p>
          )}

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-danger-bd bg-danger-bg px-3 py-2.5 text-sm text-danger-fg">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
              <span>{error}</span>
            </p>
          )}

          <label className="grid gap-1.5">
            <span className={LABEL}>Titre <span className="ml-1 text-danger-fg">*</span></span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT} />
          </label>

          <label className="grid gap-1.5">
            <span className={LABEL}>Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={`${INPUT} min-h-[80px] py-2.5 leading-relaxed resize-y`} />
          </label>

          <fieldset className="grid gap-2">
            <legend className={LABEL}>Type</legend>
            <div className="grid grid-cols-3 gap-2">
              {TYPES.map((ty) => (
                <button
                  key={ty.value}
                  type="button"
                  onClick={() => setType(ty.value)}
                  aria-pressed={type === ty.value}
                  className={
                    'inline-flex h-11 items-center justify-center rounded-[10px] border text-sm font-semibold transition-colors '
                    + (type === ty.value
                      ? 'border-transparent bg-sky-500 text-white'
                      : 'border-border-strong bg-white text-text-muted hover:bg-surface-alt')
                  }
                >
                  {ty.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className={LABEL}>Debut <span className="ml-1 text-danger-fg">*</span></span>
              <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={INPUT} />
            </label>
            <label className="grid gap-1.5">
              <span className={LABEL}>Duree</span>
              <select value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} className={INPUT}>
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>{d} min</option>
                ))}
              </select>
            </label>
          </div>

          <fieldset className="grid gap-2">
            <legend className={LABEL}>
              Participants <span className="ml-1 text-danger-fg">*</span>
              <span className="ml-2 font-normal text-text-faint">
                {participants.length} selectionne(s)
              </span>
            </legend>
            {traders.length === 0 ? (
              <p className="text-xs text-text-faint">Aucun trader a inviter.</p>
            ) : (
              <div className="max-h-44 overflow-y-auto rounded-[10px] border border-border-strong">
                {traders.map((tr) => {
                  const on = participants.includes(tr.id);
                  return (
                    <label
                      key={tr.id}
                      className={
                        'flex cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0 '
                        + (on ? 'bg-sky-50' : 'hover:bg-surface-alt')
                      }
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(tr.id)}
                        className="h-4 w-4 rounded border-border-strong"
                      />
                      <UserRound className="h-4 w-4 text-text-faint" strokeWidth={2.2} />
                      <span className="text-sm">{tr.full_name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <label className="grid gap-1.5">
              <span className={LABEL}>Lien de la reunion</span>
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                className={INPUT}
                placeholder="https://…"
              />
            </label>
            <label className="grid gap-1.5">
              <span className={LABEL}>Fournisseur</span>
              <select value={linkProvider} onChange={(e) => setLinkProvider(e.target.value)} className={INPUT}>
                {PROVIDERS.map((pv) => (
                  <option key={pv.value} value={pv.value}>{pv.label}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="grid gap-1.5">
            <span className={LABEL}>Message aux participants</span>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} className={`${INPUT} min-h-[80px] py-2.5 leading-relaxed resize-y`} />
          </label>

          <p className="text-xs text-text-faint">
            Les rappels (invitation, J-1, H-1) sont plans automatiquement.
          </p>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="inline-flex h-11 items-center rounded-[10px] border border-border-strong bg-white px-4 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50">
              {createdId ? 'Fermer' : 'Annuler'}
            </button>
            <button
              type="button"
              disabled={busy || !title.trim() || participants.length === 0}
              onClick={submit}
              className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-sky-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
              Creer la reunion
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
