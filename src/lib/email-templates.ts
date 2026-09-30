/**
 * Modèles d'e-mails.
 *
 * Un modèle = un sujet + un texte par langue (RG-53). Les clés viennent des
 * énumérations PostgreSQL, les libellés sont traduits ici.
 * La phase 2 remplacera l'envoi « log » par un vrai fournisseur.
 */

import type { EmailMessage } from './email';

type Lang = 'fr' | 'en';

const copy = {
  fr: {
    invitationSubject: 'Votre accès à Trade House',
    invitationBody: (name: string, link: string) =>
      `Bonjour ${name},\n\nVotre compte Trade House est créé.\nDéfinissez votre mot de passe : ${link}\n\nCe lien expire dans 7 jours.`,
    reminderSubject: 'Rappel de réunion',
    reminderBody: (title: string, start: string, link: string | null) =>
      `Une réunion est prévue : ${title}\nDébut : ${start}\n\n${link ? `Rejoindre la réunion : ${link}` : 'Le lien de la salle sera disponible à l\'heure de la réunion.'}\n\nPour confirmer votre présence, connectez-vous à Trade House.`,
    meetingSubject: 'Nouvelle réunion',
    meetingBody: (title: string, start: string) =>
      `Vous êtes invité à la réunion « ${title} ».\nDébut : ${start}\n\nConnectez-vous pour accepter ou refuser.`,
    meetingUpdated: 'Réunion modifiée',
    meetingUpdatedBody: (title: string, start: string) =>
      `La réunion « ${title} » a été déplacée.\nNouvelle date : ${start}`,
    meetingCancelled: 'Réunion annulée',
    meetingCancelledBody: (title: string) => `La réunion « ${title} » est annulée.`,
  },
  en: {
    invitationSubject: 'Your Trade House access',
    invitationBody: (name: string, link: string) =>
      `Hello ${name},\n\nYour Trade House account has been created.\nSet your password: ${link}\n\nThis link expires in 7 days.`,
    reminderSubject: 'Meeting reminder',
    reminderBody: (title: string, start: string, link: string | null) =>
      `A meeting is scheduled: ${title}\nStarts at: ${start}\n\n${link ? `Join the meeting: ${link}` : 'The room link will be available when the meeting starts.'}\n\nPlease RSVP from Trade House.`,
    meetingSubject: 'New meeting',
    meetingBody: (title: string, start: string) =>
      `You have been invited to "${title}".\nStarts at: ${start}\n\nSign in to accept or decline.`,
    meetingUpdated: 'Meeting rescheduled',
    meetingUpdatedBody: (title: string, start: string) =>
      `The meeting "${title}" has been moved.\nNew date: ${start}`,
    meetingCancelled: 'Meeting cancelled',
    meetingCancelledBody: (title: string) => `The meeting "${title}" has been cancelled.`,
  },
} satisfies Record<Lang, Record<string, unknown>>;

export function lang(locale?: string | null): Lang {
  return locale?.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

export function formatDate(iso: string, l: Lang = 'fr'): string {
  return new Intl.DateTimeFormat(l === 'en' ? 'en-GB' : 'fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

export function invitationEmail(name: string, email: string, link: string, l: Lang): EmailMessage {
  return {
    to: email,
    subject: copy[l].invitationSubject,
    text: copy[l].invitationBody(name, link),
  };
}

export function reminderEmail(params: {
  email: string;
  title: string;
  startsAt: string;
  link: string | null;
  locale?: string | null;
}): EmailMessage {
  const l = lang(params.locale);
  return {
    to: params.email,
    subject: `${copy[l].reminderSubject} — ${params.title}`,
    text: copy[l].reminderBody(params.title, formatDate(params.startsAt, l), params.link),
  };
}

export function meetingCreatedEmail(params: {
  email: string;
  title: string;
  startsAt: string;
  locale?: string | null;
}): EmailMessage {
  const l = lang(params.locale);
  return {
    to: params.email,
    subject: `${copy[l].meetingSubject} — ${params.title}`,
    text: copy[l].meetingBody(params.title, formatDate(params.startsAt, l)),
  };
}
