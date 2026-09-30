import {
  Pencil, Send, Eye, MessageSquareWarning, RefreshCw, CheckCircle2, XCircle, Moon,
  Clock, Check, HelpCircle, Calendar, Ban, Building2, Globe, Zap,
  Mail, CalendarClock, Timer, Sliders, Hand, MailOpen, Bell, Loader2, AlertTriangle,
  UserCheck, UserX,
  OctagonAlert, Lightbulb, FileText, TextCursorInput, Image as ImageIcon, Paperclip,
  TrendingUp, TrendingDown, Minus,
  Flame, ClockAlert, TriangleAlert, Radio, ShieldCheck, ShieldOff, Video,
  CircleCheck, Hourglass, Swords, MoreHorizontal, Leaf, History,
} from 'lucide-react';
import type { ComponentType } from 'react';

/**
 * Table code -> presentation (regle 0.1 du design system).
 *
 * LE point central du systeme. La base stocke `correction_requested` ; rien
 * d'autre n'existe en base ni dans les exports PDF. Toute la traduction
 * icone/teinte/libelle passe par ici. Un nouveau statut exige une ligne de ce
 * fichier, et c'est voulu : si le code est inconnu, il s'affiche tel quel avec
 * une teinte neutre, ce qui rend le manque visible au lieu de le masquer.
 *
 * La couleur n'est jamais seule : chaque entree porte une icone, et le libelle
 * est rendu a cote (regle 0.2). En niveaux de gris, l'information reste
 * entiere.
 */

export type Tone = 'neutral' | 'info' | 'success' | 'warn' | 'danger' | 'accent';

type Spec = { icon: ComponentType<{ className?: string; strokeWidth?: number }> };

/**
 * Table code -> presentation.
 *
 * `tone: Tone` est explicite : sans lui, TypeScript elargit chaque litteral en
 * `string` et refuse l'affectation. C'est un detail de typage, pas de style —
 * il evite surtout d'ajouter un statut avec une teinte inexistante.
 */
export type Entry = Spec & { tone: Tone };
export type Table = Record<string, Entry>;

const FALLBACK: Tone = 'neutral';

/** Teintes : fond / texte / bordure, depuis DESIGN_SYSTEM §1. */
export const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-neutral-bg text-neutral-fg border-neutral-bd',
  info: 'bg-info-bg text-info-fg border-info-bd',
  success: 'bg-success-bg text-success-fg border-success-bd',
  warn: 'bg-warn-bg text-warn-fg border-warn-bd',
  danger: 'bg-danger-bg text-danger-fg border-danger-bd',
  accent: 'bg-accent-bg text-accent-fg border-accent-bd',
};

/** Statuts de rapport (DESIGN_SYSTEM §3). */
export const REPORT_STATUS: Table = {
  draft: { icon: Pencil, tone: 'neutral' },
  submitted: { icon: Send, tone: 'info' },
  in_review: { icon: Eye, tone: 'info' },
  correction_requested: { icon: MessageSquareWarning, tone: 'warn' },
  resubmitted: { icon: RefreshCw, tone: 'info' },
  validated: { icon: CheckCircle2, tone: 'success' },
  dismissed: { icon: XCircle, tone: 'danger' },
  // « pas de trading » est une declaration legitime : jamais en rouge.
  declared: { icon: Moon, tone: 'neutral' },
};

/** Reponses de presence en reunion. */
export const RSVP: Table = {
  pending: { icon: Clock, tone: 'neutral' },
  accepted: { icon: Check, tone: 'success' },
  declined: { icon: XCircle, tone: 'danger' },
  maybe: { icon: HelpCircle, tone: 'neutral' },
};

/** Statut d'une reunion. `live` est en accent : il doit ressortir du lot. */
export const MEETING_STATUS: Table = {
  scheduled: { icon: Calendar, tone: 'info' },
  live: { icon: Radio, tone: 'accent' },
  ended: { icon: Check, tone: 'neutral' },
  cancelled: { icon: Ban, tone: 'danger' },
};

/** Nature d'une reunion : chips neutres, c'est du contexte. */

/** Nature d'un rappel. */
export const REMINDER_KIND: Table = {
  invitation: { icon: Mail, tone: 'neutral' },
  d_minus_1: { icon: CalendarClock, tone: 'neutral' },
  h_minus_1: { icon: Timer, tone: 'neutral' },
  custom: { icon: Sliders, tone: 'neutral' },
  manual: { icon: Hand, tone: 'neutral' },
};

/** Etat d'un rappel ou d'une notification : memes valeurs, table commune. */
export const NOTIFY_STATUS: Table = {
  pending: { icon: Clock, tone: 'neutral' },
  sending: { icon: Loader2, tone: 'info' },
  sent: { icon: MailOpen, tone: 'success' },
  failed: { icon: AlertTriangle, tone: 'danger' },
  opened: { icon: MailOpen, tone: 'success' },
  cancelled: { icon: Ban, tone: 'neutral' },
};

