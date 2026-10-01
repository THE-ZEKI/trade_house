'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';

/**
 * Recherche et filtres de la liste des comptes (design system §4, §6.8).
 *
 * Le filtre est porte par l'URL (?q= et ?role=) et non par un etat local : la
 * liste reste partageable, et le filtrage se fait en base. Avec trente comptes
 * de test aujourd'hui, un filtre cote client passerait — il echouerait des le
 * premier vrai volume.
 *
 * Anti-rebond : on ne relance pas a chaque frappe. Sans lui, « manager »
 * declenche sept requetes en une seconde pour un mot de dix lettres.
 */

const ROLES = [
  { value: '', label: 'Tous' },
  { value: 'trader', label: 'Traders' },
  { value: 'manager', label: 'Managers' },
  { value: 'admin', label: 'Administrateurs' },
];

const DELAI = 300;

export default function UserSearch({
  q,
  role,
}: {
  q: string;
  role: string;
}) {
  const router = useRouter();
  const [texte, setTexte] = useState(q);

  // Si l'URL change par un autre chemin (retour arriere), le champ suit.
  useEffect(() => { setTexte(q); }, [q]);

  function appliquer(valeur: string, roleActif: string) {
    const params = new URLSearchParams();
    if (valeur.trim()) params.set('q', valeur.trim());
    if (roleActif) params.set('role', roleActif);
    const qs = params.toString();
    router.push(qs ? `/users?${qs}` : '/users');
    router.refresh();
  }

  // Anti-rebond : chaque frappe replace l'appel.
  useEffect(() => {
    if (texte === q) return;
    const id = setTimeout(() => appliquer(texte, role), DELAI);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texte]);

  const aUnFiltre = Boolean(q || role);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[240px] flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint"
          strokeWidth={2.2}
        />
        <input
          type="search"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          placeholder="Rechercher un nom ou un email…"
          aria-label="Rechercher un compte"
          className="h-11 w-full rounded-[10px] border border-border-strong bg-white pl-9 pr-9 text-sm outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
        />
        {texte && (
          <button
            type="button"
            onClick={() => { setTexte(''); appliquer('', role); }}
            aria-label="Effacer la recherche"
            className="absolute right-1 top-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-text-faint hover:bg-surface-alt hover:text-text"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ROLES.map((r) => {
          const actif = (role || '') === r.value;
          return (
            <button
              key={r.value || 'all'}
              type="button"
              onClick={() => { setTexte(q); appliquer(q, r.value); }}
              aria-pressed={actif}
              className={[
                'inline-flex h-11 items-center rounded-pill border px-3.5 text-sm font-semibold transition-colors',
                actif
                  ? 'border-transparent bg-sky-500 text-white'
                  : 'border-border-strong bg-white text-text-muted hover:bg-surface-alt',
              ].join(' ')}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      {aUnFiltre && (
        <button
          type="button"
          onClick={() => { setTexte(''); appliquer('', ''); }}
          className="text-[13px] font-semibold text-sky-700 hover:underline"
        >
          Effacer les filtres
        </button>
      )}
    </div>
  );
}