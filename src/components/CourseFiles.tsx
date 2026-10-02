'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Paperclip, Loader2, AlertCircle, Trash2, FileText, ImageIcon } from 'lucide-react';

export type CourseFile = {
  id: string;
  name: string;
  mime: string;
  size: string | number;
};

/**
 * Supports du cours : captures, schemas, PDF.
 *
 * Le cours s'enseigne mal en texte seul. Un schema de gestion du risque ou une
 * capture de graphique dit en une image ce qu'il faudrait decrire en trois
 * paragraphes — et la description est toujours moins fidele.
 *
 * Le depot passe par /api/training/courses/:id/files, qui verifie la
 * SIGNATURE reelle du fichier et non son nom : renommer un fichier ne permet
 * pas de faire passer un type refuse. L'autorisation, elle, est decidee en base
 * (app.attach_course_file).
 */
export default function CourseFiles({
  courseId,
  files,
  canEdit,
}: {
  courseId: string;
  files: CourseFile[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function upload(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/training/courses/${courseId}/files`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        throw new Error(data?.error?.message ?? 'Depot refuse');
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Depot impossible');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove(fileId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/training/courses/${courseId}/files?fileId=${fileId}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        throw new Error(data?.error?.message ?? 'Retrait refuse');
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retrait impossible');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      {error && (
        <p className="flex items-center gap-2 rounded-[10px] border border-danger-bd bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={2.2} />
          {error}
        </p>
      )}

      <ul className="divide-y divide-border rounded-[10px] border border-border">
        {files.length === 0 ? (
          <li className="px-3 py-3 text-xs text-text-faint">
            Aucun support. Un schema ou une capture evite d ecrire ce que l image montre deja.
          </li>
        ) : (
          files.map((f) => {
            const isImage = String(f.mime).startsWith('image/');
            return (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2.5">
                {isImage ? (
                  <ImageIcon className="h-4 w-4 shrink-0 text-text-faint" strokeWidth={2} />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-text-faint" strokeWidth={2} />
                )}
                <a
                  href={`/api/training/course-files/${f.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-sm font-medium text-accent hover:underline"
                >
                  {f.name}
                </a>
                <span className="shrink-0 text-xs text-text-faint tnum">
                  {humanSize(Number(f.size))}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => remove(f.id)}
                    disabled={busy}
                    aria-label={`Retirer ${f.name}`}
                    className="shrink-0 text-text-faint transition-colors hover:text-danger-fg disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })
        )}
      </ul>

      {canEdit && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void upload(e.dataTransfer.files);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            onChange={(e) => void upload(e.target.files)}
            className="sr-only"
            id={`course-file-${courseId}`}
          />
          <label
            htmlFor={`course-file-${courseId}`}
            className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-[10px] border px-4 text-sm font-semibold transition-colors ${
              dragOver
                ? 'border-sky-500 bg-sky-100 text-sky-700'
                : 'border-border-strong bg-white text-sky-700 hover:bg-sky-50'
            }`}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="h-4 w-4" strokeWidth={2.2} />
            )}
            Joindre une image ou un PDF
          </label>
          <p className="mt-1.5 text-xs text-text-faint">
            PNG, JPEG, WebP ou PDF — 10 Mo maximum. Glisser-deposer fonctionne aussi.
          </p>
        </div>
      )}
    </div>
  );
}


  const humanSize = (bytes: number) =>
    bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
