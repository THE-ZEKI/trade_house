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
  'action.back': 'Retour',
  'action.search': 'Rechercher',
  'action.filters': 'Filtres',
  'action.clear_filters': 'Effacer les filtres',
  'action.new_report': 'Nouveau rapport',
  'action.continue': 'Continuer',
  'action.accept': 'Accepter',
  'action.maybe': 'Peut-etre',
  'action.decline': 'Refuser',
  'action.retry_send': 'Relancer',
  'action.mark_all_read': 'Tout marquer comme lu',
  'action.submit': 'Deposer le rapport',
  'action.resubmit': 'Resoumettre',
  'action.start_review': 'Prendre en revue',
  'action.request_corrections': 'Demander des correctifs',
  'action.validate': 'Valider',
  'action.dismiss': 'Rejeter',
  'action.reopen': 'Rouvrir',
  'action.add_correction': 'Ajouter un correctif',
  'action.invite': 'Inviter',
  'action.deactivate': 'Desactiver',
  'action.reactivate': 'Reactiver',
  'action.rsvp_accept': 'Accepter',
  'action.rsvp_maybe': 'Peut-etre',
  'action.rsvp_decline': 'Refuser',

  'act.submit': 'Deposer le rapport',
  'act.resubmit': 'Resoumettre',
  'act.start_review': 'Prendre en revue',
  'act.request_corrections': 'Demander des correctifs',
  'act.validate': 'Valider',
  'act.dismiss': 'Rejeter',
  'act.reopen': 'Rouvrir',

  'form.session_date': 'Date de session',
  'form.instrument': 'Instrument',
  'form.result_type': 'Resultat',
  'form.result_amount': 'Montant',
  'form.nb_trades': 'Nombre de trades',
  'form.plan_respected': 'Plan respecte',
  'form.rr_planned': 'R planifie',
  'form.rr_realized': 'R realise',
  'form.strategy': 'Strategie',
  'form.emotions': 'Emotions',
  'form.emotions_note': 'Precision',
  'form.highlights': 'Reussites',
  'form.mistakes': 'Erreurs',
  'form.notes': 'Notes',
  'form.no_trade_reason': 'Motif',
  'form.reason': 'Motif',
  'form.deadline': 'Echeance des correctifs',
  'form.optional': 'facultatif',
  'form.required': 'obligatoire',
  'form.rr_gap': 'Ecart',
  'form.save_draft': 'Enregistrer le brouillon',
  'form.no_trade_title': 'Declaration de non-trading',
  'form.no_trade_hint': 'Un jour sans trade est un choix, pas une absence.',
  'form.no_trade_toggle': 'Je n ai pas trade aujourd hui',

  'status.draft': 'Brouillon',
  'status.submitted': 'Depose',
  'status.in_review': 'En revue',
  'status.correction_requested': 'Correctifs demandes',
  'status.resubmitted': 'Resoumis',
  'status.validated': 'Valide',
  'status.dismissed': 'Rejete',
  'status.declared': 'Declare',

  'rsvp.pending': 'En attente',
  'rsvp.accepted': 'Accepte',
  'rsvp.declined': 'Refuse',
  'rsvp.maybe': 'Peut-etre',

  'meeting.scheduled': 'Planifiee',
  'meeting.live': 'En cours',
  'meeting.ended': 'Terminee',
  'meeting.cancelled': 'Annulee',
  'meeting.internal': 'Interne',
  'meeting.external': 'Externe',
  'meeting.instant': 'Instantanee',

  'reminder.invitation': 'Invitation',
  'reminder.d_minus_1': 'J-1',
  'reminder.h_minus_1': 'H-1',
  'reminder.custom': 'Personnalise',
  'reminder.manual': 'Manuel',

  'send.pending': 'En attente',
  'send.sending': 'Envoi en cours',
  'send.sent': 'Envoye',
  'send.failed': 'Echec',
  'send.opened': 'Ouvert',
  'send.cancelled': 'Annule',

  'attendance.present': 'Present',
  'attendance.absent': 'Absent',
  'attendance.late': 'En retard',

  'severity.mandatory': 'Bloquant',
  'severity.suggestion': 'Conseil',

  'target.general': 'General',
  'target.field': 'Champ',
  'target.file': 'Fichier',

  'correction.open': 'A traiter',
  'correction.done': 'Traite',
  'correction.rejected': 'Refuse',
  'correction.dropped': 'Abandonne',

  'file.screenshot': 'Capture',
  'file.pdf': 'PDF',
  'file.correction_attachment': 'Piece jointe',

  'result.gain': 'Gain',
  'result.loss': 'Perte',
  'result.breakeven': 'Neutre',

  'emotion.calm': 'Calme',
  'emotion.confident': 'Confiant',
  'emotion.fomo': 'Fomo',
  'emotion.impatience': 'Impatience',
  'emotion.stress': 'Stress',
  'emotion.revenge': 'Revanche',
  'emotion.other': 'Autre',

  'mfa.enrolled': '2FA active',
  'mfa.not_enrolled': '2FA inactive',
  'mfa.enforced': '2FA imposee',

  'alert.critical': 'Critique',
  'alert.late': 'En retard',
  'alert.stale': 'Obsolete',
  'plan.respected': 'Plan respecte',
  'plan.not_respected': 'Plan non respecte',

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
  'action.back': 'Back',
  'action.search': 'Search',
  'action.filters': 'Filters',
  'action.clear_filters': 'Clear filters',
  'action.new_report': 'New report',
  'action.continue': 'Continue',
  'action.accept': 'Accept',
  'action.maybe': 'Maybe',
  'action.decline': 'Decline',
  'action.retry_send': 'Resend',
  'action.mark_all_read': 'Mark all as read',
  'action.submit': 'Submit report',
  'action.resubmit': 'Resubmit',
  'action.start_review': 'Start review',
  'action.request_corrections': 'Request corrections',
  'action.validate': 'Validate',
  'action.dismiss': 'Dismiss',
  'action.reopen': 'Reopen',
  'action.add_correction': 'Add correction',
  'action.invite': 'Invite',
  'action.deactivate': 'Deactivate',
  'action.reactivate': 'Reactivate',
  'action.rsvp_accept': 'Accept',
  'action.rsvp_maybe': 'Maybe',
  'action.rsvp_decline': 'Decline',

  'act.submit': 'Submit report',
  'act.resubmit': 'Resubmit',
  'act.start_review': 'Start review',
  'act.request_corrections': 'Request corrections',
  'act.validate': 'Validate',
  'act.dismiss': 'Dismiss',
  'act.reopen': 'Reopen',

  'form.session_date': 'Session date',
  'form.instrument': 'Instrument',
  'form.result_type': 'Result',
  'form.result_amount': 'Amount',
  'form.nb_trades': 'Number of trades',
  'form.plan_respected': 'Plan respected',
  'form.rr_planned': 'Planned R',
  'form.rr_realized': 'Realized R',
  'form.strategy': 'Strategy',
  'form.emotions': 'Emotions',
  'form.emotions_note': 'Detail',
  'form.highlights': 'Highlights',
  'form.mistakes': 'Mistakes',
  'form.notes': 'Notes',
  'form.no_trade_reason': 'Reason',
  'form.reason': 'Reason',
  'form.deadline': 'Correction deadline',
  'form.optional': 'optional',
  'form.required': 'required',
  'form.rr_gap': 'Gap',
  'form.save_draft': 'Save draft',
  'form.no_trade_title': 'Non-trading declaration',
  'form.no_trade_hint': 'A day without a trade is a decision, not an absence.',
  'form.no_trade_toggle': 'I did not trade today',

  'status.draft': 'Draft',
  'status.submitted': 'Submitted',
  'status.in_review': 'In review',
  'status.correction_requested': 'Changes requested',
  'status.resubmitted': 'Resubmitted',
  'status.validated': 'Validated',
  'status.dismissed': 'Dismissed',
  'status.declared': 'Declared',

  'rsvp.pending': 'Pending',
  'rsvp.accepted': 'Accepted',
  'rsvp.declined': 'Declined',
  'rsvp.maybe': 'Maybe',

  'meeting.scheduled': 'Scheduled',
  'meeting.live': 'Live',
  'meeting.ended': 'Ended',
  'meeting.cancelled': 'Cancelled',
  'meeting.internal': 'Internal',
  'meeting.external': 'External',
  'meeting.instant': 'Instant',

  'reminder.invitation': 'Invitation',
  'reminder.d_minus_1': 'D-1',
  'reminder.h_minus_1': 'H-1',
  'reminder.custom': 'Custom',
  'reminder.manual': 'Manual',

  'send.pending': 'Pending',
  'send.sending': 'Sending',
  'send.sent': 'Sent',
  'send.failed': 'Failed',
  'send.opened': 'Opened',
  'send.cancelled': 'Cancelled',

  'attendance.present': 'Present',
  'attendance.absent': 'Absent',
  'attendance.late': 'Late',

  'severity.mandatory': 'Blocking',
  'severity.suggestion': 'Suggestion',

  'target.general': 'General',
  'target.field': 'Field',
  'target.file': 'File',

  'correction.open': 'Open',
  'correction.done': 'Done',
  'correction.rejected': 'Rejected',
  'correction.dropped': 'Dropped',

  'file.screenshot': 'Screenshot',
  'file.pdf': 'PDF',
  'file.correction_attachment': 'Attachment',

  'result.gain': 'Gain',
  'result.loss': 'Loss',
  'result.breakeven': 'Neutral',

  'emotion.calm': 'Calm',
  'emotion.confident': 'Confident',
  'emotion.fomo': 'FOMO',
  'emotion.impatience': 'Impatience',
  'emotion.stress': 'Stress',
  'emotion.revenge': 'Revenge',
  'emotion.other': 'Other',

  'mfa.enrolled': '2FA active',
  'mfa.not_enrolled': '2FA inactive',
  'mfa.enforced': '2FA enforced',

  'alert.critical': 'Critical',
  'alert.late': 'Late',
  'alert.stale': 'Stale',
  'plan.respected': 'Plan respected',
  'plan.not_respected': 'Plan not respected',

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
