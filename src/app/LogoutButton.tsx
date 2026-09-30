'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Loader2 } from 'lucide-react';

export default function LogoutButton({ label = 'Se déconnecter' }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const Icon = busy ? Loader2 : LogOut;

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
      className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md border border-transparent bg-transparent px-3 py-2.5 text-sm text-text-muted transition-colors hover:bg-surface-alt hover:text-text disabled:opacity-50"
    >
      <Icon className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} strokeWidth={2.2} />
      {label}
    </button>
  );
}
