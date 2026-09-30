'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Formulaire de definition du mot de passe (invitation RG-05 ou
 * reinitialisation A1). Les deux passent par la meme route differente selon
 * l'origine du jeton.
 */
export default function PasswordForm({ mode }: { mode: 'invitation' | 'reset' }) {
  const router = useRouter();
  const params = useSearchParams();
  const [token, setToken] = useState(params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState<{ length: boolean; digit: boolean; special: boolean }>({
    length: false,
    digit: false,
    special: false,
  });

  function onPassword(value: string) {
    setPassword(value);
    setRules({
      length: value.length >= 8,
      digit: /[0-9]/.test(value),
      special: /[^A-Za-z0-9]/.test(value),
    });
  }

  const strong = rules.length && rules.digit && rules.special;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas');
      return;
    }
    if (!strong) {
      setError('Le mot de passe ne respecte pas les regles');
      return;
    }

    setBusy(true);
    try {
      const url =
        mode === 'invitation' ? '/api/auth/accept-invitation' : '/api/auth/password/reset';
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data?.error?.message ?? 'Operation impossible');
        return;
      }
      if (mode === 'invitation') {
        router.push('/');
        router.refresh();
      } else {
        router.push('/login?mdp=change');
        router.refresh();
      }
    } catch {
      setError('Serveur injoignable');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 14 }}>
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 13 }}>Jeton recu par email</span>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
          style={input}
          placeholder="collez le jeton"
        />
      </label>

      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 13 }}>Nouveau mot de passe</span>
        <input
          type="password"
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          required
          autoComplete="new-password"
          style={input}
        />
      </label>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12, display: 'grid', gap: 2 }}>
        <Rule ok={rules.length} label="au moins 8 caracteres" />
        <Rule ok={rules.digit} label="au moins un chiffre" />
        <Rule ok={rules.special} label="au moins un caractere special" />
      </ul>

      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 13 }}>Confirmation</span>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
          style={input}
        />
      </label>

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: '#b91c1c' }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !strong}
        style={{
          height: 42,
          border: 0,
          borderRadius: 8,
          background: busy || !strong ? '#9ca3af' : '#111827',
          color: '#fff',
          fontWeight: 600,
          cursor: busy || !strong ? 'default' : 'pointer',
        }}
      >
        {busy ? 'Enregistrement…' : mode === 'invitation' ? 'Activer mon compte' : 'Changer le mot de passe'}
      </button>
    </form>
  );
}

function Rule({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li style={{ color: ok ? '#15803d' : '#9ca3af' }}>
      {ok ? '✓' : '○'} {label}
    </li>
  );
}

const input: React.CSSProperties = {
  height: 40,
  padding: '0 10px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 14,
  width: '100%',
};
