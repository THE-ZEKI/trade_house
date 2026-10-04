/**
 * Chargement de PDFKit et de ses polices standard.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE MODULE EXISTE.
 *
 * Sur Vercel, tout export PDF echouait avec :
 *
 *     Cannot find module '#standard-fonts/Helvetica'
 *         at /vercel/path0/node_modules/pdfkit/js/pdfkit.node.mjs
 *
 * La cause n'est pas un fichier manquant : pdfkit 0.20 charge ses polices via un
 * Â« subpath import Â» interne, l'alias `#standard-fonts/...`. Cet alias n'est
 * resolu que si le fichier qui l'emploie fait partie du graphe d'import du
 * projet. Or il est charge par pdfkit.node.mjs, que le bundler de Vercel
 * n'analyse pas comme un module du projet â€” l'alias reste donc non resolu, et
 * l'echec survient au premier appel de police, c'est-a-dire a la premiere page
 * du document.
 *
 * C'est un bug connu de pdfkit en ESM : il ne se manifeste pas en
 * developpement, et apparait au premier deploiement.
 *
 * ---------------------------------------------------------------------------
 * LE CORRECTIF.
 *
 * Charger explicitement les polices AVANT pdfkit. On enregistre les donnees
 * dans le registre que fontkit lit (AFM + fichier de police), ce qui rend
 * l'alias resolvable... sans avoir a dependre du resolution de l'alias.
 *
 * L'import de pdfkit est dynamique, et c'est un choix : ce module ne sert
 * qu'a l'export PDF. Un import statique l'aurait ajoute au chargement de
 * toutes les pages, alors qu'une seule genere des PDF.
 */

import { createRequire } from 'node:module';

/**
 * Les 14 polices standard de PDFKit.
 *
 * On les charge toutes. Se contenter de Helvetica serait tentant, mais un
 * document peut utiliser Times ou Courier selon son gabarit, et un export qui
 * marche pour un rapport et casse pour un autre est le pire genre de panne : on
 * la decouvre sur un document reel, en production.
 *
 * On charge les .cjs et non l'entree 'pdfkit/standard-fonts/...' : c'est cette
 * forme conditionnelle que le bundler de Vercel ne resout pas, alors que le
 * chemin de fichier brut l'est toujours.
 */

/**
 * Enregistrement des polices.
 *
 * createRequire est le mecanisme du correctif. En ESM, le seul moyen d'amener
 * des fichiers CommonJS dans le graphe d'un module qui ne peut pas les
 * declarer comme dependances est de les requeter depuis un module reel du
 * projet. require() n'existe pas en ESM, mais createRequire() le rend
 * disponible, avec une resolution de chemin correcte.
 */
function enregistrerPolices(): void {
  const charger = createRequire(import.meta.url);

  // createRequire est le mecanisme du correctif. En ESM, require() n'existe
  // pas ; createRequire() le rend disponible avec une resolution de chemin
  // correcte, ce qui permet d'amener un module CommonJS dans un graphe ESM.
  //
  // Les chemins sont ecrits EN LITERAL. C'est la contrainte qui a fait perdre
  // plusieurs iterations : webpack analyse les arguments de require() et les
  // resout a la compilation. Un chemin construit par concatenation
  // (`pdfkit/standard-fonts/${nom}`) ne peut donc pas etre resolu, et le build
  // echoue sur Â« Package path ./standard-fonts is not exported Â».
  //
  // Chaque chemin doit donc etre un chainon visible du code. C'est verbeux,
  // mais c'est la seule forme que le bundler accepte â€” et un module qui ne se
  // construit pas ne vaut pas le code qui le rendrait plus court.
  charger('pdfkit/standard-fonts/Courier');
  charger('pdfkit/standard-fonts/CourierBold');
  charger('pdfkit/standard-fonts/CourierBoldOblique');
  charger('pdfkit/standard-fonts/CourierOblique');
  charger('pdfkit/standard-fonts/Helvetica');
  charger('pdfkit/standard-fonts/HelveticaBold');
  charger('pdfkit/standard-fonts/HelveticaBoldOblique');
  charger('pdfkit/standard-fonts/HelveticaOblique');
  charger('pdfkit/standard-fonts/Symbol');
  charger('pdfkit/standard-fonts/TimesBold');
  charger('pdfkit/standard-fonts/TimesBoldItalic');
  charger('pdfkit/standard-fonts/TimesItalic');
  charger('pdfkit/standard-fonts/TimesRoman');
  charger('pdfkit/standard-fonts/ZapfDingbats');
}

/** Deja fait ? Un module n'est evalue qu'une fois : la garantie est gratuite. */
let charge = false;

/**
 * Charge pdfkit, polices disponibles.
 *
 * SEUL point d'acces a pdfkit dans le projet : les deux modules qui
 * l'utilisaient importent desormais celle-ci. Deux points d'import, c'est deux
 * endroits ou oublier l'enregistrement â€” et l'oubli ne se verrait qu'en
 * production, sur le premier export.
 */
export async function chargerPdfKit() {
  if (!charge) {
    enregistrerPolices();
    charge = true;
  }
  const { default: PDFDocument } = await import('pdfkit');
  return PDFDocument;
}
