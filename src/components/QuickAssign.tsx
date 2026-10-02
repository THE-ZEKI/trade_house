'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Loader2, AlertCircle, X, Check } from 'lucide-react';

/**
 * Attribution rapide d'un cours, sans quitter la liste.
 *
 * L 'attribution se fait aussi depuis la page du cours lui-meme. Ce raccourci
 * existe parce que le parcours le plus courant du manager est « j ai ecrit un
 * cours, je le donne a quelqu un » : l y arriver en entrant dans le cours, puis
 * en descendant jusqu au bloc Attribution, puis en choisissant un nom dans une
 * liste, cela fait trois detours pour l 'operation la plus frequente.
 *
 * Le composant ne presente QUE les traders que la base juge attribuables au
 * manager connecte : celle-ci refuserait de toute facon un trader hors equipe
 * (FORMATION-04), et proposer ces noms ferait croire que l echec serait un bug.
 */
export default function QuickAssign({
  courseId,
  traders,
}: {
  courseId: string;
  traders: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [traderId, setTraderId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okFor, setOkFor] = useState<string | null>(null);

  async function assign() {
    if (!traderId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/training/assignments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courseId, traderId, dueAt: null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        setError(data?.error?.message ?? 'Attribution refusee');
        return;
      }
      setOkFor(courseId);
      setTraderId('');
      setOpen(false);
      router.refresh();
    } catch {
      setError('Serveur injoignable');
    } finally {
      setBusy(false);
    }
  }

  if (traders.length === 0) {
    return (
      <span className="shrink-0 text-xs text-text-faint">
        Aucun trader actif dans votre equipe
      </span>
    );
  }

  return (
    <span className="relative inline-flex shrink-0 items-center gap-2">
      {okFor === courseId && (
        <span className="inline-flex items-center gap-1 text-xs text-success-fg">
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
         Attribue
        </span>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-border-strong bg-white px-3 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-50"
        >
          <UserPlus className="h-3.5 w-3.5" strokeWidth={2.2} />
          Attribuer
        </button>
      ) : (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <select
            value={traderId}
            onChange={(e) => setTraderId(e.target.value)}
            aria-label="Trader a qui attribuer le cours"
            className="h-9 rounded-[10px] border border-border-strong bg-white px-2 text-xs outline-none focus:border-sky-500"
          >
            <option value="">Choisir un trader…</option>
            {traders.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={assign}
            disabled={busy || !traderId}
            className="inline-flex h-9 items-center gap-1 rounded-[10px] bg-sky-500 px-3 text-xs font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Valider
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setTraderId('');
              setError(null);
            }}
            aria-label="Annuler l attribution"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-border-strong bg-white text-text-faint hover:bg-surface-alt"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
          {error && (
            <span className="inline-flex items-center gap-1 text-xs text-danger-fg">
              <AlertCircle className="h-3 w-3 shrink-0" strokeWidth={2.2} />
              {error}
            </span>
          )}
        </span>
      )}
    </span>
  );
}