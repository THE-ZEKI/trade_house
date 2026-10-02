'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Loader2, AlertCircle } from 'lucide-react';

/**
 * Attribution d'un cours a un trader de l'equipe.
 *
 * La liste ne propose QUE les traders que la base juge attribuables au manager
 * connecte. Ce n'est pas qu'un confort : la base refuse de toute facon une
 * attribution hors equipe (FORMATION-04), et proposer ces noms laisserait
 * croire que l'echec serait un bug.
 */
export default function AssignCourse({
  courseId,
  traders,
}: {
  courseId: string;
  traders: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [traderId, setTraderId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function assign() {
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      const res = await fetch('/api/training/assignments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // La date est envoyee telle quelle : l'API la valide et la base refuse
        // une valeur hors de 0..20 comme une note.
        body: JSON.stringify({ courseId, traderId, dueAt: dueAt || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        setError(data?.error?.message ?? 'Attribution refusee');
        return;
      }
      setOk(true);
      setTraderId('');
      setDueAt('');
      router.refresh();
    } catch {
      setError('Serveur injoignable');
    } finally {
      setBusy(false);
    }
  }

  if (traders.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        Aucun trader actif dans votre equipe.attribuez le cours a un trader rattache a vous.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <select
          value={traderId}
          onChange={(e) => setTraderId(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-[10px] border border-border-strong bg-white px-3 text-sm outline-none focus:border-sky-500"
        >
          <option value="">Choisir un trader…</option>
          {traders.map((t) => (
            <option key={t.id} value={t.id}>
              {t.full_name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          aria-label="Echeance (facultatif)"
          className="h-11 rounded-[10px] border border-border-strong bg-white px-3 text-sm outline-none focus:border-sky-500"
        />
        <button
          type="button"
          onClick={assign}
          disabled={busy || !traderId}
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-[10px] bg-sky-500 px-4 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" strokeWidth={2.2} />}
          Attribuer
        </button>
      </div>
      {ok && <p className="text-xs text-success-fg">Cours attribue. Le trader le voit desormais dans sa formation.</p>}
      {error && (
        <p className="flex items-center gap-2 text-xs text-danger-fg">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          {error}
        </p>
      )}
    </div>
  );
}