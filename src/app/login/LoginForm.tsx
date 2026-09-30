'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type State =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'error'; message: string; rule?: string | null }
  | { kind: 'mfa_setup_required' }
  | { kind: 'mfa_challenge_required' };

export default function LoginForm({ next = '/' }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setState({ kind: 'busy' });

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        setState({
          kind: 'error',
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
      if (data.status === 'mfa_setup_required') {
        setState({ kind: 'mfa_setup_required' });
        return;
      }
      setState({ kind: 'mfa_challenge_required' });
    } catch {
      setState({ kind: 'error', message: 'Serveur injoignable', rule: null });
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 14 }}>
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 13, color: '#374151' }}>Adresse email</span>
        <input
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
          placeholder="prenom.nom@exemple.com"
        />
      </label>

      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 13, color: '#374151' }}>Mot de passe</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />
      </label>

      {state.kind === 'error' && (
        <p
          role="alert"
          style={{
            margin: 0,
            fontSize: 13,
            color: '#b91c1c',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            padding: '8px 10px',
          }}
        >
          {state.message}
          {state.rule ? <span style={{ opacity: 0.7 }}> ({state.rule})</span> : null}
        </p>
      )}

      {state.kind === 'mfa_setup_required' && (
        <p style={{ fontSize: 13, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', margin: 0 }}>
          La double authentification est obligatoire pour votre compte : configurez votre
          authentificateur avant de continuer.
        </p>
      )}

      {state.kind === 'mfa_challenge_required' && (
        <p style={{ fontSize: 13, color: '#1e40af', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 10px', margin: 0 }}>
          Saisissez le code de votre application d&apos;authentification.
        </p>
      )}

      <button
        type="submit"
        disabled={state.kind === 'busy'}
        style={{
          height: 42,
          border: 0,
          borderRadius: 8,
          background: state.kind === 'busy' ? '#93a3b8' : '#111827',
          color: '#fff',
          fontWeight: 600,
          cursor: state.kind === 'busy' ? 'default' : 'pointer',
        }}
      >
        {state.kind === 'busy' ? 'Connexion…' : 'Se connecter'}
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  height: 40,
  padding: '0 10px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 14,
  width: '100%',
};
