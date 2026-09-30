'use client';

import { useState } from 'react';

export default function ForgotForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch('/api/auth/password/forgot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      setSent(true);
      // en developpement, le lien est renvoye pour permettre le test
      setDevLink(data?.devLink ?? null);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div>
        <p style={{ fontSize: 14, margin: '0 0 12px' }}>
          Si un compte actif correspond a cette adresse, un email vient d&apos;etre envoye.
        </p>
        {devLink && (
          <p style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 10 }}>
            Developpement — lien de reinitialisation :{' '}
            <a href={devLink} style={{ color: '#92400e' }}>
              {devLink}
            </a>
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 14 }}>
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 13 }}>Adresse email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={input}
          autoComplete="username"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        style={{
          height: 42,
          border: 0,
          borderRadius: 8,
          background: busy ? '#9ca3af' : '#111827',
          color: '#fff',
          fontWeight: 600,
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        {busy ? 'Envoi…' : 'Recevoir un lien'}
      </button>
    </form>
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
