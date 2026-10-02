'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Upload,
  FileText,
  ImageIcon,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  Trash2,
} from 'lucide-react';
import type { SessionUser } from '@/lib/auth';

/**
 * Depot des pieces jointes d'un rapport (RG-32, RG-31).
 *
 * Deux decisions meritent d'etre expliquees.
 *
 * 1. Le controle cote client n'est qu'un confort. Un navigateur peut annonce
 *    "image/png" pour un fichier qui n'en est pas un. La vraie verification est
 *    celle de la route POST, qui compare la SIGNATURE du fichier (magic bytes)
 *    au type annonce. Le message d'erreur ici dit donc "sera refuse", jamais
 *    "refuse" — sauf pour la taille, refusee immediatement pour ne pas
 *    envoyer 200 Mo sur la connexion.
 *
 * 2. L'envoi se fait fichier par fichier et non en un seul POST : c'est la
 *    seule facon d'obtenir un retour par piece. Un depot de six captures ne
 *    doit pas echouer entierement parce que la cinquieme est un PDF de 30 Mo.
 */

export type ReportFile = {
  id: string;
  kind: 'screenshot' | 'pdf';
  original_name: string;
  mime_type: string;
  size_bytes: string | number;
  created_at: string;
};

const MAX_MB = 10;
const ACCEPT = '.png,.jpg,.jpeg,.webp,.pdf';
const MIME_LABEL: Record<string, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'application/pdf': 'PDF',
};

type Item =
  | { state: 'uploading'; name: string }
  | { state: 'done'; name: string }
  | { state: 'error'; name: string; message: string };

