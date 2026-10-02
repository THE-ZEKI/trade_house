/**
 * Modeles d'emails de notification metier (formation, comptes, corrections).
 *
 * Un seul modele generique : ces messages ont tous la meme forme — une phrase
 * qui dit ce qui s est passe, un lien vers l ecran concerne. Un modele par
 * evenement donnerait dix variantes d un meme texte.
 *
 * LE CONTENU DU MESSAGE NE VIENT PAS D ICI. Le corps d un message prive
 * n apparait JAMAIS dans un email : un courriel arrive dans une boite partagee
 * ou sur un telephone, et y ecrire ce qu un trader a dit a son manager, c est
 * le meilleur moyen de rompre la confidentialite qu on pretendait preserver.
 * Pour une messagerie on ecrira donc « vous avez un nouveau message » et on
 * renverra vers l application, ou la session est verifiee.
 */

import type { EmailMessage } from './email';

type Lang = 'fr' | 'en';
type Ctx = Record<string, unknown>;

const lang = (locale?: string | null): Lang =>
  locale?.toLowerCase().startsWith('en') ? 'en' : 'fr';

const str = (c: Ctx, k: string): string => {
  const v = c[k];
  return v === null || v === undefined ? '' : String(v);
};

type Copy = { subject: string; body: (c: Ctx) => string };

/** Sujets et phrase d'ouverture, par evenement et par langue. */
const COPY: Record<Lang, Record<string, Copy>> = {
  fr: {
    training_assigned: {
      subject: 'Un cours vous a ete attribue',
      body: (c) => {
        const t = c.course_title ? `« ${str(c, 'course_title')} »` : 'un cours';
        const d = c.due_at
          ? ` Il est a rendre le ${new Date(str(c, 'due_at')).toLocaleDateString('fr-FR')}.`
          : '';
        return `Votre manager vous a attribue ${t}.${d}`;
      },
    },
    training_exercise_reviewed: {
      subject: 'Votre exercice a ete corrige',
      body: (c) => {
        const quoi = c.exercise_title ? `« ${str(c, 'exercise_title')} »` : 'un exercice';
        const n = c.score !== null && c.score !== undefined ? ` Note obtenue : ${str(c, 'score')}/20.` : '';
        return `${c.reviewer_name ? str(c, 'reviewer_name') : 'Votre manager'} a corrige ${quoi}.${n}`;
      },
    },
    training_exercise_submitted: {
      subject: 'Un exercice a ete rendu',
      body: (c) => {
        const quoi = c.exercise_title ? `« ${str(c, 'exercise_title')} »` : 'un exercice';
        return `${c.trader_name ? str(c, 'trader_name') : 'Un trader'} a rendu ${quoi}.`;
      },
    },
    training_completed: {
      subject: 'Parcours de formation termine',
      body: (c) => `${c.trader_name ? str(c, 'trader_name') : 'Un trader'} a termine son parcours.`,
    },
    correction_requested: {
      subject: 'Des corrections sont demandees',
      body: (c) => {
        const d = c.session_date
          ? ` (session du ${new Date(str(c, 'session_date')).toLocaleDateString('fr-FR')})`
          : '';
        return `Votre manager demande des corrections sur votre rapport${d}.`;
      },
    },
    report_validated: { subject: 'Votre rapport est valide', body: () => 'Votre rapport a ete valide par votre manager.' },
    report_dismissed: { subject: 'Rapport ecarte', body: () => 'Votre rapport a ete ecarte de la revision.' },
    account_invited: { subject: 'Une invitation vous est adressee', body: () => 'Un compte vous a ete cree.' },
    account_disabled: {
      subject: 'Votre compte a ete desactive',
      body: () => 'Votre compte a ete desactive. Contactez votre administrateur si cela vous surprend.',
    },
    account_reactivated: { subject: 'Votre compte a ete reactive', body: () => 'Votre compte a ete reactive.' },
    meeting_created: { subject: 'Nouvelle reunion', body: (c) => `Vous etes invite a la reunion « ${str(c, 'title')} ».` },
    meeting_updated: { subject: 'Reunion modifiee', body: (c) => `La reunion « ${str(c, 'title')} » a ete deplacee.` },
    meeting_cancelled: { subject: 'Reunion annulee', body: (c) => `La reunion « ${str(c, 'title')} » est annulee.` },
  },
  en: {
    training_assigned: {
      subject: 'A course was assigned to you',
      body: (c) => `Your manager assigned you ${c.course_title ? `"${str(c, 'course_title')}"` : 'a course'}.`,
    },
    training_exercise_reviewed: {
      subject: 'Your exercise was reviewed',
      body: (c) =>
        `${c.reviewer_name ? str(c, 'reviewer_name') : 'Your manager'} reviewed ${c.exercise_title ? `"${str(c, 'exercise_title')}"` : 'your exercise'}.`,
    },
    training_exercise_submitted: {
      subject: 'An exercise was submitted',
      body: (c) => `${c.trader_name ? str(c, 'trader_name') : 'A trader'} submitted an exercise.`,
    },
    training_completed: {
      subject: 'Training completed',
      body: (c) => `${c.trader_name ? str(c, 'trader_name') : 'A trader'} completed the course.`,
    },
    correction_requested: { subject: 'Corrections requested', body: () => 'Your manager requested corrections on your report.' },
    report_validated: { subject: 'Your report is approved', body: () => 'Your report was approved by your manager.' },
    report_dismissed: { subject: 'Report dismissed', body: () => 'Your report was dismissed.' },
    account_invited: { subject: 'An invitation was sent to you', body: () => 'An account was created for you.' },
    account_disabled: { subject: 'Your account was disabled', body: () => 'Your account was disabled.' },
    account_reactivated: { subject: 'Your account was reactivated', body: () => 'Your account was reactivated.' },
    meeting_created: { subject: 'New meeting', body: (c) => `You are invited to "${str(c, 'title')}".` },
    meeting_updated: { subject: 'Meeting moved', body: (c) => `"${str(c, 'title')}" was rescheduled.` },
    meeting_cancelled: { subject: 'Meeting cancelled', body: (c) => `"${str(c, 'title')}" was cancelled.` },
  },
};

/**
 * Compose le message d un evenement metier.
 *
 * Un evenement inconnu ne leve pas d exception : il produit un message neutre.
 * Un cron qui planterait sur une traduction manquante n enverrait plus AUCUN
 * courriel, et une panne de contenu deviendrait une panne du systeme
 * d alerte lui-meme. Le lien vers l application porte toujours l information :
 * le courriel ne sert qu a dire « va voir ».
 */
export function notificationEmail(params: {
  email: string;
  event: string;
  context?: Ctx;
  link?: string | null;
  locale?: string | null;
}): EmailMessage {
  const l = lang(params.locale);
  const ctx = params.context ?? {};
  const entry = COPY[l]?.[params.event];

  const subject = entry?.subject ?? 'Notification Trade House';
  const phrase = entry ? entry.body(ctx) : 'Vous avez une nouvelle notification.';
  const link = params.link ?? null;

  return {
    to: params.email,
    subject,
    text:
      l === 'en'
        ? `Hello,\n\n${phrase}\n\n${link ? `Open: ${link}` : 'Sign in to Trade House to read it.'}`
        : `Bonjour,\n\n${phrase}\n\n${link ? `Ouvrir : ${link}` : 'Connectez-vous a Trade House pour en prendre connaissance.'}`,
  };
}
