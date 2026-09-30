'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/auth/logout', { method: 'POST' });
        router.push('/login');
        router.refresh();
      }}
      style={{
        border: '1px solid #d1d5db',
        background: '#fff',
        borderRadius: 8,
        height: 34,
        padding: '0 14px',
        cursor: busy ? 'default' : 'pointer',
        fontSize: 13,
      }}
    >
      {busy ? 'Deconnexion…' : 'Se deconnecter'}
    </button>
  );
}
