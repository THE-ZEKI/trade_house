'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle, UserPlus, X, Check } from 'lucide-react';

/**
 * Invitation d'un compte (DESIGN_SYSTEM §6.8).
 *
 * Deux usages selon le role de celui qui invite :
 *
 *   - l'ADMIN choisit le role et le manager de tutelle ;
 *   - le MANAGER n'invite qu'un TRADER, qui tombe automatiquement sous sa
 *     couverture. Le formulaire lui masque donc les deux selecteurs : afficher
 *     un choix que la base refuserait de toute facon serait un mensonge
 *     de l'interface, et le message d'erreur arriverait apres coup.
 *
 * Le rattachement n'est PAS demande au manager : app.invite_trader impose
 * manager_id = l'appelant. Le serveur reste la source de verite, l'ecran ne
 * fait qu'eviter une demande qui echouerait.
 *
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

export default function InviteUser({
  managers,
  isAdmin,
  managerName,
}: {
  managers: { id: string; full_name: string }[];
  isAdmin: boolean;
  /** Nom du manager connecte, affiche pour rendre la couverture explicite. */
  managerName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; link: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  // Un manager n'a pas le choix : c'est le role trader, et lui seul.
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
      // La reponse porte `previewLink` (et non `invitationToken`) : le nom
      // precedent ne correspondait a rien et la variable valait toujours
      // undefined. Consequence : le panneau affirmait « lien envoye par
      // e-mail » alors qu'aucun e-mail n'etait parti — l'email etant en mode
      // `log`. L'admin crea le compte et ne pouvait plus jamais le rendre
      // utilisable, le nouveau trader ne pouvait pas définir son mot de passe.
      setSent({ email: data.user?.email ?? email.trim(), link: data.previewLink ?? null });
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
            {sent.link ? (
              <div className="grid gap-1.5">
                <span className="text-[13px] font-medium text-text-muted">
                  Lien d invitation — transmettez-le a la personne invitee
                </span>
                <textarea readOnly value={sent.link} className="mono min-h-[72px] w-full rounded-[10px] border border-border-strong bg-surface-alt px-3 py-2 text-xs break-all outline-none" />
<p className="text-xs text-text-faint">
                  Aucun e-mail n est envoye en developpement : ce lien est le seul
                  moyen pour la personne de definir son mot de passe.
                </p>
                <div className="flex gap-2">
                  <a
                    href={sent.link}
                    className="inline-flex h-10 flex-1 items-center justify-center rounded-[10px] bg-sky-500 px-3 text-sm font-semibold text-white hover:bg-sky-600"
                  >
                    Ouvrir le lien
                  </a>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(sent.link ?? '');
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      } catch {
                        // Presse-papiers refuse hors contexte securise : le texte
                        // reste selectionnable ci-dessus.
                        setCopied(false);
                      }
                    }}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] border border-border-strong px-3 text-sm font-semibold text-sky-700 hover:bg-sky-50"
                  >
                    {copied ? <Check className="h-4 w-4" strokeWidth={2.5} /> : null}
                    {copied ? 'Copie' : 'Copier'}
                  </button>
                </div>
              </div>
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

            {isAdmin ? (
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
            ) : (
              // Rappel du role et de la couverture : le manager ne choisit rien,
              // autant que l'ecran le dise plutot que de le laisser deviner.
              <div className="rounded-[10px] border border-border bg-surface-alt px-3 py-2.5 text-sm">
                <p className="font-medium text-text">
                  Trader{managerName ? ` rattache a ${managerName}` : ''}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Le nouveau compte travaille sous votre supervision. Role et
                  rattachement sont imposes.
                </p>
              </div>
            )}

            {isAdmin && role === 'trader' && managers.length > 0 && (
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
