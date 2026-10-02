'use client';

import { useState } from 'react';
import Link from 'next/link';
import MessageThread, { type Msg } from './MessageThread';

type Trader = {
  id: string;
  full_name: string;
  last_message: string | null;
  last_at: string | null;
  unread: number;
};

/**
 * L'equipe du manager : la liste de ses traders, et la conversation avec
 * chacun.
 *
 * UNE SEULE PAGE, un fil a la fois. Un fil par onglet, ou une fenetre modale
 * par trader, obligeraient a charger autant de donnees que de correspondants et
 * a reconstruire la liste a chaque reponse. Ici le fil ouvert remplace la
 * liste, ce qui garde l'ecran lisible meme avec vingt traders.
 *
 * La liste est une seule requete : RLS limite deja les lignes a l'equipe du
 * manager, et un filtre ajoute ici serait une seconde regle.
 */
export default function TeamPanel({
  meId,
  traders,
  initialSelected,
  messages,
  isAdmin,
}: {
  meId: string;
  traders: Trader[];
  initialSelected: string | null;
  messages: Msg[];
  isAdmin: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const current = traders.find((t) => t.id === selected) ?? null;

  if (selected && current) {
    return (
      <div className="grid gap-3">
        <Link
          href="/equipe"
          className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
        >
          &larr; Mon equipe
        </Link>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{current.full_name}</h2>
          {current.unread > 0 && (
            <span className="rounded-pill bg-sky-500 px-2 py-0.5 text-xs font-semibold text-white tnum">
              {current.unread}
            </span>
          )}
        </div>
        <MessageThread
          messages={messages}
          meId={meId}
          counterpartId={current.id}
          counterpartName={current.full_name}
        />
      </div>
    );
  }

  if (traders.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        {isAdmin
          ? 'Aucun trader actif.'
          : 'Aucun trader dans votre equipe. Invitez un compte pour commencer.'}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border rounded-[10px] border border-border">
      {traders.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => setSelected(t.id)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-alt"
          >
            <span className="h-9 w-9 shrink-0 rounded-pill bg-sky-100 text-center text-sm font-semibold leading-9 text-sky-700">
              {t.full_name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{t.full_name}</span>
              {t.last_message && (
                <span className="mt-0.5 block truncate text-xs text-text-faint">
                  {t.last_message}
                </span>
              )}
            </span>
            {t.unread > 0 && (
              <span className="shrink-0 rounded-pill bg-sky-500 px-2 py-0.5 text-xs font-semibold text-white tnum">
                {t.unread}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}