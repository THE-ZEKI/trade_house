'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
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
  const [query, setQuery] = useState('');

  // RECHERCHE
  //
  // Le filtre porte sur l'evenement, le canal, le statut et le message
  // d'erreur : ce sont les quatre champs texte que voit l'utilisateur. Filtrer
  // sur l'identifiant interne n'aurait aucun sens.
  //
  // useMemo evite de reconstruire le tableau a chaque frappe. La liste est
  // plafonnee a 100 lignes par la requete, donc un filtre en base
  // n'apporterait rien aujourd'hui.
  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      needle
        ? rows.filter((n) =>
            [n.event, n.channel, n.status, n.related_type ?? '', n.error_message ?? '']
              .join(' ')
              .toLowerCase()
              .includes(needle),
          )
        : rows,
    [rows, needle],
  );

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
    <div>
      <div className="border-b border-border px-4 py-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint"
            strokeWidth={2}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              isEn ? 'Search an event, a status…' : 'Rechercher un evenement, un statut…'
            }
            aria-label={isEn ? 'Search notifications' : 'Rechercher une notification'}
            className="h-10 w-full rounded-[10px] border border-border-strong bg-white pl-9 pr-9 text-sm outline-none focus:border-accent"
          />
          {needle && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={isEn ? 'Clear search' : 'Effacer la recherche'}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-pill p-1 text-text-faint transition-colors hover:bg-surface-alt hover:text-text"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </div>
        {/* Le compteur passe de « N notifications » a « N sur M ». Sans lui le
            resultat du filtre est muet : l'utilisateur ne sait pas s'il a
            trouve ce qu'il cherchait, ou si la liste est vide par nature. */}
        {needle && (
          <p className="mt-2 text-xs text-text-faint tnum">
            {visible.length} / {rows.length}
          </p>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-text-muted">
          {isEn ? 'No notification matches this search.' : 'Aucune notification ne correspond.'}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((n) => {
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
      )}
    </div>
  );
}