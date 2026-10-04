/*
 * Service worker — Trade House.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE FICHIER FAIT, ET CE QU'IL NE FAIT PAS ENCORE.
 *
 * Il enregistre l'application et met en cache l'ecran d'accueil pour qu'elle
 * s'ouvre instantanement. Il NE se subscribe PAS encore au push : c'est l'etape
 * suivante, qui demande les cles VAPID et une autorisation explicite de
 * l'utilisateur.
 *
 * L'ecrire maintenant ne coute rien et evite de revenir modifier l'enregistrement
 * plus tard, quand il faudra justement que le telephone soit sveille.
 *
 * ---------------------------------------------------------------------------
 * LE PIEGE PRINCIPAL : NE PAS CACHER LES REPONSES API.
 *
 * Un service worker qui met en cache /api/* garde en vie des donnees metier
 * obsoletees : un message envoye par un manager resterait invisible, un rapport
 * affiche comme lu le resterait. Une application de gestion ne doit JAMAIS
 * servir une donnee metier depuis un cache. Seuls les fichiers statiques —qui ne
 * changent pas — passent par le cache.
 *
 * ---------------------------------------------------------------------------
 * NETWORK FIRST, CACHE EN SECOURS.
 *
 * Pour la coquille de l'application, le reseau est tente en premier : c'est lui
 * qui garantit l'actualite. Le cache ne sert qu'a&displayer l'ecran quand le
 * reseau manque — sur un train, un sous-sol.
 *
 * L'inverse (cache d'abord) serait plus rapide mais servirait du codeancien
 * apres un deploiement, ce que la 039 documente deja comme le piege habituel.
 */

// Version du cache : a incrementer a chaque modification, c'est elle qui
// determine quel cache devient obsolete.
const CACHE = 'trade-house-v1';

// Les chemins mis en cache au premier lancement.
const SHELL = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll est atomique : si UNE seule ressource echoue, rien n'est mis en
      // cache. C'est voulu — un cache a moitie rempli est plus difficile a
      // diagnostiquer qu'un cache absent.
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((noms) =>
        Promise.all(noms.filter((nom) => nom !== CACHE).map((nom) => caches.delete(nom))),
      )
      // sans ceci, plusieurs versions cohabitent et la page est servie par
      // l'ancienne : l'utilisateur verrait un correctif « pas encore ».
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // On ne traite QUE les GET. Un POST vers une API doit partir au reseau,
  // toujours : mettre en cache une reponse a un envoi de message ferait
  // echouer silencieusement l'operation.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // meme origine uniquement : une requete vers un tiers n'a rien a faire dans
  // le cache de l'application.
  if (url.origin !== self.location.origin) return;

  // AUCUNE interception des API — voir l'avertissement en tete de fichier.
  // C'est la seule regle de ce service worker qui ne doit jamais etre relachee.
  if (url.pathname.startsWith('/api/')) return;

  // Les pages Next.js portent un _next/ : ce sont les ressources de build,
  // immuables par construction, donc_ELIGIBLES au cache.
  const estRessourceBuild = url.pathname.startsWith('/_next/static/');

  // On ne touche pas au reste : laisse le navigateur faire son travail par
  // defaut sur les pages et les images, plutot que de les mettre en cache sans
  // savoir si leur contenu est encore valide.
  if (!estRessourceBuild) return;

  event.respondWith(
    caches.match(request).then((cache) => {
      if (cache) return cache;
      return fetch(request).then((reponse) => {
        // Seules les reponses reellement servies sont copiees : une 404 ou une
        // 500 mise en cache le resterait pour toujours.
        if (reponse.ok) {
          const copie = reponse.clone();
          caches.open(CACHE).then((c) => c.put(request, copie));
        }
        return reponse;
      });
    }),
  );
});

/*
 * L'etape suivante du push se branchera ici :
 *
 *   self.addEventListener('push', (event) => { ... })
 *   self.addEventListener('notificationclick', (event) => { ... })
 *
 * Elle exige les cles VAPID et l'autorisation de l'utilisateur. Elle n'est pas
 * ecrite ici volontairement : un abonnement au push sans ecouteur du message
 * ferait vibrer le telephone sans jamais afficher de notification, ce qui est
 * pire que rien — l'utilisateur Croirait a un bug et le desinstallerait.
 */