function formatSize(bytes: string | number): string {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return '-';
  if (n < 1024) return `${n} o`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / 1048576).toFixed(1)} Mo`;
}

export default function FileUploader({
  reportId,
  files,
  canUpload,
}: {
  user: SessionUser;
  reportId: string;
  files: ReportFile[];
  /** Le rapport est-il encore modifiable ? Un rapport depose se fige. */
  canUpload: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(list: FileList | File[]) {
    setError(null);
    for (const file of Array.from(list)) {
      const label = `${file.name} (${MIME_LABEL[file.type] ?? 'type refuse'})`;

      if (!MIME_LABEL[file.type]) {
        setItems((p) => [
          ...p,
          { state: 'error', name: label, message: 'Format non autorise (PNG, JPEG, WebP, PDF)' },
        ]);
        continue;
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        setItems((p) => [...p, { state: 'error', name: label, message: `Superieur a ${MAX_MB} Mo` }]);
        continue;
      }

      setItems((p) => [...p, { state: 'uploading', name: label }]);
      const body = new FormData();
      body.append('file', file);

      try {
        const res = await fetch(`/api/reports/${reportId}/files`, { method: 'POST', body });
        const payload = await res.json().catch(() => null);
        if (!res.ok || payload?.error) {
          setItems((p) =>
            p.map((i) =>
              i.state === 'uploading' && i.name === label
                ? { state: 'error', name: label, message: payload?.error?.message ?? 'Envoi refuse' }
                : i,
            ),
          );
          continue;
        }
        setItems((p) =>
          p.map((i) => (i.state === 'uploading' && i.name === label ? { state: 'done', name: label } : i)),
        );
      } catch {
        setItems((p) =>
          p.map((i) =>
            i.state === 'uploading' && i.name === label
              ? { state: 'error', name: label, message: 'Connexion interrompue' }
              : i,
          ),
        );
      }
    }
    router.refresh();
  }

  async function remove(fileId: string) {
    setDeleting(fileId);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${reportId}/files/${fileId}`, { method: 'DELETE' });
      const payload = await res.json().catch(() => null);
      if (!res.ok || payload?.error) {
        setError(payload?.error?.message ?? 'Suppression refusee');
        return;
      }
      router.refresh();
    } catch {
      setError('Suppression impossible : connexion interrompue');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-4">
      {canUpload ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
          }}
          className={`rounded-[10px] border-2 border-dashed px-6 py-8 text-center transition-colors ${
            dragOver ? 'border-sky-400 bg-sky-50' : 'border-border-strong bg-surface-alt'
          }`}
        >
          <Upload className="mx-auto h-7 w-7 text-sky-500" strokeWidth={1.8} />
          <p className="mt-3 text-sm font-semibold">Glissez vos captures ici</p>
          <p className="mt-1 text-xs text-text-muted">
            PNG, JPEG, WebP ou PDF — {MAX_MB} Mo maximum par fichier
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              // Reset : sans cela, re-selectionner le meme fichier ne
              // declencherait pas onChange et le depot semblerait casse.
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-4 inline-flex h-10 items-center rounded-[10px] border border-border-strong bg-white px-4 text-sm font-semibold text-sky-700 hover:bg-sky-50"
          >
            Choisir des fichiers
          </button>
        </div>
      ) : (
        <p className="rounded-[10px] border border-border bg-surface-alt px-4 py-3 text-sm text-text-muted">
          Les pieces jointes sont figees : le rapport est sorti du brouillon.
        </p>
      )}

      {error && (
        <p className="flex items-center gap-2 rounded-[10px] border border-danger-bd bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={2.2} />
          {error}
        </p>
      )}

      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li
              key={`${item.name}-${i}`}
              className="flex items-center gap-2 rounded-[10px] border border-border bg-white px-3 py-2 text-sm"
            >
              {item.state === 'uploading' && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-500" />}
              {item.state === 'done' && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
              {item.state === 'error' && <AlertCircle className="h-4 w-4 shrink-0 text-danger-fg" />}
              <span className="min-w-0 flex-1 truncate">
                {item.name}
                {item.state === 'error' && <span className="text-danger-fg"> — {item.message}</span>}
              </span>
              {item.state !== 'uploading' && (
                <button
                  type="button"
                  onClick={() => setItems((p) => p.filter((_, k) => k !== i))}
                  aria-label="Retirer de la liste"
                  className="shrink-0 text-text-faint hover:text-text"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {files.length === 0 ? (
        <p className="rounded-[10px] border border-border bg-surface-alt px-4 py-6 text-center text-sm text-text-muted">
          Aucune piece jointe. Le depot d un rapport en exige au moins une.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {files.map((file) => {
            const Icon = file.kind === 'pdf' ? FileText : ImageIcon;
            return (
              <li key={file.id} className="overflow-hidden rounded-[10px] border border-border bg-white">
                <a
                  href={`/api/reports/files/${file.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block"
                  title={file.original_name}
                >
                  {file.kind === 'pdf' ? (
                    <span className="flex h-32 items-center justify-center bg-surface-alt">
                      <FileText className="h-10 w-10 text-sky-500" strokeWidth={1.5} />
                    </span>
                  ) : (
                    // Les images passent par la route privee : le dossier
                    // .storage/ n'est pas servi en statique (RG-33).
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/reports/files/${file.id}`}
                      alt={file.original_name}
                      className="h-32 w-full bg-surface-alt object-cover"
                    />
                  )}
                </a>
                <div className="flex items-center gap-2 px-3 py-2">
                  <Icon className="h-4 w-4 shrink-0 text-text-faint" strokeWidth={2} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{file.original_name}</span>
                    <span className="block text-[11px] text-text-faint">
                      {MIME_LABEL[file.mime_type] ?? file.mime_type} · {formatSize(file.size_bytes)}
                    </span>
                  </span>
                  {canUpload && (
                    <button
                      type="button"
                      onClick={() => remove(file.id)}
                      disabled={deleting === file.id}
                      aria-label={`Supprimer ${file.original_name}`}
                      className="shrink-0 rounded p-1 text-text-faint hover:bg-danger-bg hover:text-danger-fg disabled:opacity-40"
                    >
                      {deleting === file.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-text-faint">
        Les pieces jointes ne sont accessibles qu aux personnes autorisees a voir ce rapport.
      </p>
    </div>
  );
}