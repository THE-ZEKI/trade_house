import type { SessionUser } from './auth';

/**
 * Matrice des droits (regles de gestion → interface).
 *
 * CE FICHIER EST LA SOURCE DE VERITE POUR L'AFFICHAGE DES BOUTONS.
 *
 * Il ne decide rien : il dit seulement quels boutons rendre. Toutes les regles
 * restent en base, dans les fonctions `app.*`. Un bouton affiche puis refuse
 * en base est un defaut d'interface ; un bouton absent quand il aurait pu
 * servir est un defaut de couverture. Ce fichier traite le second, la base
 * traite le premier.
 *
 * Regle de conception : un droit manquant doit se voir. `can()` renvoie
 * `false` sans hesiter, et les composants n'affichent rien plutot que d'afficher
 * un bouton qui echouerait.
 */

export type Action =
  // Rapports — le trader
  | 'report.create'
  | 'report.submit'
  | 'report.resubmit'
  | 'report.declare_no_trade'
  // Rapports — la supervision
  | 'report.start_review'
  | 'report.request_corrections'
  | 'report.add_correction'
  | 'report.validate'
  | 'report.dismiss'
  | 'report.reopen'
  | 'report.arbitrate_correction'
  // Fichiers et annotations
  | 'report.upload_file'
  | 'report.annotate'
  // Réunions
  | 'meeting.create'
  | 'meeting.rsvp'
  | 'meeting.reschedule'
  | 'meeting.cancel'
  | 'meeting.send_reminder'
  | 'meeting.update_link'
  // Comptes — administration
  | 'user.invite'
  | 'trader.invite'
  | 'user.deactivate'
  | 'user.reactivate'
  | 'user.enforce_mfa'
  | 'user.reset_password'
  | 'user.revoke_sessions'
  | 'user.update'
  | 'user.anonymize'
  // Formation
  | 'training.read'
  | 'training.create_course'
  | 'training.edit_course'
  | 'training.add_exercise'
  | 'training.assign'
  | 'training.submit'
  | 'training.review'
  // Administration
  | 'audit.read'
  | 'settings.read';

const TRADER: Action[] = [
  'report.create', 'report.submit', 'report.resubmit', 'report.declare_no_trade',
  'report.upload_file',
  'meeting.rsvp',
  // Le trader LIT et REND, il n'ecrit pas le cours : la formation descend, elle
  // ne remonte pas.
  'training.read',
  'training.submit',
];

const MANAGER: Action[] = [
  'report.start_review', 'report.request_corrections', 'report.add_correction',
  'report.validate', 'report.dismiss', 'report.reopen', 'report.arbitrate_correction',
  'report.annotate', 'report.upload_file',
  'meeting.create', 'meeting.reschedule', 'meeting.cancel',
  'meeting.send_reminder', 'meeting.update_link',
  'training.read', 'training.create_course', 'training.edit_course',
  'training.add_exercise', 'training.assign', 'training.review',
  // 027 : le manager invite un trader, qui tombe sous sa couverture. Cette
  // action est STRICTEMENT differente de 'user.invite' (administration) : elle
  // ne cree qu'un role, le sien, et ne touche a aucun autre compte. Les deux
  // restent separees pour que le menu n'expose jamais au manager un bouton
  // qui reinitialiserait le mot de passe d'un tiers.
  'trader.invite',
];

/**
 * L'admin dispose de tout, y compris ce que le manager ne peut pas faire.
 *
 * Deux exceptions, deliberement absentes : l'admin ne deploie PAS de rapport a
 * la place d'un trader (le rapport est sa parole, RG-34), et il ne cree pas de
 * reunion a la place des autres sans raison metier. Le reste — comptes, 2FA,
 * audit, reglages — lui revient.
 */
const ADMIN: Action[] = [
  ...MANAGER,
  'user.invite', 'user.deactivate', 'user.reactivate', 'user.enforce_mfa',
  'user.reset_password', 'user.revoke_sessions',
  'user.update', 'user.anonymize',
  'audit.read', 'settings.read',
];

const MATRIX: Record<SessionUser['role'], ReadonlySet<Action>> = {
  trader: new Set(TRADER),
  manager: new Set(MANAGER),
  admin: new Set(ADMIN),
};

export function can(user: Pick<SessionUser, 'role'> | null, action: Action): boolean {
  if (!user) return false;
  return MATRIX[user.role].has(action);
}

/** Variante pour une liste d'actions. */
export function canAny(
  user: Pick<SessionUser, 'role'> | null,
  actions: Action[],
): boolean {
  return actions.some((a) => can(user, a));
}

/**
 * Transitions d'un rapport et l'action qui les declenche.
 *
 * Les conditions sont copiees de la base (`fn_report_transition`). Elles
 * servent uniquement a *desactiver* un bouton, jamais a autoriser : si la
 * matrice et cette table divergent de la base, la base gagne et l'utilisateur
 * verra un refus comprehensible plutot qu'un ecran casse.
 */
export const REPORT_ACTIONS: {
  status: string;
  action: Action;
  apiAction: string;
  labelKey: string;
  variant?: 'primary' | 'secondary' | 'danger';
  needsReason?: boolean;
  needsDeadline?: boolean;
}[] = [
  { status: 'draft', action: 'report.submit', apiAction: 'submit', labelKey: 'act.submit', variant: 'primary' },
  { status: 'correction_requested', action: 'report.resubmit', apiAction: 'resubmit', labelKey: 'act.resubmit', variant: 'primary' },
  { status: 'submitted', action: 'report.start_review', apiAction: 'start-review', labelKey: 'act.start_review', variant: 'primary' },
  { status: 'in_review', action: 'report.request_corrections', apiAction: 'request-corrections', labelKey: 'act.request_corrections', variant: 'primary', needsDeadline: true },
  { status: 'in_review', action: 'report.validate', apiAction: 'validate', labelKey: 'act.validate', variant: 'primary' },
  { status: 'in_review', action: 'report.dismiss', apiAction: 'dismiss', labelKey: 'act.dismiss', variant: 'danger', needsReason: true },
  { status: 'validated', action: 'report.reopen', apiAction: 'reopen', labelKey: 'act.reopen', variant: 'secondary', needsReason: true },
  { status: 'dismissed', action: 'report.reopen', apiAction: 'reopen', labelKey: 'act.reopen', variant: 'secondary', needsReason: true },
];

/** Actions possibles sur un rapport donne, filtrees par role ET par statut. */
export function reportActionsFor(user: SessionUser, status: string) {
  return REPORT_ACTIONS.filter((a) => a.status === status && can(user, a.action));
}
