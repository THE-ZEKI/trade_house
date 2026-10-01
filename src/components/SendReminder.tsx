'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Loader2, AlertCircle, Check } from 'lucide-react';

/**
 * Relance manuelle des rappels d'une reunion.
 *
 * `app.send_manual_reminder` exclut les participants ayant refuse (RG-15) :
 * relancer ne doit pas>importuner ceux qui ont dit non.
 *
 * Le message est facultatif : sans lui, la base utilise le libelle du rappel.
 */

export default function SendReminder({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/reminders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message.trim() ? { message: message.trim() } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Relance refusee');
        return;
      }
      setSent(Number(data.recipients ?? 0));
      setMessage('');
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
        onClick={() => { setOpen(true); setError(null); setSent(null); }}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-border-strong bg-white px-4 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50"
      >
        <Send className="h-4 w-4" strokeWidth={2.5} />
        Relancer
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-sm)]">
      {sent !== null ? (
        <p className="flex items-start gap-2 text-sm text-success-fg">
          <Check className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
          <span>Rappel envoye a {sent} participant(s).</span>
        </p>
      ) : (
        <>
          {error && (
            <p role="alert" className="mb-3 flex items-start gap-2 rounded-md border border-danger-bd bg-danger-bg px-3 py-2 text-xs text-danger-fg">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
              <span>{error}</span>
            </p>
          )}
          <label className="grid gap-1.5">
            <span className="text-[13px] font-medium text-text-muted">
              Message <span className="font-normal text-text-faint">(facultatif)</span>
            </span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="min-h-[80px] w-full rounded-[10px] border border-border-strong bg-white px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
            />
          </label>
          <p className="mt-2 text-xs text-text-faint">
            Les participants ayant refuse ne sont pas relances.
          </p>
        </>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex h-9 items-center rounded-md border border-border-strong bg-white px-3 text-xs font-semibold text-sky-700"
        >
          Fermer
        </button>
        {sent === null && (
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-sky-500 px-3 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.5} />}
            Envoyer
          </button>
        )}
      </div>
    </div>
  );
}
