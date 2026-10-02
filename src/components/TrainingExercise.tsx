'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Loader2, Check, X, AlertCircle, RotateCcw, Paperclip } from 'lucide-react';

/**
 * Rendre un exercice, ou le corriger.
 *
 * Deux usages dans un seul composant parce qu'ils partagent l'ecran et la
 * validation : le trader rend sa reponse, le manager la corrige. La reponse
 * rendue reste lisible sous la correction — sans quoi le trader ne saurait pas
 * ce que le manager a lu.
 */
export default function Exercise({
  assignmentId,
  exercise,
  canSubmit,
  canReview,
}: {
  assignmentId: string;
  exercise: {
    id: string;
    title: string;
    prompt: string;
    kind: 'written' | 'qcm';
    options: Record<string, string> | null;
    answer: string | null;
    answer_key: string | null;
    submission_id: string | null;
    review_comment: string | null;
    score: string | number | null;
    reviewer: string | null;
    files?: { id: string; name: string; mime: string }[] | null;
  };
  canSubmit: boolean;
  canReview: boolean;
}) {
  const router = useRouter();
  const [answer, setAnswer] = useState(exercise.answer ?? '');
  const [picked, setPicked] = useState(exercise.answer_key ?? '');
  const [comment, setComment] = useState('');
  const [score, setScore] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const existing = exercise.files ?? [];

  const options = exercise.options ?? {};
  const isQcm = exercise.kind === 'qcm';
  const submitted = Boolean(exercise.submission_id);

  async function send(method: string, body: unknown, ok: () => void) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/training/assignments/${assignmentId}`, {
        method,
        headers: body instanceof FormData ? undefined : { 'content-type': 'application/json' },
        body: body instanceof FormData ? body : JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        setError(data?.error?.message ?? 'Operation refusee');
        return;
      }
      ok();
      router.refresh();
    } catch {
      setError('Serveur injoignable');
    } finally {
      setBusy(false);
    }
  }

  // Rendre (une fois) ou retravailler apres correction : deux verbes distincts,
  // parce que le second n'est accepte qu'une fois le travail corrige.
  //
  // Des qu'une capture est jointe, l'envoi passe en multipart : reponse et
  // images partent dans la meme requete, donc dans la meme transaction. Deux
  // envois separes laisseraient la possibility d'une reponse sans capture.
  const withFiles = files.length > 0;

  const buildBody = (action: 'POST' | 'PUT') => {
    const payload = {
      answer: isQcm ? null : answer,
      answerKey: isQcm ? picked : null,
      exerciseId: exercise.id,
      ...(action === 'PUT' ? { action: 'resubmit' } : {}),
    };
    if (!withFiles) return payload;
    const form = new FormData();
    form.append('exerciseId', exercise.id);
    if (action === 'PUT') form.append('action', 'resubmit');
    if (isQcm) {
      form.append('answerKey', picked);
    } else {
      form.append('answer', answer);
    }
    for (const f of files) form.append('files', f);
    return form;
  };

  const submit = () => send('POST', buildBody('POST'), () => setDone(true));

  const resubmit = () => send('PUT', buildBody('PUT'), () => setDone(true));

  const corrige = Boolean(exercise.review_comment);
  const peutRetravailler = canSubmit && corrige && !done;

  return (
    <li className="px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{exercise.title}</p>
          <p className="mt-1 text-sm text-text-muted">{exercise.prompt}</p>
        </div>
        {submitted && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-success-bg px-2.5 py-1 text-xs font-semibold text-success-fg">
            <Check className="h-3 w-3" strokeWidth={3} /> Rendu
          </span>
        )}
      </div>

      {isQcm ? (
        <ul className="mt-3 grid gap-2">
          {Object.entries(options).map(([key, text]) => (
            <li key={key}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-border px-3 py-2 text-sm hover:bg-surface-alt">
                <input
                  type="radio"
                  name={`ex-${exercise.id}`}
                  value={key}
                  checked={(done ? exercise.answer_key : picked) === key}
                  disabled={!canSubmit}
                  onChange={(e) => setPicked(e.target.value)}
                  className="accent-sky-500"
                />
                <span className="font-semibold uppercase text-text-faint">{key}</span>
                <span>{text}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          disabled={!canSubmit}
          rows={4}
          placeholder="Votre analyse…"
          className="mt-3 w-full rounded-[10px] border border-border-strong bg-white px-3 py-2 text-sm outline-none focus:border-sky-400 disabled:bg-surface-alt"
        />
      )}

{/* Captures deja jointes, visibles des deux cotes. */}
      {existing.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {existing.map((f) => (
            <li key={f.id}>
              <a
                href={`/api/training/files/${f.id}`}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-[10px] border border-border"
                title={f.name}
              >
                {f.mime === 'application/pdf' ? (
                  <span className="flex h-20 w-28 items-center justify-center bg-surface-alt text-xs text-text-faint">
                    PDF
                  </span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/training/files/${f.id}`}
                    alt={f.name}
                    className="h-20 w-28 bg-surface-alt object-cover"
                  />
                )}
              </a>
            </li>
          ))}
        </ul>
      )}

      {canSubmit && (
        <div className="mt-3">
          <input
            id={`files-${exercise.id}`}
            type="file"
            multiple
            accept=".png,.jpg,.jpeg,.webp,.pdf"
            onChange={(e) => {
              setFiles((p) => [...p, ...Array.from(e.target.files ?? [])]);
              // Reset : sans cela, rechoisir le meme fichier ne declencherait
              // pas onChange et l ajout semblerait casse.
              e.target.value = '';
            }}
            className="block w-full text-xs text-text-muted file:mr-3 file:rounded-md file:border-0 file:bg-surface-alt file:px-3 file:py-2 file:text-xs file:font-semibold file:text-sky-700"
          />
          <p className="mt-1 text-[11px] text-text-faint">
            Captures ou PDF, 10 Mo par fichier. Elles partent avec votre reponse, en un seul envoi.
          </p>
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs text-text-muted">
                  <Paperclip className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => setFiles((p) => p.filter((_, k) => k !== i))}
                    aria-label={`Retirer ${f.name}`}
                    className="shrink-0 text-text-faint hover:text-danger-fg"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {canSubmit && !corrige && (
        <button
          type="button"
          onClick={submit}
          disabled={busy || (isQcm ? !picked : !answer.trim())}
          className="mt-3 inline-flex h-10 items-center gap-2 rounded-[10px] bg-sky-500 px-4 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} /> : <Send className="h-4 w-4" strokeWidth={2.2} />}
          Rendre cet exercice
        </button>
      )}

      {/* Retravailler : propose seulement une fois le travail corrige. C'est la
          base qui l'interdit (FORMATION-17), l'interface le dit avant. */}
      {peutRetravailler && (
        <button
          type="button"
          onClick={resubmit}
          disabled={busy || (isQcm ? !picked : !answer.trim())}
          className="mt-3 inline-flex h-10 items-center gap-2 rounded-[10px] border border-sky-500 bg-white px-4 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} /> : <RotateCcw className="h-4 w-4" strokeWidth={2.2} />}
          Retravailler apres correction
        </button>
      )}

      {submitted && !canSubmit && exercise.answer && (
        <p className="mt-3 whitespace-pre-wrap rounded-[10px] bg-surface-alt px-3 py-2 text-sm">
          {exercise.answer}
        </p>
      )}

      {exercise.review_comment && (
        <div className="mt-3 rounded-[10px] border border-sky-200 bg-sky-50 px-3 py-2.5">
          <p className="text-xs font-semibold text-sky-700">
            Correction{exercise.score !== null && ` — ${exercise.score}/20`}
            {exercise.reviewer && ` (${exercise.reviewer})`}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{exercise.review_comment}</p>
        </div>
      )}

      {canReview && exercise.submission_id && !exercise.review_comment && (
        <div className="mt-3 grid gap-2 rounded-[10px] border border-border bg-surface-alt px-3 py-3">
          <p className="text-xs font-semibold text-text-muted">Corriger ce travail</p>
          {exercise.answer && (
            <p className="whitespace-pre-wrap rounded-md bg-white px-3 py-2 text-sm">{exercise.answer}</p>
          )}
          <div className="flex gap-2">
            <input
              value={score}
              onChange={(e) => setScore(e.target.value)}
              placeholder="Note /20"
              className="h-10 w-28 shrink-0 rounded-[10px] border border-border-strong bg-white px-3 text-sm outline-none focus:border-sky-400"
            />
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Ce que le trader doit retenir (obligatoire)"
              className="h-10 min-w-0 flex-1 rounded-[10px] border border-border-strong bg-white px-3 text-sm outline-none focus:border-sky-400"
            />
            <button
              type="button"
              onClick={() =>
                send(
                  'PUT',
                  { action: 'review', submissionId: exercise.submission_id, score, comment },
                  () => {},
                )
              }
              disabled={busy || !comment.trim()}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] bg-sky-500 px-3 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" strokeWidth={2.5} />}
              Publier
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 flex items-center gap-2 text-xs text-danger-fg">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          {error}
        </p>
      )}
    </li>
  );
}
