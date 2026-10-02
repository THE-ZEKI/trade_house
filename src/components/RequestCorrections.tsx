'use client';

import { useState } from 'react';
import { Plus, Loader2, AlertCircle, Trash2, MessageSquareWarning } from 'lucide-react';

/**
 * Demander des correctifs en un seul geste (RG-42).
 *
 * Pourquoi ce composant existe : `app.request_corrections` refuse de passer le
 * rapport en « correctifs demandes » s'il n'existe AUCUN correctif ouvert. La
 * regle est bonne — demander des correctifs sans rien dire ne sert a rien — mais
 * l'interface se contentait de demander une echeance, donc l'operation echouait
 * toujours avec un `409 RG-42` que le manager ne pouvait pas comprendre.
 *
 * Le parcours devient : ecrire ses correctifs, puis envoyer. Ils sont
 * d'abord enregistres un par un, et la transition n'est demandee qu'ensuite —
 * l'ordre inverse mettrait le rapport en attente alors qu'aucun correctif
 * n'existe encore. Si l'une des deux etapes echoue, les correctifs deja
 * enregistres restent, et la demande peut etre rejouee telle quelle.
 */
type Draft = {
  message: string;
  severity: 'mandatory' | 'suggestion';
  targetType: 'general' | 'field' | 'file';
  targetField: string;
  targetFileId: string;
};

const EMPTY: Draft = { message: '', severity: 'mandatory', targetType: 'general', targetField: '', targetFileId: '' };

export default function RequestCorrections({
  reportId,
  files,
  fields,
  defaultDeadline,
  onDone,
  onCancel,
}: {
  reportId: string;
  files: { id: string; original_name: string }[];
  fields: string[];
  defaultDeadline: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([{ ...EMPTY }]);
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valides = drafts.filter((d) => d.message.trim().length > 0);

  function patch(i: number, part: Partial<Draft>) {
    setDrafts((p) => p.map((d, k) => (k === i ? { ...d, ...part } : d)));
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      for (const d of valides) {
        const res = await fetch(`/api/reports/${reportId}/corrections`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            message: d.message.trim(),
            severity: d.severity,
            targetType: d.targetType,
            targetField: d.targetType === 'field' ? d.targetField.trim() : null,
            targetFileId: d.targetType === 'file' ? d.targetFileId : null,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || data?.error) {
          setError(data?.error?.message ?? 'Correctif refuse');
          return;
        }
      }

      const res = await fetch(`/api/reports/${reportId}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'request-corrections', deadline }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        setError(
          `Les correctifs ont bien ete enregistres, mais la demande a echoue : ${data?.error?.message ?? 'raison inconnue'}`,
        );
        return;
      }
      onDone();
    } catch {
      setError('Serveur injoignable');
    } finally {
      setBusy(false);
    }
  }

  const field =
    'h-10 w-full rounded-[10px] border border-border-strong bg-white px-3 text-sm outline-none focus:border-sky-400';

  return (
    <div className="grid gap-3">
      <p className="text-[13px] font-medium text-text-muted">
        Ecrivez ce qui doit etre corrige. Au moins un correctif est obligatoire.
      </p>

      {drafts.map((d, i) => (
        <div key={i} className="grid gap-2 rounded-[10px] border border-border bg-surface-alt px-3 py-3">
          <div className="flex items-center gap-2">
            <MessageSquareWarning className="h-4 w-4 text-text-faint" strokeWidth={2.2} />
            <span className="text-xs font-semibold text-text-muted">Correctif {i + 1}</span>
            {drafts.length > 1 && (
              <button
                type="button"
                onClick={() => setDrafts((p) => p.filter((_, k) => k !== i))}
                aria-label="Retirer ce correctif"
                className="ml-auto text-text-faint hover:text-danger-fg"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>

          <textarea
            value={d.message}
            onChange={(e) => patch(i, { message: e.target.value })}
            rows={2}
            placeholder="Ce qui ne va pas, et ce qu il faut faire a la place"
            className="w-full rounded-[10px] border border-border-strong bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
          />

          <div className="flex flex-wrap gap-2">
            <select
              value={d.targetType}
              onChange={(e) => patch(i, { targetType: e.target.value as Draft['targetType'] })}
              className={field}
            >
              <option value="general">Rapport entier</option>
              <option value="field">Un champ precis</option>
              <option value="file">Une piece jointe</option>
            </select>

            {d.targetType === 'field' && (
              <select
                value={d.targetField}
                onChange={(e) => patch(i, { targetField: e.target.value })}
                className={field}
              >
                <option value="">Champ…</option>
                {fields.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}

            {d.targetType === 'file' && (
              <select
                value={d.targetFileId}
                onChange={(e) => patch(i, { targetFileId: e.target.value })}
                className={field}
              >
                <option value="">Piece jointe…</option>
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.original_name}
                  </option>
                ))}
              </select>
            )}

            <select
              value={d.severity}
              onChange={(e) => patch(i, { severity: e.target.value as Draft['severity'] })}
              className={field}
            >
              <option value="mandatory">Obligatoire</option>
              <option value="suggestion">Suggestion</option>
            </select>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => setDrafts((p) => [...p, { ...EMPTY }])}
        className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md border border-border-strong bg-white px-3 text-xs font-semibold text-sky-700"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.2} /> Ajouter un correctif
      </button>

      <label className="grid gap-1.5">
        <span className="text-[13px] font-medium text-text-muted">Echeance des correctifs</span>
        <input
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="h-11 w-full rounded-[10px] border border-border-strong bg-white px-3 text-sm outline-none focus:border-sky-400"
        />
        <span className="text-xs text-text-faint">
          Au-dela, le rapport passe en « critique » et la relance est automatique.
        </span>
      </label>

      {error && (
        <p className="flex items-start gap-2 rounded-md border border-danger-bd bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-11 items-center rounded-[10px] border border-border-strong bg-white px-4 text-sm font-semibold text-sky-700"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={send}
          disabled={busy || valides.length === 0}
          className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-sky-500 px-4 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : null}
          Envoyer {valides.length} correctif{valides.length > 1 ? 's' : ''}
        </button>
      </div>
    </div>
  );
}