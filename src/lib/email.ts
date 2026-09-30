/**
 * Envoi d'emails — trois fournisseurs, une seule interface.
 *
 *   log     developpement : ecrit le message dans la sortie du serveur
 *   resend  API HTTP (defaut recommande sur Vercel : pas de socket persistante,
 *           webhooks de bounce, cle revocable)
 *   smtp    protocole standard (RFC 5321) via nodemailer — le bon choix si
 *           Postfix est auto-heberge ou si l'hebergeur fournit un SMTP
 *
 * Le choix se fait par la variable EMAIL_PROVIDER ; AUCUNE logique metier ne
 * change selon le fournisseur.
 *
 * REGLE DE SECURITE : les jetons (invitation, reinitialisation) ne quittent
 * JAMAIS la reponse API en production. Seul le fournisseur « log » les renvoie,
 * pour permettre les tests en developpement.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailResult = {
  /** true = accepte par le fournisseur (pas forcément arrivé à destination) */
  delivered: boolean;
  provider: string;
  messageId?: string;
  error?: string;
};

const provider = () => process.env.EMAIL_PROVIDER ?? 'log';
const isDev = () => process.env.NODE_ENV !== 'production' && provider() === 'log';

// --- SMTP -----------------------------------------------------------------
// Le transporteur est cree une fois puis reutilise : ouvrir une connexion
// TLS + AUTH a chaque envoi est lent et fait tomber les limites de temps des
// fonctions serverless.
let smtpTransport: Promise<import('nodemailer').Transporter> | null = null;

async function smtp() {
  if (!smtpTransport) {
    smtpTransport = (async () => {
      const nodemailer = (await import('nodemailer')).default;
      const port = Number.parseInt(process.env.SMTP_PORT ?? '587', 10);
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number.isFinite(port) ? port : 587,
        // 465 = TLS direct, 587 = STARTTLS
        secure: (process.env.SMTP_SECURE ?? String(port === 465)) === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? '' }
          : undefined,
        // tolerance de 10 s : au-dela, mieux vaut echouer vite et laisser
        // RG-16 planifier une relance que bloquer la requete
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
    })();
  }
  return smtpTransport;
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const name = provider();
  const from = process.env.EMAIL_FROM ?? 'Trade House <no-reply@trade-house.local>';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  if (name === 'log') {
    console.info(
      `[email:log] a=${message.to} objet="${message.subject}"\n${message.text}\nurl=${appUrl}`,
    );
    return { delivered: false, provider: name };
  }

  if (name === 'resend') {
    if (!process.env.RESEND_API_KEY) {
      console.warn('[email] RESEND_API_KEY absent, message non envoye');
      return { delivered: false, provider: name, error: 'RESEND_API_KEY absent' };
    }
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (!response.ok) {
        return { delivered: false, provider: name, error: `HTTP ${response.status}` };
      }
      const body = (await response.json()) as { id?: string };
      return { delivered: true, provider: name, messageId: body.id };
    } catch (error) {
      return {
        delivered: false,
        provider: name,
        error: error instanceof Error ? error.message : 'erreur reseau',
      };
    }
  }

  if (name === 'smtp') {
    if (!process.env.SMTP_HOST) {
      console.warn('[email] SMTP_HOST absent, message non envoye');
      return { delivered: false, provider: name, error: 'SMTP_HOST absent' };
    }
    try {
      const transporter = await smtp();
      const info = await transporter.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        // un Message-ID stable facilite le suivi des bounces
        messageId: `<${Date.now()}.${Math.random().toString(36).slice(2)}@trade-house.local>`,
      });
      return { delivered: true, provider: name, messageId: info.messageId };
    } catch (error) {
      // L'erreur remonte au job cron, qui la journalise puis planifie la
      // relance RG-16 : un SMTP indisponible ne doit pas faire perdre l'email.
      return {
        delivered: false,
        provider: name,
        error: error instanceof Error ? error.message : 'erreur SMTP',
      };
    }
  }

  console.warn(`[email] fournisseur « ${name} » inconnu, message non envoye`);
  return { delivered: false, provider: name, error: 'fournisseur inconnu' };
}

/** Ferme la connexion SMTP (utile en fin de script de test). */
export async function closeEmailTransport(): Promise<void> {
  if (!smtpTransport) return;
  const transporter = await smtpTransport;
  transporter.close();
  smtpTransport = null;
}

/** Un jeton ne peut etre renvoye au client qu'en developpement. */
export function mayExposeToken(): boolean {
  return isDev();
}

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

