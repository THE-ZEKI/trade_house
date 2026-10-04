'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { Search, X } from 'lucide-react';
import MessageThread, { type Msg } from './MessageThread';

type Interlocuteur = {
  id: string;
  full_name: string;
  // 036 : l'admin parle a tout le monde, donc tout le monde le voit dans SA
  // liste. Le role sert a l'afficher : « Administrateur » se distingue
  // immediatement d'un manager homonyme.
  role: 'admin' | 'manager' | 'trader';
  last_message: string | null;
  last_at: string | null;
  unread: number;
};

/**
 * La liste des interlocuteurs, et la conversation avec chacun.
 *
 * UNE SEULE PAGE, un fil a la fois. Un fil par onglet, ou une fenetre modale
 * par interlocuteur, obligeraient a charger autant de donnees que de
 * correspondants et a reconstruire la liste a chaque reponse. Ici le fil ouvert
 * remplace la liste, ce qui garde l'ecran lisible meme avec vingt comptes.
 *
 * La recherche est COTE CLIENT et porte sur le nom et l'apercu du dernier
 * message. Aucune requete n'est refaite : la liste fait deja quelques
 * dizaines de lignes, et un aller-retour a chaque frappe rendrait la saisie
 * saccadee. Sur une liste qui devrait un jour depasser la centaine, il faudra
 * basculer cote serveur — pas avant.
 */
export default function TeamPanel({
  meId,
  interlocuteurs,
  initialSelected,
  messages,
  isAdmin,
  backHref = '/equipe',
  backLabel = 'Mon equipe',
}: {
  meId: string;
  interlocuteurs: Interlocuteur[];
  initialSelected: string | null;
  messages: Msg[];
  isAdmin: boolean;
  // 036 : la page est partagee entre /equipe et /mon-manager. Le lien de retour
  // doit suivre la page d'origine : un « retour a Mon equipe » affiche a un
  // trader l'ecran de quelqu'un d'autre.
  backHref?: string;
  backLabel?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const current = interlocuteurs.find((t) => t.id === initialSelected) ?? null;

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? interlocuteurs.filter(
        (t) =>
          t.full_name.toLowerCase().includes(needle) ||
          (t.last_message ?? '').toLowerCase().includes(needle),
      )
    : interlocuteurs;

  // Le fil selectionne VIT DANS L URL (?with=...), pas dans un etat local.
  //
  // Les messages sont charges par le serveur, qui ne sait qu'un fil a la fois
  // et le sait grace a ce parametre. Un useState ici affichait un fil VIDE :
  // le composant trouvait l'interlocuteur dans la liste, montrait l'en-tete et
  // le formulaire, mais `messages` restait le tableau de l'URL precedente —
  // d'ou « Aucun message » sous un titre de conversation. Naviguer rejoue le
  // serveur, et c'est aussi ce qui marque reellement les messages comme lus
  // (la page ecrit, pas le navigateur).
  const openThread = (id: string) => router.push(`${backHref}?with=${id}`);

  if (initialSelected && current) {
    return (
      <div className="grid gap-3">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
        >
          &larr; {backLabel}
        </Link>
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            {current.full_name}
            {/* meme rappel de role qu dans la liste : sans lui, un fil ouvert
                ne dit pas a qui l on parle. */}
            {current.role === 'admin' ? (
              <span className="rounded-pill bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                administrateur
              </span>
            ) : isAdmin ? (
              <span className="rounded-pill bg-surface-alt px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-faint">
                {current.role === 'manager' ? 'manager' : 'trader'}
              </span>
            ) : null}
          </h2>
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

  if (interlocuteurs.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        {isAdmin
          ? 'Aucun compte actif : invitez un manager ou un trader pour commencer.'
          : 'Aucun trader dans votre equipe. Invitez un compte pour commencer.'}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* RECHERCHE
          Un champ au-dessus de la liste. Il filtre sur le nom ET sur l'apercu du
          dernier message : chercher « sli » doit retrouver la conversation dont on
          se souvient du mot, pas seulement le prenom de l'interlocuteur.

          Le bouton d'effacement n'apparait QUE si le champ contient quelque
          chose : un X permanent devant un champ vide est un bruit visuel. */}
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
            isAdmin ? 'Rechercher un manager ou un trader…' : 'Rechercher un trader…'
          }
          aria-label="Rechercher un interlocuteur"
          className="h-10 w-full rounded-[10px] border border-border-strong bg-white pl-9 pr-9 text-sm outline-none focus:border-accent"
        />
        {needle && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Effacer la recherche"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-pill p-1 text-text-faint transition-colors hover:bg-surface-alt hover:text-text"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-text-muted">
          Aucun interlocuteur ne correspond a « {query.trim()} ».
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-[10px] border border-border">
          {filtered.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => openThread(t.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-alt"
              >
                <span className="h-9 w-9 shrink-0 rounded-pill bg-sky-100 text-center text-sm font-semibold leading-9 text-sky-700">
                  {t.full_name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{t.full_name}</span>
                    {/* Le rappel de role ne depend PAS du role du lecteur : c'est
                        le MANAGER qui doit voir « admin » sur la ligne de
                        l'administrateur, puisque c'est la seule ligne qui ne
                        fait pas partie de son equipe. Le conditionner a isAdmin
                        — comme avant 036 — l'aurait justement masque. */}
                    {t.role === 'admin' && (
                      <span className="shrink-0 rounded-pill bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                        administrateur
                      </span>
                    )}
                    {isAdmin && t.role !== 'admin' && (
                      <span className="shrink-0 rounded-pill bg-surface-alt px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-faint">
                        {t.role === 'manager' ? 'manager' : 'trader'}
                      </span>
                    )}
                  </span>
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
      )}
    </div>
  );
}