/** Presence calculee : present / absent / en retard. */
export const ATTENDANCE: Table = {
  present: { icon: UserCheck, tone: 'success' },
  absent: { icon: UserX, tone: 'danger' },
  late: { icon: ClockAlert, tone: 'warn' },
};

/** Gravite d'un correctif : bloquant, ou simple conseil. */
export const SEVERITY: Table = {
  mandatory: { icon: OctagonAlert, tone: 'danger' },
  suggestion: { icon: Lightbulb, tone: 'info' },
};

/** Cible d'un correctif. */
export const CORRECTION_TARGET: Table = {
  general: { icon: FileText, tone: 'neutral' },
  field: { icon: TextCursorInput, tone: 'neutral' },
  file: { icon: ImageIcon, tone: 'neutral' },
};

/** Etat d'un correctif. */
export const CORRECTION_STATUS: Table = {
  open: { icon: ClockAlert, tone: 'warn' },
  done: { icon: CircleCheck, tone: 'success' },
  rejected: { icon: XCircle, tone: 'danger' },
  dropped: { icon: Minus, tone: 'neutral' },
};

/** Type de piece jointe. */
export const FILE_KIND: Table = {
  screenshot: { icon: ImageIcon, tone: 'neutral' },
  pdf: { icon: FileText, tone: 'neutral' },
  correction_attachment: { icon: Paperclip, tone: 'neutral' },
};

/** Resultat d'une session : le signe porte le sens, la couleur le confirme. */
export const RESULT_TYPE: Table = {
  gain: { icon: TrendingUp, tone: 'success' },
  loss: { icon: TrendingDown, tone: 'danger' },
  breakeven: { icon: Minus, tone: 'neutral' },
};

/**
 * Emotions du trader : liste fermee de 7 valeurs.
 *
 * Volontairement des icones et non des couleurs seules — un etat psychique
 * ne doit pas etre juge par une teinte, et la personne qui le declare est
 * precisement la plus mal placee pour l'evaluer.
 */
export const EMOTION: Table = {
  calm: { icon: Leaf, tone: 'success' },
  confident: { icon: ShieldCheck, tone: 'info' },
  fomo: { icon: Flame, tone: 'warn' },
  impatience: { icon: Hourglass, tone: 'warn' },
  stress: { icon: Zap, tone: 'danger' },
  revenge: { icon: Swords, tone: 'danger' },
  other: { icon: MoreHorizontal, tone: 'neutral' },
};

/** Presence du 2FA sur un compte. */
export const MFA: Table = {
  enrolled: { icon: ShieldCheck, tone: 'success' },
  not_enrolled: { icon: ShieldOff, tone: 'neutral' },
};

/** Canal de notification. */
export const CHANNEL: Table = {
  email: { icon: Mail, tone: 'neutral' },
  in_app: { icon: Bell, tone: 'neutral' },
};

/**
 * Resout un code vers sa presentation.
 *
 * Un code inconnu ne leve pas : il retombe sur une presentation neutre et le
 * code reste lisible. Un statut nouveau s'affiche « tel quel » plutot que de
 * disparaitre — un manque doit se voir.
 */
export function spec(table: Table, code: unknown) {
  const key = typeof code === 'string' ? code : '';
  const found = table[key];
  const Icon = found?.icon ?? HelpCircle;
  return { Icon, tone: found?.tone ?? FALLBACK, known: Boolean(found) };
}

/** Badges d'alerte d'un rapport (design system §3). */
export const ALERT_FLAGS = {
  critical: { icon: Flame, tone: 'danger', labelKey: 'alert.critical' },
  late: { icon: ClockAlert, tone: 'warn', labelKey: 'alert.late' },
  stale: { icon: History, tone: 'neutral', labelKey: 'alert.stale' },
} as const;

/** Plan respecte ou non : le libelle reste toujours visible. */
export const PLAN = {
  yes: { icon: Check, tone: 'success', labelKey: 'plan.respected' },
  no: { icon: TriangleAlert, tone: 'warn', labelKey: 'plan.not_respected' },
} as const;

export const MEETING_TYPE: Table = {
  internal: { icon: Building2, tone: 'neutral' },
  external: { icon: Globe, tone: 'neutral' },
  instant: { icon: Zap, tone: 'neutral' },
};

/** Fournisseur du lien de reunion. */
export const LINK_PROVIDER: Table = {
  zoom: { icon: Video, tone: 'neutral' },
  meet: { icon: Video, tone: 'neutral' },
  teams: { icon: Video, tone: 'neutral' },
  other: { icon: Video, tone: 'neutral' },
  internal: { icon: Video, tone: 'neutral' },
};
