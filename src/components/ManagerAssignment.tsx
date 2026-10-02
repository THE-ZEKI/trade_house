'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserCheck, UserMinus, Loader2, AlertCircle } from 'lucide-react';

/**
 * Affectation d'un trader a son manager.
 *
 * Le manager se rattache LUI-MEME ses propres traders : la base
 * (app.assign_trader_manager, migration 028) ne prend pas de parametre de
 * cible, il n'y a donc rien a choisir ici. Un seul bouton, sans liste deroulante
 * — c'est la traduction directe de la regle, et un menu qui laisserait croire
 * a un choix serait un mensonge de l'ecran.
 *
 * Detacher reste reserve a l administrateur : un trader sans manager n'a plus
 * de relecteur pour ses rapports ni de tuteur pour ses cours. Le bouton
 * n'apparait donc que pour lui.
 */
export default function ManagerAssignment({
  traderId,
  managerName,
  isAdmin,
  isSelf,
}: {
  traderId: string;
  managerName: string | null;
  /** Role du lecteur : admin ou manager. */
  isAdmin: boolean;
  /** Un manager ne peut pas se rattacher lui-meme : ce n'est pas un trader. */
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function agir(action: 'assign-manager' | 'unassign-manager') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${traderId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        setError(data?.error?.message ?? 'Operation refusee');
        return;
      }
      router.refresh();
    } catch {
      setError('Serveur injoignable');
    } finally {
      setBusy(false);
    }
  }

  const rattache = Boolean(managerName);

  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-2">
        {rattache ? (
          <>
            <UserCheck className="h-3.5 w-3.5 shrink-0 text-success-fg" strokeWidth={2.2} />
            <span className="truncate">{managerName}</span>
            {isAdmin && (
              <button
                type="button"
                onClick={() => agir('unassign-manager')}
                disabled={busy}
                title="Retirer de son equipe"
                aria-label="Retirer de son equipe"
                className="text-text-faint transition-colors hover:text-danger-fg disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <UserMinus className="h-3.5 w-3.5" strokeWidth={2.2} />
                )}
              </button>
            )}
          </>
        ) : isAdmin || isSelf ? (
          <>
            <UserMinus className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={2.2} />
            <button
              type="button"
              onClick={() => agir('assign-manager')}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md text-xs font-semibold text-sky-700 hover:underline disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Rattacher
            </button>
          </>
        ) : (
          <>
            <UserMinus className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={2.2} />
            <span className="text-text-faint">Sans manager</span>
          </>
        )}
      </span>
      {error && (
        <span className="inline-flex items-center gap-1 text-[11px] text-danger-fg">
          <AlertCircle className="h-3 w-3 shrink-0" strokeWidth={2.2} />
          {error}
        </span>
      )}
    </span>
  );
}