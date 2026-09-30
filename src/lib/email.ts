/**
 * Envoi d'emails.
 *
 * En developpement le fournisseur « log » ecrit le message dans la sortie du
 * serveur et renvoie le lien : aucun email reel n'est envoye. Le passage a un
 * vrai fournisseur (Resend) est prevu en phase 2, l'interface ne change pas.
 *
 * REGLE DE SECURITE : en developpement, les jetons (invitation, reinitialisation)
 * sont renvoyes dans la reponse API pour permettre les tests. En production
 * (EMAIL_PROVIDER != log), ils ne quittent JAMAIS la reponse.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailResult = {
  delivered: boolean;
  provider: string;
  /** Renseigne uniquement en developpement : lien d'action cliquable. */
  previewToken?: string;
};

const isDev = process.env.NODE_ENV !== 'production' && process.env.EMAIL_PROVIDER !== 'resend';

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const provider = process.env.EMAIL_PROVIDER ?? 'log';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  if (provider === 'log') {
    console.info(
      `[email:log] a=${message.to} objet="${message.subject}"\n${message.text}\nurl=${appUrl}`,
    );
    return { delivered: false, provider };
  }

  if (provider === 'resend' && process.env.RESEND_API_KEY) {
    // Phase 2 : appel reel a l'API Resend
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Trade House <no-reply@trade-house.local>',
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    return { delivered: response.ok, provider };
  }

  // Fournisseur inconnu : on ne pretend pas avoir envoye
  console.warn(`[email] fournisseur « ${provider} » non configure, message non envoye`);
  return { delivered: false, provider };
}

/** Un jeton ne peut etre renvoye au client qu'en developpement. */
export function mayExposeToken(): boolean {
  return isDev && (process.env.EMAIL_PROVIDER ?? 'log') === 'log';
}

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}
