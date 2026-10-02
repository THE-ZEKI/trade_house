'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Link as LinkIcon, Ban, Loader2, AlertCircle } from 'lucide-react';

/**
 * Actions de gestion d'une reunion : annuler, deplacer, changer le lien.
 *
 * Les trois boutons n'apparaissent pas pour tout le monde, et c'est volontaire :
 * `app.cancel_meeting` et `app.reschedule_meeting` n'autorisent que
 * l'administrateur et le CREATEUR de la reunion. Un manager qui n'a pas cree la
 * reunion ne doit donc pas voir le bouton — il serait refuse a tous les coups.
 * C'est le meme ecart que pour « Inviter » : la matrice dit ce qui est
 * possible, la base dit ce qui est reel.
 */
export default function MeetingActions({
  meetingId,
  canManage,
  currentLink,
  defaultStart,
  defaultDuration,
}: {
  meetingId: string;
  canManage: boolean;
  currentLink: string | null;
  defaultStart: string;
  defaultDuration: number;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<'none' | 'cancel' | 'reschedule' | 'link'>('none');
  const [reason, setReason] = useState('');
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [url, setUrl] = useState(currentLink ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, body: unknown, ok: () => void) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        setError(data?.error?.message ?? 'Operation refusee');
        return;
      }
      ok();
      router.refresh();
    } catch {
      setError('Serveur injoignable');
    } finally {
      setBusy(false);
    }
  }

  const btn =
    'inline-flex h-10 items-center gap-1.5 rounded-[10px] border px-3 text-sm font-semibold disabled:opacity-50';
  const field =
    'h-10 rounded-[10px] border border-border-strong bg-white px-3 text-sm outline-none focus:border-sky-400';

  if (!canManage) return null;

  return (
    <div className="rounded-[10px] border border-border bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setPanel(panel === 'reschedule' ? 'none' : 'reschedule')}
          className={`${btn} border-border-strong text-sky-700 hover:bg-sky-50`}
        >
          <CalendarClock className="h-4 w-4" strokeWidth={2.2} /> Deplacer
        </button>
        <button
          type="button"
          onClick={() => setPanel(panel === 'link' ? 'none' : 'link')}
          className={`${btn} border-border-strong text-sky-700 hover:bg-sky-50`}
        >
          <LinkIcon className="h-4 w-4" strokeWidth={2.2} /> Changer le lien
        </button>
        <button
          type="button"
          onClick={() => setPanel(panel === 'cancel' ? 'none' : 'cancel')}
          className={`${btn} border-danger-bd bg-danger-bg text-danger-fg hover:brightness-97`}
        >
          <Ban className="h-4 w-4" strokeWidth={2.2} /> Annuler
        </button>
      </div>

      {error && (
        <p className="mt-2 flex items-center gap-2 text-xs text-danger-fg">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          {error}
        </p>
      )}

      {panel === 'reschedule' && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-[10px] bg-surface-alt px-3 py-3">
          <label className="grid gap-1 text-xs text-text-muted">
            Nouvelle date
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className={field}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              call(
                `/api/meetings/${meetingId}/actions`,
                {
                  action: 'reschedule',
                  startsAt: new Date(startsAt).toISOString(),
                  durationMin: defaultDuration,
                },
                () => setPanel('none'),
              )
            }
            className={`${btn} border-sky-500 bg-sky-500 text-white hover:bg-sky-600`}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Deplacer
          </button>
          <p className="text-xs text-text-faint">
            La duree est conservee ({defaultDuration} min). La base regenere invitations et rappels.
          </p>
        </div>
      )}

      {panel === 'link' && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-[10px] bg-surface-alt px-3 py-3">
          <label className="grid min-w-0 flex-1 gap-1 text-xs text-text-muted">
            Lien de la reunion (https obligatoire)
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className={field}
            />
          </label>
          <button
            type="button"
            disabled={busy || !url.startsWith('https://')}
            onClick={() =>
              call(`/api/meetings/${meetingId}/link`, { url, provider: 'other' }, () => setPanel('none'))
            }
            className={`${btn} border-sky-500 bg-sky-500 text-white hover:bg-sky-600`}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Enregistrer
          </button>
        </div>
      )}

      {panel === 'cancel' && (
        <div className="mt-3 grid gap-2 rounded-[10px] bg-surface-alt px-3 py-3">
          <label className="grid gap-1 text-xs text-text-muted">
            Motif de l annulation (obligatoire — il sera communique aux participants)
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex. : reunion reportee"
              className={field}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || !reason.trim()}
              onClick={() =>
                call(`/api/meetings/${meetingId}/actions`, { action: 'cancel', reason }, () => setPanel('none'))
              }
              className={`${btn} border-danger-bd bg-danger-bg text-danger-fg`}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Confirmer l annulation
            </button>
            <span className="text-xs text-text-faint">
              Les rappels en attente sont annules et le motif est journalise.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}