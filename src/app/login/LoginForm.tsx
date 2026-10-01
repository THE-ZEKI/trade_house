'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Eye, EyeOff, Loader2, AlertCircle, ShieldCheck, KeyRound, Lock,
} from 'lucide-react';

/**
 * Formulaire de connexion et second facteur (DESIGN_SYSTEM §6.1).
 *
 * Un ecran, trois etats : identifiants, 2FA par code, 2FA par code de secours.
 *
 * Choix de conception : le message d'erreur ne distingue JAMAIS « compte
 * inexistant » de « mot de passe faux ». L'API renvoie deja un message unique
 * (RG-02, anti-enumeration) ; l'interface ne doit pas le contourner en
 * traduisant des details techniques.
 */

type Step = 'credentials' | 'mfa' | 'mfa_backup' | 'mfa_setup';

const BTN_PRIMARY =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-sky-500 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60';
const BTN_SECONDARY =
  'inline-flex h-11 w-full items-center justify-center rounded-[10px] border border-border-strong bg-white text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50';
const INPUT =
  'h-11 w-full rounded-[10px] border border-border-strong bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100';
const LABEL = 'text-[13px] font-medium text-text-muted';

function Notice({
  tone,
  children,
}: {
  tone: 'error' | 'info' | 'warn';
  children: React.ReactNode;
}) {
  const map = {
    error: { box: 'border-danger-bd bg-danger-bg text-danger-fg', Icon: AlertCircle },
    info: { box: 'border-info-bd bg-info-bg text-info-fg', Icon: ShieldCheck },
    warn: { box: 'border-warn-bd bg-warn-bg text-warn-fg', Icon: Lock },
  } as const;
  const { box, Icon } = map[tone];
  return (
    <div className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm ${box}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
      <span>{children}</span>
    </div>
  );
}

