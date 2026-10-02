import { asUser, callApp, callAppSet } from '@/lib/db';
import { jsonOk } from '@/lib/http';
import { sendEmail, appUrl } from '@/lib/email';
import { reminderEmail } from '@/lib/email-templates';
import { notificationEmail } from '@/lib/email-notifications';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/send-reminders
 *
 * Job executes chaque minute (cron Vercel / GitHub Actions / t scheduler).
 *
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Deroulement (B4, B5, RG-13, RG-15, RG-16) :
 *   1. app.claim_due_reminders() reserve atomiquement les rappels dus
 *      (FOR UPDATE SKIP LOCKED : deux executions ne traitent jamais le meme) ;
 *   2. app.prepare_reminder() cree une ligne par destinataire eligible et
 *      resout le lien a l'instant de l'envoi (lien ponctuel sinon principal) ;
 *   3. envoi des e-mails, puis mark_notification_sent / mark_notification_failed
 *      (qui planifie les 3 relances a 10 minutes de RG-16) ;
 *   4. app.complete_reminder() deduit le statut du rappel.
 */
export async function POST(request: Request) {
  return run(request);
}

/**
 * GET — Vercel Cron appelle toujours en GET et ajoute automatiquement
 * l'en-tete `Authorization: Bearer $CRON_SECRET` si la variable
 * CRON_SECRET est definie dans l'environnement du projet.
 * Supporter les deux methodes evite une mauvaise surprise au deploiement.
 */
export async function GET(request: Request) {
  return run(request);
}

async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';

  // En production, le secret est obligatoire. En developpement, il peut
  // manquer pour faciliter l'appel manuel depuis un terminal.
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return jsonOk({ error: 'CRON_SECRET non configure' }, 500);
    }
  } else if (provided !== secret) {
    return jsonOk({ error: 'Non autorise' }, 401);
  }

  // Un job interrompu laisse des rappels en « sending » : on les remet en file
  // avant toute nouvelle reservation (013_reminders.sql).
  const reclaimed = await asUser(null, (sql) =>
    callApp<number>(sql, 'app.reclaim_stuck_reminders', [5]),
  );

  const claimed = await asUser(null, (sql) =>
    callAppSet<{ id: string; kind: string }>(sql, 'app.claim_due_reminders', [100]),
  );

  const report = {
    reclaimed: reclaimed ?? 0,
    claimed: claimed.length,
    prepared: 0,
    sent: 0,
    failed: 0,
    retried: 0,
    // File des notifications metier (migration 031) : `copied` = notifications
    // in-app dupliquees en email, `claimed_email` = lignes reservees au job.
    copied: 0,
    claimed_email: 0,
  };

  for (const reminder of claimed) {
    // 1. la base cree une ligne par destinataire eligible (RG-15) et resout le
    //    lien a l'instant de l'envoi (lien ponctuel sinon principal, RG-13).
    await asUser(null, (sql) => callApp(sql, 'app.prepare_reminder', [reminder.id]));

    // 2. lecture des destinataires via une fonction SECURITY DEFINER : le cron
    //    n'est pas un utilisateur connecte, il n'a donc aucun contexte RLS.
    const pending = await asUser(null, (sql) =>
      callAppSet<{
        notification_id: string;
        email: string;
        title: string;
        starts_at: string;
        payload: Record<string, unknown>;
        attempts: number;
      }>(sql, 'app.pending_reminder_targets', [reminder.id]),
    );
    report.prepared += pending.length;

    for (const target of pending) {
      const payload = target.payload ?? {};
      const locale = typeof payload.locale === 'string' ? payload.locale : null;
      const linkUrl = typeof payload.link_url === 'string' ? payload.link_url : null;

      try {
        const result = await sendEmail(
          reminderEmail({
            email: target.email,
            title: target.title,
            startsAt: target.starts_at,
            link: linkUrl,
            locale,
          }),
        );
        await asUser(null, (sql) =>
          callApp(sql, 'app.mark_notification_sent', [
            target.notification_id,
            result.delivered ? null : { provider: result.provider, simulated: true },
          ]),
        );
        report.sent += 1;
      } catch (error) {
        const state = await asUser(null, (sql) =>
          callApp<string>(sql, 'app.mark_notification_failed', [
            target.notification_id,
            error instanceof Error ? error.message.slice(0, 500) : 'erreur inconnue',
          ]),
        );
        if (state === 'pending') report.retried += 1;
        else report.failed += 1;
      }
    }

    await asUser(null, (sql) => callApp(sql, 'app.complete_reminder', [reminder.id]));
  }

  // --- 2. Notifications metier par email ----------------------------------
  //
  // File distincte de celle des rappels (migration 031) : un evenement comme
  // « ton exercice est corrige » part immediatement et une fois, sans occurrence
  // ni relance a 10 minutes. Les deux files ne peuvent pas partager un seul
  // mecanisme sans un cas particulier a chaque etape.
  const copied = await asUser(null, (sql) => callApp<number>(sql, 'app.create_email_copies', [200]));
  report.copied += copied ?? 0;

  const due = await asUser(null, (sql) =>
    callAppSet<{
      notification_id: string;
      email: string;
      locale: string | null;
      event: string;
      related_type: string | null;
      related_id: string | null;
      payload: Record<string, unknown>;
      attempts: number;
    }>(sql, 'app.claim_pending_emails', [200]),
  );
  report.claimed_email += due.length;

  for (const target of due) {
    try {
      // Le contexte est resolu en base : le RLS de public.users cache le
      // manager a son propre trader, le job n'a donc pas le droit de refaire
      // la jointure lui-meme.
      const ctx = await asUser(null, (sql) =>
        callApp<Record<string, unknown>>(sql, 'app.fn_notification_context', [
          target.related_type,
          target.related_id,
        ]),
      );

      const result = await sendEmail(
        notificationEmail({
          email: target.email,
          event: target.event,
          context: ctx ?? {},
          link: `${appUrl()}/notifications`,
          locale: target.locale,
        }),
      );

      await asUser(null, (sql) =>
        callApp(sql, 'app.mark_notification_sent', [
          target.notification_id,
          result.delivered ? null : { provider: result.provider, simulated: true },
        ]),
      );
      report.sent += 1;
    } catch (error) {
      // mark_notification_failed replanifie la relance (RG-16) et s arrete au
      // bout de 3 echecs en passant le statut a 'failed' : c'est lui, pas le
      // job, qui compte les tentatives.
      const state = await asUser(null, (sql) =>
        callApp<string>(sql, 'app.mark_notification_failed', [
          target.notification_id,
          error instanceof Error ? error.message.slice(0, 500) : 'erreur inconnue',
        ]),
      );
      if (state === 'pending') report.retried += 1;
      else report.failed += 1;
    }
  }

  return jsonOk({ status: 'ok', ...report });
}
