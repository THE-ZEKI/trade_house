'use client';

import { useEffect, useState } from 'react';

/**
 * Ecran de chargement : une courbe de trading qui se dessine en boucle.
 *
 * Trois couches animees se relaient sur le meme trace, ce qui donne l impression
 * d'un prix qui avance plutot que d'un simple sablier :
 *
 *   1. le trace complet, tres attenuation, en repere de fond ;
 *   2. une portion « deja parcourue » qui se remplit de gauche a droite ;
 *   3. une tete lumineuse qui circule le long de la courbe.
 *
 * Deux choix meritent d'etre expliques.
 *
 * - Aucune bibliotheque de trace. La courbe est une liste de points convertis en
 *   coordonnees SVG : pas de dependance, pas de calcul de largeur de chemin, et
 *   un rendu identique avant et apres hydratation. Un ecran de chargement ne doit
 *   jamais provoquer de difference d'hydratation.
 *
 * - L'animation est en SMIL, que l'on ne peut pas desactiver par media query.
 *   On lit donc `prefers-reduced-motion` en JavaScript et l'on rend un trace
 *   statique a la place. C est plus de code, mais une animation infinie imposee
 *   malgre une preference d'accesibilite est un vrai defaut, pas un detail.
 */

const POINTS = [
  [0, 62], [8, 58], [16, 64], [24, 52], [32, 55], [40, 40],
  [48, 46], [56, 30], [64, 36], [72, 22], [80, 28], [88, 14], [100, 8],
];

const W = 1000;
const H = 320;
const DURATION = '2.8s';
/* Longueur de la polyligne approchee : assez large pour couvrir le trace. */
const DASH = '2600';

function trace(): string {
  return POINTS.map(([x, y], i) => {
    const px = ((x / 100) * W).toFixed(1);
    const py = ((y / 100) * H).toFixed(1);
    return `${i === 0 ? 'M' : 'L'}${px},${py}`;
  }).join(' ');
}

const PATH = trace();

export default function Loading() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    // On suit le changement : un utilisateur peut activer la preference en
    // cours de session, et une animation qui ne s arrete plus serait irrespectueuse.
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-xl">
        <div className="overflow-hidden rounded-[10px] border border-border bg-white px-3 py-7">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Chargement en cours">
            <defs>
              {/* Degrade du passage parcouru : pale a gauche, sature a droite. */}
              <linearGradient id="th-progress" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.45" />
                <stop offset="60%" stopColor="#0ea5e9" stopOpacity="1" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.9" />
              </linearGradient>

              <radialGradient id="th-glow">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
                <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
              </radialGradient>

              <filter id="th-blur" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="12" />
              </filter>
            </defs>

            {/* 1. repere */}
            <path
              d={PATH}
              fill="none"
              stroke="#e0f2fe"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* 2. portion deja parcourue */}
            <path
              d={PATH}
              fill="none"
              stroke={reduced ? '#0ea5e9' : 'url(#th-progress)'}
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={reduced ? undefined : DASH}
              strokeDashoffset={reduced ? undefined : DASH}
            >
              {reduced ? null : (
                <animate
                  attributeName="stroke-dashoffset"
                  from={DASH}
                  to="0"
                  dur={DURATION}
                  repeatCount="indefinite"
                />
              )}
            </path>

            {/* 3. tete lumineuse */}
            {reduced ? null : (
              <g>
                <animateMotion
                  dur={DURATION}
                  repeatCount="indefinite"
                  path={PATH}
                  keyPoints="0;1"
                  keyTimes="0;1"
                  calcMode="linear"
                />
                <circle r="36" fill="url(#th-glow)" filter="url(#th-blur)" />
                <circle r="9" fill="#ffffff" stroke="#0ea5e9" strokeWidth="3" />
              </g>
            )}
          </svg>
        </div>

        <div className="mt-4 flex items-center justify-center gap-2.5">
          <span
            className={`h-1.5 w-1.5 rounded-pill bg-sky-500 ${reduced ? '' : 'animate-pulse'}`}
          />
          <p className="text-sm text-text-muted">Chargement…</p>
        </div>
      </div>
    </div>
  );
}