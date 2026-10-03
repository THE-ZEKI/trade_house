'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { NOTIFY_STATUS } from '@/lib/status';
import { CodeBadge } from '@/components/ui';

export type Notif = {
  id: string;
  event: string;
  channel: string;
  status: string;
  created_at: string;
  read_at: string | null;
  related_type: string | null;
  related_id: string | null;
  error_message: string | null;
};

/**
 * Liste des notifications, cliquables.
 *
 * CLIQUER MARQUE LU. C est la seule action de l'ecran, et c'est celle qui
 * manquait : sans elle, la cloche ne descendait jamais. Une pastille qu'on ne
 * peut pas eteindre est un reproche permanent, pas un compteur.
 *
 * Le marquage part AVANT la navigation, sans attendre la reponse : l'ecran doit
 * reconfigurer immediatement, et une erreur reseau sur une action deja
 * claramente demandee ne doit pas bloquer la navigation. En cas d'echec, le
 * `router.refresh` de la page destination renormalise l'affichage — la base
 * reste la source, pas l'etat du navigateur.
 *
 * Une notification de message mene AU FIL (034) ; les autres restent des
 * evenements sans ecran cible et ne naviguent nulle part.
 */
export default function NotificationList({
  rows,
  locale,
  role,
}: {
  rows: Notif[];
  locale: string;
  role: 'admin' | 'manager' | 'trader';
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const isEn = locale === 'en';
  const fmt = (v: unknown) =>
    v
      ? new Date(String(v)).toLocaleString(isEn ? 'en-GB' : 'fr-FR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '-';

  async function markAndGo(id: string, target: string | null) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/me', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
    } catch {
      // Sans consequence : la navigation suit, et le serveur recount.
    }
    if (target) router.push(target);
    else router.refresh();
    setBusy(false);
  }

  return (
    <ul className="divide-y divide-border">
      {rows.map((n) => {
        // Un message renvoie vers LE FIL de celui qui le recoit : la page du
        // trader s'il est destinataire, celle du manager sinon. L'evenement
        // ne dit pas qui lit, donc on se fie au role connecte.
        const target =
          n.related_type === 'message' && n.related_id
            ? role === 'trader'
              ? '/mon-manager'
              : '/equipe'
            : null;

        const unread = !n.read_at;

        return (
          <li key={String(n.id)}>
            <button
              type="button"
              disabled={busy}
              onClick={() => markAndGo(String(n.id), target)}
              className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-alt disabled:opacity-60 ${
                unread ? 'bg-sky-50' : ''
              }`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm">{String(n.event)}</span>
                  {unread && (
                    <span className="rounded-pill bg-sky-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {isEn ? 'new' : 'nouveau'}
                    </span>
                  )}
                </div>
                <div className="tnum mt-0.5 text-xs text-text-faint">
                  {fmt(n.created_at)} · {String(n.channel)}
                  {n.related_type ? ` · ${String(n.related_type)}` : ''}
                </div>
                {n.error_message ? (
                  <div className="mt-1 text-xs text-danger">{String(n.error_message)}</div>
                ) : null}
              </div>
              <CodeBadge table={NOTIFY_STATUS} code={n.status} locale={locale} prefix="send" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}