'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save, Loader2, AlertCircle, Plus, Trash2, Globe } from 'lucide-react';

/**
 * Edition d'un cours et ajout d'exercices.
 *
 * La publication est explicite : publier rend le cours attribuable, donc visible
 * par les traders. C est irreversible depuis l'ecran, et c est voulu — on ne
 * publie pas un cours par inadvertance.
 */
export default function CourseEditor({
  course,
}: {
  course: { id: string; title: string; summary: string | null; content: string; status: string };
}) {
  const router = useRouter();
  const [content, setContent] = useState(course.content ?? '');
  const [status, setStatus] = useState(course.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState<'written' | 'qcm'>('written');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [correctIndex, setCorrectIndex] = useState(0);
  const [explanation, setExplanation] = useState('');

  async function call(path: string, method: string, body: unknown) {
    const res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.error) throw new Error(data?.error?.message ?? 'Operation refusee');
    return data;
  }

  async function save(newStatus?: string) {
    setBusy(true);
    setError(null);
    try {
      await call('/api/training/courses', 'PATCH', {
        id: course.id,
        title: course.title,
        summary: course.summary,
        content,
        status: newStatus ?? status,
      });
      if (newStatus) setStatus(newStatus);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enregistrement impossible');
    } finally {
      setBusy(false);
    }
  }

  async function addExercise() {
    setBusy(true);
    setError(null);
    try {
      await call(`/api/training/courses/${course.id}/exercises`, 'POST', {
        title,
        prompt,
        kind,
        options: kind === 'qcm' ? options.filter((o) => o.trim()) : undefined,
        correctIndex: kind === 'qcm' ? correctIndex : undefined,
        explanation,
      });
      setTitle('');
      setPrompt('');
      setExplanation('');
      setOptions(['', '']);
      setCorrectIndex(0);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ajout impossible');
    } finally {
      setBusy(false);
    }
  }

  const input =
    'h-11 w-full rounded-[10px] border border-border-strong bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100';

  return (
    <div className="grid gap-4">
      {error && (
        <p className="flex items-center gap-2 rounded-[10px] border border-danger-bd bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={2.2} />
          {error}
        </p>
      )}

      <div className="rounded-[10px] border border-border bg-white px-4 py-4">
        <label className="grid gap-1.5">
          <span className="text-[13px] font-medium text-text-muted">Contenu du cours</span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            placeholder="Le cours proprement dit : la regle, la methode, les exemples."
            className="w-full rounded-[10px] border border-border-strong bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-sky-400"
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => save()}
            disabled={busy}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-border-strong bg-white px-4 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" strokeWidth={2.2} />}
            Enregistrer
          </button>

          {status !== 'published' ? (
            <button
              type="button"
              onClick={() => save('published')}
              disabled={busy || !content.trim()}
              title="Le cours devient attribuable et visible par vos traders"
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-sky-500 px-4 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
            >
              <Globe className="h-4 w-4" strokeWidth={2.2} /> Publier le cours
            </button>
          ) : (
            <button
              type="button"
              onClick={() => save('archived')}
              disabled={busy}
              className="inline-flex h-10 items-center rounded-[10px] border border-border-strong bg-white px-4 text-sm font-semibold text-text-muted hover:bg-surface-alt disabled:opacity-50"
            >
              Archiver
            </button>
          )}
          <span className="text-xs text-text-faint">
            {status === 'published' ? 'Publie : attribuable.' : 'Brouillon : visible par vous seul.'}
          </span>
        </div>
      </div>

      <AddExerciseForm
        busy={busy}
        title={title}
        setTitle={setTitle}
        prompt={prompt}
        setPrompt={setPrompt}
        kind={kind}
        setKind={setKind}
        options={options}
        setOptions={setOptions}
        correctIndex={correctIndex}
        setCorrectIndex={setCorrectIndex}
        explanation={explanation}
        setExplanation={setExplanation}
        onSubmit={addExercise}
        input={input}
      />
    </div>
  );
}
/**
 * Formulaire d'ajout d'exercice, isole du composant principal : c'est un bloc
 * de formulaire sans etat partage avec l'edition du cours.
 */
function AddExerciseForm(p: {
  busy: boolean;
  title: string;
  setTitle: (v: string) => void;
  prompt: string;
  setPrompt: (v: string) => void;
  kind: 'written' | 'qcm';
  setKind: (v: 'written' | 'qcm') => void;
  options: string[];
  setOptions: (v: string[]) => void;
  correctIndex: number;
  setCorrectIndex: (v: number) => void;
  explanation: string;
  setExplanation: (v: string) => void;
  onSubmit: () => void;
  input: string;
}) {
  return (
    <div className="rounded-[10px] border border-border bg-white px-4 py-4">
      <p className="text-[13px] font-medium text-text-muted">Ajouter un exercice</p>
      <div className="mt-3 grid gap-3">
        <input value={p.title} onChange={(e) => p.setTitle(e.target.value)} placeholder="Titre" className={p.input} />
        <textarea
          value={p.prompt}
          onChange={(e) => p.setPrompt(e.target.value)}
          rows={2}
          placeholder="Enonce : la question posee au trader"
          className="w-full rounded-[10px] border border-border-strong bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
        />

        <div className="flex gap-2">
          {(['written', 'qcm'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => p.setKind(k)}
              aria-pressed={p.kind === k}
              className={`inline-flex h-10 items-center rounded-[10px] border px-4 text-sm font-semibold ${
                p.kind === k
                  ? 'border-sky-500 bg-sky-500 text-white'
                  : 'border-border-strong bg-white text-text-muted hover:bg-sky-50'
              }`}
            >
              {k === 'written' ? 'Redaction' : 'QCM'}
            </button>
          ))}
        </div>

        {p.kind === 'qcm' && (
          <div className="grid gap-2 rounded-[10px] border border-border bg-surface-alt px-3 py-3">
            <p className="text-xs font-semibold text-text-muted">Propositions — la radio indique la bonne</p>
            {p.options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="correct"
                  checked={p.correctIndex === i}
                  onChange={() => p.setCorrectIndex(i)}
                  aria-label={`Proposition ${i + 1} correcte`}
                  className="accent-sky-500"
                />
                <input
                  value={o}
                  onChange={(e) => p.setOptions(p.options.map((v, k) => (k === i ? e.target.value : v)))}
                  placeholder={`Proposition ${i + 1}`}
                  className={p.input}
                />
                {p.options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => p.setOptions(p.options.filter((_, k) => k !== i))}
                    aria-label="Retirer"
                    className="shrink-0 text-text-faint hover:text-danger-fg"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => p.setOptions([...p.options, ''])}
              className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md border border-border-strong bg-white px-3 text-xs font-semibold text-sky-700"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.2} /> Proposition
            </button>
          </div>
        )}

        <input
          value={p.explanation}
          onChange={(e) => p.setExplanation(e.target.value)}
          placeholder="Pourquoi cette reponse est la bonne (facultatif pour une redaction)"
          className={p.input}
        />

        <button
          type="button"
          onClick={p.onSubmit}
          disabled={p.busy || !p.title.trim() || !p.prompt.trim()}
          className="inline-flex h-10 w-fit items-center gap-2 rounded-[10px] bg-sky-500 px-4 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
        >
          {p.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" strokeWidth={2.5} />}
          Ajouter l exercice
        </button>
      </div>
    </div>
  );
}