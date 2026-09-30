'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LogoutButton({ label = 'Se déconnecter' }: { label?: string }) {
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
      className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-muted transition-colors hover:bg-surface-3 disabled:opacity-50"
      style={{ cursor: busy ? 'default' : 'pointer' }}
    >
      {busy ? 'Deconnexion...' : label}
    </button>
  );
}
