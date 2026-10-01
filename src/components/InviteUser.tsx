'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle, UserPlus, X, Check } from 'lucide-react';

/**
 * Invitation d'un compte (DESIGN_SYSTEM §6.8).
 *
 * `app.create_user` cree le compte puis `app.issue_invitation` produit un jeton.
 * Le lien n'est renvoye QUE si l'e-mail est en mode `log` : en production il
 * part par l'adaptateur d'envoi et n'apparait jamais a l'ecran. L'interface ne
 * fait que relayer la reponse.
 */

const ROLES = [
  { value: 'trader', label: 'Trader' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Administrateur' },
];

const INPUT =
  'h-11 w-full rounded-[10px] border border-border-strong bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100';

export default function InviteUser({ managers }: { managers: { id: string; full_name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; token: string | null } | null>(null);

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('trader');
  const [managerId, setManagerId] = useState('');
  const [mfaEnforced, setMfaEnforced] = useState(false);

  const close = () => {
    setOpen(false);
    setError(null);
  };

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          fullName: fullName.trim(),
          role,
          // Un manager est rattache a son equipe ; pour les autres roles le
          // champ est sans objet, d'ou la valeur nulle.
          managerId: role === 'trader' && managerId ? managerId : null,
          mfaEnforced,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Invitation refusee');
        return;
      }
      setSent({ email: data.user?.email ?? email.trim(), token: data.invitationToken ?? null });
      setEmail('');
      setFullName('');
      setManagerId('');
      router.refresh();
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
        className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-sky-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-600"
      >
        <UserPlus className="h-4 w-4" strokeWidth={2.5} />
        Inviter
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0c4a6e]/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-[520px] overflow-y-auto rounded-t-lg bg-surface shadow-[var(--shadow-lg)] sm:rounded-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">Inviter un compte</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Fermer"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-text-faint hover:bg-surface-alt hover:text-text"
          >
            <X className="h-5 w-5" strokeWidth={2.2} />
          </button>
        </div>

        {sent ? (
          <div className="grid gap-4 px-5 py-5">
            <div className="flex items-start gap-2.5 rounded-md border border-success-bd bg-success-bg px-3 py-2.5 text-sm text-success-fg">
              <Check className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
              <span>Invitation envoyee a {sent.email}.</span>
            </div>
            {sent.token ? (
              <label className="grid gap-1.5">
                <span className="text-[13px] font-medium text-text-muted">
                  Lien (mode developpement)
                </span>
                <textarea readOnly value={sent.token} className="mono min-h-[80px] w-full rounded-[10px] border border-border-strong bg-surface-alt px-3 py-2 text-xs break-all outline-none" />
              </label>
            ) : (
              <p className="text-xs text-text-faint">
                Le lien a ete envoye par e-mail et n est pas affiche ici.
              </p>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => { setSent(null); close(); }}
                className="inline-flex h-11 items-center rounded-[10px] bg-sky-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-600"
              >
                Fermer
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 px-5 py-5">
            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-md border border-danger-bd bg-danger-bg px-3 py-2.5 text-sm text-danger-fg">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
                <span>{error}</span>
              </p>
            )}

            <label className="grid gap-1.5">
              <span className="text-[13px] font-medium text-text-muted">
                Adresse email <span className="ml-1 text-danger-fg">*</span>
              </span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} placeholder="prenom.nom@exemple.com" />
            </label>

            <label className="grid gap-1.5">
              <span className="text-[13px] font-medium text-text-muted">
                Nom complet <span className="ml-1 text-danger-fg">*</span>
              </span>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={INPUT} />
            </label>

            <fieldset className="grid gap-2">
              <legend className="text-[13px] font-medium text-text-muted">Role</legend>
              <div className="grid grid-cols-3 gap-2">
                {ROLES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRole(r.value)}
                    aria-pressed={role === r.value}
                    className={
                      'inline-flex h-11 items-center justify-center rounded-[10px] border text-sm font-semibold transition-colors '
                      + (role === r.value
                        ? 'border-transparent bg-sky-500 text-white'
                        : 'border-border-strong bg-white text-text-muted hover:bg-surface-alt')
                    }
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </fieldset>

            {role === 'trader' && managers.length > 0 && (
              <label className="grid gap-1.5">
                <span className="text-[13px] font-medium text-text-muted">Manager</span>
                <select value={managerId} onChange={(e) => setManagerId(e.target.value)} className={INPUT}>
                  <option value="">Aucun</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name}</option>
                  ))}
                </select>
              </label>
            )}

            <label className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={mfaEnforced}
                onChange={(e) => setMfaEnforced(e.target.checked)}
                className="h-4 w-4 rounded border-border-strong"
              />
              <span className="text-sm text-text">Imposer la double authentification</span>
            </label>

            <p className="text-xs text-text-faint">
              Le lien est valable 7 jours et n autorise qu une seule activation.
            </p>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className="inline-flex h-11 items-center rounded-[10px] border border-border-strong bg-white px-4 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50">
                Annuler
              </button>
              <button
                type="button"
                disabled={busy || !email.trim() || !fullName.trim()}
                onClick={submit}
                className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-sky-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
                Envoyer l invitation
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
