'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, AlertCircle, UserX, UserCheck, ShieldCheck, ShieldOff, LogOut, Mail,
  Eraser,
} from 'lucide-react';
import type { SessionUser } from '@/lib/auth';
import { can, type Action } from '@/lib/permissions';

/**
 * Actions d'administration sur un compte (DESIGN_SYSTEM §6.8).
 *
 * Chaque bouton appelle l'API, qui appelle `app.*`, qui journalise. L'interface
 * ne connait pas les regles de gestion : elle sait qui a le droit de tenter
 * quoi, et elle affiche le refus venu de la base tel quel.
 *
 * Une protection visible ici : on ne peut pas desactiver le compte avec lequel
 * on est connecte — cela supprimerait la session de l'administrateur en train
 * de travailler.
 */

type Spec = {
  action: Action;
  apiAction: string;
  label: string;
  Icon: typeof UserX;
  danger?: boolean;
  confirmText?: string;
};

export default function UserActions({
  user,
  targetId,
  isActive,
  mfaEnforced,
  anonymized,
}: {
  user: SessionUser;
  targetId: string;
  isActive: boolean;
  mfaEnforced: boolean;
  /** Un compte deja anonymise n'offre plus rien a effacer. */
  anonymized: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const isSelf = targetId === user.userId;

  const specs: Spec[] = [
    { action: 'user.invite', apiAction: 'invite', label: 'Renvoyer l invitation', Icon: Mail },
    {
      action: 'user.enforce_mfa',
      apiAction: 'mfa-required',
      label: mfaEnforced ? 'Ne plus imposer la 2FA' : 'Imposer la 2FA',
      Icon: mfaEnforced ? ShieldOff : ShieldCheck,
    },
    {
      action: 'user.revoke_sessions',
      apiAction: 'revoke-sessions',
      label: 'Revoquer les sessions',
      Icon: LogOut,
      confirmText: 'Toutes les sessions ouvertes seront fermees, sur tous les appareils.',
    },
    {
      action: isActive ? 'user.deactivate' : 'user.reactivate',
      apiAction: isActive ? 'deactivate' : 'reactivate',
      label: isActive ? 'Desactiver le compte' : 'Reactiver le compte',
      Icon: isActive ? UserX : UserCheck,
      danger: isActive,
      confirmText: isActive
        ? 'Le compte ne pourra plus se connecter. Ses donnees sont conservees.'
        : undefined,
    },
  ];

  // L'anonymisation n'est proposee que sur un compte actif et non deja
  // anonymise : sur un compte deja inactif, une desactivation suffit.
  if (!anonymized && isActive) {
    specs.push({
      action: 'user.anonymize',
      apiAction: 'anonymize',
      label: 'Effacer les donnees personnelles',
      Icon: Eraser,
      danger: true,
      confirmText:
        'Action irreversible : email, nom et telephone sont detruits et le compte est ferme. Les rapports et correctifs sont conserves.',
    });
  }

  const allowed = specs.filter(
    (s) => can(user, s.action) && !(isSelf && s.action === 'user.deactivate'),
  );

  async function run(spec: Spec) {
    setBusy(spec.apiAction);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/users/${targetId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          spec.apiAction === 'mfa-required'
            ? { action: spec.apiAction, enabled: !mfaEnforced }
            : spec.apiAction === 'anonymize'
              // Confirmation explicite dans le corps : l'API refuse sans elle.
              ? { action: spec.apiAction, confirm: true }
              : { action: spec.apiAction },
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Action refusee');
        return;
      }
      setDone(spec.label);
      setConfirming(null);
      router.refresh();
    } catch {
      setError('Serveur injoignable');
    } finally {
      setBusy(null);
    }
  }

  if (allowed.length === 0) return null;

  return (
    <div className="grid gap-2">
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-danger-bd bg-danger-bg px-3 py-2 text-xs text-danger-fg">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
          <span>{error}</span>
        </p>
      )}
      {done && !error && (
        <p className="rounded-md border border-success-bd bg-success-bg px-3 py-2 text-xs text-success-fg">
          {done} — effectue.
        </p>
      )}

      {allowed.map((s: Spec) => {
        const Icon = s.Icon;
        // Confirmation demandee : l'action part au second clic, jamais au premier.
        if (confirming === s.apiAction) {
          return (
            <div key={s.apiAction} className="rounded-md border border-border bg-surface-alt p-3">
              <p className="text-xs text-text">{s.confirmText ?? 'Confirmer cette action ?'}</p>
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className="inline-flex h-9 items-center rounded-md border border-border-strong bg-white px-3 text-xs font-semibold text-sky-700"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run(s)}
                  className={
                    'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold disabled:opacity-50 '
                    + (s.danger ? 'bg-danger-fg text-white' : 'bg-sky-500 text-white')
                  }
                >
                  {busy === s.apiAction && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.5} />}
                  Confirmer
                </button>
              </div>
            </div>
          );
        }
        return (
          <button
            key={s.apiAction}
            type="button"
            disabled={busy !== null}
            onClick={() => {
              setError(null);
              setDone(null);
              if (s.confirmText) {
                setConfirming(s.apiAction);
              } else {
                run(s);
              }
            }}
            className={[
              'inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border px-3 text-sm font-semibold transition-colors disabled:opacity-50',
              s.danger
                ? 'border-danger-bd bg-danger-bg text-danger-fg hover:brightness-97'
                : 'border-border-strong bg-white text-text-muted hover:bg-surface-alt hover:text-text',
            ].join(' ')}
          >
            {busy === s.apiAction
              ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
              : <Icon className="h-4 w-4" strokeWidth={2.5} />}
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
