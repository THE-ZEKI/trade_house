'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle, Pencil, X, Check } from 'lucide-react';
import type { SessionUser } from '@/lib/auth';
import { can } from '@/lib/permissions';

/**
 * Modification d'un compte (DESIGN_SYSTEM §6.8).
 *
 * Ce formulaire existe parce que la suppression de compte n'existe pas, et que
 * corriger un nom, un role ou un manager est un besoin legitime. Il ne touche
 * qu'aux champs prevus : ni l'email (il identifie la personne), ni le mot de
 * passe (il passe par une invitation ou une reinitialisation).
 *
 * La base reste juge : `app.update_user_account` refuse un role invalide, un
 * manager qui n'existe pas, et le retrait du role administrateur de l'appelant.
 */

const ROLES = [
  { value: 'trader', label: 'Trader' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Administrateur' },
];

const LOCALES = [
  { value: 'fr', label: 'Francais' },
  { value: 'en', label: 'English' },
];

const INPUT =
  'h-11 w-full rounded-[10px] border border-border-strong bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100';
const LABEL = 'text-[13px] font-medium text-text-muted';

type Current = {
  fullName: string;
  role: string;
  managerId: string | null;
  phone: string | null;
  timezone: string | null;
  locale: string | null;
};

export default function EditUser({
  user,
  targetId,
  current,
  managers,
}: {
  user: SessionUser;
  targetId: string;
  current: Current;
  managers: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [fullName, setFullName] = useState(current.fullName);
  const [role, setRole] = useState(current.role);
  const [managerId, setManagerId] = useState(current.managerId ?? '');
  const [phone, setPhone] = useState(current.phone ?? '');
  const [locale, setLocale] = useState(current.locale ?? 'fr');

  if (!can(user, 'user.update')) return null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${targetId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          fullName: fullName.trim(),
          role,
          managerId: role === 'trader' && managerId ? managerId : null,
          phone: phone.trim() || null,
          locale,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Modification refusee');
        return;
      }
      setDone(true);
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
        onClick={() => { setOpen(true); setError(null); setDone(false); }}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-border-strong bg-white px-4 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50"
      >
        <Pencil className="h-4 w-4" strokeWidth={2.5} />
        Modifier le compte
      </button>
    );
  }

  const close = () => { setOpen(false); setError(null); setDone(false); };

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Modifier le compte</h3>
        <button type="button" onClick={close} aria-label="Fermer" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-faint hover:bg-surface-alt hover:text-text">
          <X className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>

      <div className="grid gap-3">
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-danger-bd bg-danger-bg px-3 py-2 text-xs text-danger-fg">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
            <span>{error}</span>
          </p>
        )}
        {done && (
          <p className="flex items-start gap-2 rounded-md border border-success-bd bg-success-bg px-3 py-2 text-xs text-success-fg">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
            <span>Compte modifie.</span>
          </p>
        )}

        <label className="grid gap-1.5">
          <span className={LABEL}>Nom complet</span>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={INPUT} />
        </label>

        <fieldset className="grid gap-2">
          <legend className={LABEL}>Role</legend>
          <div className="grid grid-cols-3 gap-2">
            {ROLES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRole(r.value)}
                aria-pressed={role === r.value}
                className={
                  'inline-flex h-10 items-center justify-center rounded-[10px] border text-xs font-semibold transition-colors '
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
            <span className={LABEL}>Manager</span>
            <select value={managerId} onChange={(e) => setManagerId(e.target.value)} className={INPUT}>
              <option value="">Aucun</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>{m.full_name}</option>
              ))}
            </select>
          </label>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className={LABEL}>Telephone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={INPUT} />
          </label>
          <label className="grid gap-1.5">
            <span className={LABEL}>Langue</span>
            <select value={locale} onChange={(e) => setLocale(e.target.value)} className={INPUT}>
              {LOCALES.map((lo) => (
                <option key={lo.value} value={lo.value}>{lo.label}</option>
              ))}
            </select>
          </label>
        </div>

        <p className="text-xs text-text-faint">
          L email et le mot de passe ne se modifient pas ici : l email identifie
          la personne, le mot de passe passe par invitation ou reinitialisation.
        </p>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="inline-flex h-10 items-center rounded-[10px] border border-border-strong bg-white px-4 text-sm font-semibold text-sky-700">
            Fermer
          </button>
          <button
            type="button"
            disabled={busy || !fullName.trim()}
            onClick={submit}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-sky-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
