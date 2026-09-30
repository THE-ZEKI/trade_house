/**
 * Libelles (RG-53).
 *
 * La langue est une propriete de l'utilisateur, stockee en code ('fr' | 'en'),
 * jamais en texte. Les statuts, emotions et messages d'erreur sont donc
 * traduits ici, a l'affichage, et jamais traduits automatiquement quand ils
 * sont saisis par un humain (notes, commentaires, messages de rappel).
 *
 * Les cles sont stables : une cle renommee casse les traductions en cours.
 */

export type Lang = 'fr' | 'en';

type Dict = Record<string, string>;

const fr: Dict = {
  'app.name': 'Trade House',
  'app.tagline': 'Gestion et suivi de traders',

  'nav.dashboard': 'Tableau de bord',
  'nav.reports': 'Rapports',
  'nav.meetings': 'Reunions',
  'nav.users': 'Comptes',
  'nav.audit': 'Journal d\'audit',
  'nav.settings': 'Reglages',
  'nav.profile': 'Mon profil',
  'nav.notifications': 'Notifications',

  'role.admin': 'Administrateur',
  'role.manager': 'Manager',
  'role.trader': 'Trader',

  'action.login': 'Se connecter',
  'action.logout': 'Se deconnecter',
  'action.save': 'Enregistrer',
  'action.cancel': 'Annuler',
  'action.retry': 'Reessayer',
  'action.close': 'Fermer',
  'action.view': 'Voir',

  'status.draft': 'Brouillon',
  'status.submitted': 'Soumis',
  'status.in_review': 'En revision',
  'status.correction_requested': 'Correction demandee',
  'status.resubmitted': 'Resoumis',
  'status.validated': 'Valide',
  'status.dismissed': 'Rejete',
  'status.declared': 'Declare',

  'empty.reports': 'Aucun rapport pour le moment.',
  'empty.meetings': 'Aucune reunion a venir.',
  'empty.notifications': 'Vous etes a jour.',

  'dash.to_review': 'A reviser',
  'dash.corrections': 'Correctifs en cours',
  'dash.overdue': 'Correctifs en retard',
  'dash.upcoming': 'Prochaines reunions',
  'dash.silent': 'Traders sans rapport',
  'dash.my_drafts': 'Rapports a completer',
  'dash.my_corrections': 'Correctifs a traiter',
};

const en: Dict = {
  'app.name': 'Trade House',
  'app.tagline': 'Trader management and coaching',

  'nav.dashboard': 'Dashboard',
  'nav.reports': 'Reports',
  'nav.meetings': 'Meetings',
  'nav.users': 'Accounts',
  'nav.audit': 'Audit log',
  'nav.settings': 'Settings',
  'nav.profile': 'My profile',
  'nav.notifications': 'Notifications',

  'role.admin': 'Administrator',
  'role.manager': 'Manager',
  'role.trader': 'Trader',

  'action.login': 'Sign in',
  'action.logout': 'Sign out',
  'action.save': 'Save',
  'action.cancel': 'Cancel',
  'action.retry': 'Try again',
  'action.close': 'Close',
  'action.view': 'View',

  'status.draft': 'Draft',
  'status.submitted': 'Submitted',
  'status.in_review': 'In review',
  'status.correction_requested': 'Changes requested',
  'status.resubmitted': 'Resubmitted',
  'status.validated': 'Validated',
  'status.dismissed': 'Dismissed',
  'status.declared': 'Declared',

  'empty.reports': 'No report yet.',
  'empty.meetings': 'No upcoming meeting.',
  'empty.notifications': "You're all caught up.",

  'dash.to_review': 'To review',
  'dash.corrections': 'Open corrections',
  'dash.overdue': 'Late corrections',
  'dash.upcoming': 'Upcoming meetings',
  'dash.silent': 'Traders without report',
  'dash.my_drafts': 'Reports to complete',
  'dash.my_corrections': 'Corrections to handle',
};

const DICTS: Record<Lang, Dict> = { fr, en };

/** Langue de repli : le francais, comme l'impose la RG-53. */
export function t(locale: string | null | undefined, key: string): string {
  const lang: Lang = locale === 'en' ? 'en' : 'fr';
  return DICTS[lang][key] ?? DICTS.fr[key] ?? key;
}

/**
 * Une nuance importante : `t` renvoie la CLE si la traduction manque. C'est
 * volontaire — une cle manquante doit se voir a l'ecran plutot que
 * disparaitre silencieusement.
 */
export const SUPPORTED: Lang[] = ['fr', 'en'];
