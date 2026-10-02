'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2, AlertCircle, X } from 'lucide-react';

/**
 * Creation d'un cours (module formation).
 *
 * Le cours nait en brouillon : il n'est attribuable qu'une fois publie, ce qui
 * evite qu'un trader decouvre un texte encore en relecture. Publier se fait plus
 * tard, depuis le cours.
 */
export default function NewCourse() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/training/courses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, summary, status: 'draft' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        setError(data?.error?.message ?? 'Creation refusee');
        return;
      }
      setTitle('');
      setSummary('');
      setOpen(false);
      router.push(`/training/course/${data.course.id}`);
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
        className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-sky-500 px-4 text-sm font-semibold text-white hover:bg-sky-600 md:h-10"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} />
        Nouveau cours
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0c4a6e]/40 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-[480px] overflow-y-auto rounded-t-lg bg-surface shadow-[var(--shadow-lg)] sm:rounded-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">Nouveau cours</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="text-text-faint hover:text-text">
            <X className="h-5 w-5" strokeWidth={2.2} />
          </button>
        </div>

        <div className="grid gap-4 px-5 py-5">
          {error && (
            <p className="flex items-center gap-2 rounded-md border border-danger-bd bg-danger-bg px-3 py-2 text-sm text-danger-fg">
              <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={2.2} />
              {error}
            </p>
          )}

          <label className="grid gap-1.5">
            <span className="text-[13px] font-medium text-text-muted">Titre</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex. : Gestion du risque sur position longue"
              className="h-11 w-full rounded-[10px] border border-border-strong bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-[13px] font-medium text-text-muted">Resume (facultatif)</span>
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="En une phrase, ce que le trader va apprendre"
              className="h-11 w-full rounded-[10px] border border-border-strong bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
            />
          </label>

          <p className="text-xs text-text-faint">
            Le cours est cree en brouillon. Ajoutez son contenu et ses exercices, puis publiez-le
            pour pouvoir l attribuer.
          </p>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-11 items-center rounded-[10px] border border-border-strong bg-white px-4 text-sm font-semibold text-text hover:bg-surface-alt md:h-10"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !title.trim()}
              className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-sky-500 px-4 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50 md:h-10"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Creer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}