export default function LoginForm({ next = '/' }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<Step>('credentials');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; rule?: string | null } | null>(null);

  // Code TOTP : 6 cases. `digits` est la seule source de verite, les cases
  // n'en sont qu'une vue — un collage du code complet s'y redistribue.
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [backup, setBackup] = useState('');
  const [backupLeft, setBackupLeft] = useState<number | null>(null);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (step === 'mfa') refs.current[0]?.focus();
  }, [step]);

  function resetError() {
    setError(null);
  }

  async function submitCredentials(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    resetError();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError({
          message: data?.error?.message ?? 'Connexion impossible',
          rule: data?.error?.rule ?? null,
        });
        return;
      }
      if (data.status === 'authenticated') {
        router.push(next);
        router.refresh();
        return;
      }
      setStep(data.status === 'mfa_setup_required' ? 'mfa_setup' : 'mfa');
    } catch {
      setError({ message: 'Serveur injoignable' });
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa(event: React.FormEvent) {
    event.preventDefault();
    const code = step === 'mfa_backup' ? backup.trim() : digits.join('');
    if (!code) return;

    setBusy(true);
    resetError();
    try {
      const res = await fetch('/api/auth/mfa/challenge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError({
          message: data?.error?.message ?? 'Code invalide',
          rule: data?.error?.rule ?? null,
        });
        // On repart d'un code vide : le reutiliser autoriserait a renvoyer un
        // code deja consomme cote base.
        setDigits(Array(6).fill(''));
        refs.current[0]?.focus();
        return;
      }
      if (typeof data.backupCodesRemaining === 'number') {
        setBackupLeft(data.backupCodesRemaining);
      }
      router.push(next);
      router.refresh();
    } catch {
      setError({ message: 'Serveur injoignable' });
    } finally {
      setBusy(false);
    }
  }

  function setDigit(index: number, value: string) {
    const clean = value.replace(/\D/g, '');
    const next = [...digits];
    if (clean.length > 1) {
      // Collage : on repartit les chiffres sur les cases suivantes.
      clean.slice(0, 6 - index).split('').forEach((d, i) => { next[index + i] = d; });
      setDigits(next);
      refs.current[Math.min(index + clean.length, 5)]?.focus();
      return;
    }
    next[index] = clean;
    setDigits(next);
    if (clean && index < 5) refs.current[index + 1]?.focus();
  }

  const submitButton = (
    <button type="submit" disabled={busy} className={BTN_PRIMARY}>
      {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
      {busy ? 'Connexion…' : 'Se connecter'}
    </button>
  );

  const errorBox = error ? (
    <Notice tone="error">
      {error.message}
      {error.rule ? <span className="ml-1.5 opacity-70">({error.rule})</span> : null}
    </Notice>
  ) : null;

if (step === 'mfa' || step === 'mfa_backup') {
    const usingBackup = step === 'mfa_backup';
    return (
      <form onSubmit={submitMfa} className="grid gap-4">
        <Notice tone="info">
          {usingBackup
            ? 'Saisissez un de vos codes de secours.'
            : 'Saisissez le code à 6 chiffres de votre application d’authentification.'}
        </Notice>

        {usingBackup ? (
          <label className="grid gap-1.5">
            <span className={LABEL}>Code de secours</span>
            <input
              value={backup}
              onChange={(e) => { setBackup(e.target.value); resetError(); }}
              autoComplete="one-time-code"
              placeholder="xxxxxxxx"
              className={`${INPUT} mono uppercase tracking-wider`}
            />
          </label>
        ) : (
          <div className="grid gap-2">
            <span className={LABEL}>Code de verification</span>
            <div className="grid grid-cols-6 gap-2">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => { refs.current[i] = el; }}
                  value={d}
                  onChange={(e) => { setDigit(i, e.target.value); resetError(); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
                  }}
                  onPaste={(e) => {
                    e.preventDefault();
                    setDigit(i, e.clipboardData.getData('text'));
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  aria-label={`Chiffre ${i + 1}`}
                  className="tnum h-12 w-full rounded-[10px] border border-border-strong bg-white text-center text-lg font-semibold outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                />
              ))}
            </div>
          </div>
        )}

        {errorBox}
        {backupLeft !== null && (
          <p className="text-xs text-text-faint">
            Il vous reste <strong className="tnum">{backupLeft}</strong> code(s) de secours.
          </p>
        )}

        {submitButton}

        <button
          type="button"
          onClick={() => { setStep(usingBackup ? 'mfa' : 'mfa_backup'); resetError(); }}
          className="inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold text-sky-700 hover:underline"
        >
          <KeyRound className="h-3.5 w-3.5" strokeWidth={2.5} />
          {usingBackup ? 'Utiliser le code de l’application' : 'Utiliser un code de secours'}
        </button>
      </form>
    );
  }

  if (step === 'mfa_setup') {
    return (
      <div className="grid gap-4">
        <Notice tone="warn">
          La double authentification est obligatoire pour votre compte. Configurez votre
          authentificateur pour continuer.
        </Notice>
        <button type="button" onClick={() => { setStep('credentials'); resetError(); }} className={BTN_SECONDARY}>
          Revenir
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submitCredentials} className="grid gap-4">
      <label className="grid gap-1.5">
        <span className={LABEL}>Adresse email</span>
        <input
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => { setEmail(e.target.value); resetError(); }}
          placeholder="prenom.nom@exemple.com"
          className={INPUT}
        />
      </label>

      <label className="grid gap-1.5">
        <span className={LABEL}>Mot de passe</span>
        <span className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => { setPassword(e.target.value); resetError(); }}
            className={`${INPUT} pr-11`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            className="absolute right-1 top-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-text-faint hover:bg-surface-alt hover:text-text"
          >
            {showPassword
              ? <EyeOff className="h-4 w-4" strokeWidth={2.2} />
              : <Eye className="h-4 w-4" strokeWidth={2.2} />}
          </button>
        </span>
      </label>

      {errorBox}
      {submitButton}
    </form>
  );
}
