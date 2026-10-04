'use client';

/**
 * Enregistre le service worker.
 *
 * Ce composant ne rend RIEN : il n'existe que pour son effet de bord. Il est
 * place dans le layout racine, et non dans une page, parce que l'enregistrement
 * doit avoir lieu une fois — le faire dans chaque ecran le multiplierait.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI 'use client' EST INDISPENSABLE.
 *
 * navigator.serviceWorker n'existe que dans le navigateur. Le layout est rendu
 * sur le serveur, ou navigator est indefini : l'appel y echouerait et toute la
 * page casserait au premier rendu.
 *
 * ---------------------------------------------------------------------------
 * L'ECHEC EST SILENCIEUX, ET C'EST DELIBERE.
 *
 * Un service worker manquant n'empeche pas l'application de fonctionner : il
 * n'ameliore que l'ouverture hors-ligne. Lever une erreur ferait tomber la page
 * entiere sur un detail sans importance — on perdrait le tableau de bord pour un
 * cache qui n'a pas servi.
 *
 * Consequence assumee : un echec passe inapercu. Si le push depend un jour du
 * service worker, ce point devra devenir visible, car l'absence n'en sera plus
 * anodine.
 *
 * ---------------------------------------------------------------------------
 * UNE SEULE TENTATIVE PAR SESSION.
 *
 * register() est lui-meme idempotent : le navigateur ignore l'appel si le
 * service worker est deja enregistre. Aucun test d'existance n'est donc
 * necessaire, et un useState local n'ajouterait rien.
 */
export default function ServiceWorkerRegister() {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // vide volontairement : voir l'avertissement ci-dessus. Le .catch evite
      // surtout un rejet de promesse non gere, qui remonterait dans la console
      // et ferait croire a une panne.
    });
  }
  return null;
}