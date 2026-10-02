'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle, Check, Save, RotateCcw } from 'lucide-react';

/**
 * Modification des reglages (DESIGN_SYSTEM §6.10).
 *
 * Les bornes NE SONT PAS codees ici : elles viennent de
 * app.settings_catalog(). Les dupliquer dans l'interface les ferait diverger
 * de la base, et c'est exactement ce que la regle « les regles vivent en base »
 * cherche a eviter. Le catalogue est donc charge avec les valeurs.
 *
 * Une modification est enregistree cle par cle : si la base refuse une valeur,
 * les autres restent enregistrees et le message dit laquelle. Tout annuler
 * parce qu'un seul champ est refuse serait penible et destructeur.
 */

type Bounds = { key: string; kind: string; lo: number; hi: number };
type Settings = Record<string, string | number | null>;

const INPUT =
  'h-11 w-full rounded-[10px] border border-border-strong bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100';

const GROUPES: { titre: string; motifs: RegExp[] }[] = [
  { titre: 'Rapports et fichiers', motifs: [/report|submission|screenshot|pdf|stale|late|retention/] },
  { titre: 'Reunions et salle', motifs: [/duration|attendance|room|video|token|arrival/] },
  { titre: 'Rappels et invitations', motifs: [/reminder|invitation|retry/] },
  { titre: 'Securite', motifs: [/login|mfa|lockout|locale/] },
];

const DICTIONNAIRE: [string, string][] = [
  ['late_submission_days', 'Jours avant qu un rapport soit considere tardif'],
  ['correction_critical_days', 'Jours au-dela desquels un correctif devient critique'],
  ['stale_submission_hours', 'Heures sans reponse avant qu un rapport soit obsolete'],
  ['max_files_per_report', 'Nombre maximum de pieces jointes par rapport'],
  ['max_screenshot_mb', 'Taille maximale d une capture (Mo)'],
  ['max_pdf_mb', 'Taille maximale d un PDF (Mo)'],
  ['retention_report_months', 'Duree de conservation des rapports (mois)'],
  ['retention_recording_months', 'Duree de conservation des enregistrements (mois)'],
  ['default_duration_min', 'Duree par defaut d une reunion (minutes)'],
  ['late_arrival_minutes', 'Tolerance avant qu un arrivant soit marque en retard'],
  ['attendance_present_ratio', 'Part de presence requise (0 a 1)'],
  ['room_open_before_minutes', 'Ouverture de la salle avant le debut'],
  ['room_close_after_minutes', 'Fermeture de la salle apres la fin'],
  ['video_room_minutes', 'Duree maximale d une salle (minutes)'],
  ['video_token_ttl_minutes', 'Validite d un jeton de salle (minutes)'],
  ['invitation_ttl_days', 'Validite d une invitation (jours)'],
  ['reminder_retry_count', 'Nombre de relances d un rappel'],
  ['reminder_retry_minutes', 'Delai entre deux relances (minutes)'],
  ['max_login_attempts', 'Tentatives de connexion avant blocage'],
  ['login_lockout_minutes', 'Duree du blocage apres trop d echecs (minutes)'],
  ['max_mfa_attempts', 'Tentatives de code 2FA avant blocage'],
  ['mfa_lockout_minutes', 'Duree du blocage 2FA (minutes)'],
  ['default_locale', 'Langue proposee par defaut'],
];

const desc = (key: string) => DICTIONNAIRE.find(([k]) => k === key)?.[1] ?? key;export default function SettingsEditor({
  settings,
  bounds,
}: {
  settings: Settings;
  bounds: Bounds[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(bounds.map((b) => [b.key, String(settings[b.key] ?? '')])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const touched = bounds.filter(
    (b) => String(settings[b.key] ?? '') !== (draft[b.key] ?? ''),
  );

  function reset() {
    setDraft(Object.fromEntries(bounds.map((b) => [b.key, String(settings[b.key] ?? '')])));
    setError(null);
    setDone(null);
  }

  async function save() {
    if (touched.length === 0) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      // Une seule cle a la fois : si la base refuse une valeur, les autres
      // restent enregistrees et le message nomme celle qui a echoue.
      let saved = 0;
      let refused = '';
      for (const b of touched) {
        const value = b.kind === 'locale' ? draft[b.key] : Number(draft[b.key]);
        const res = await fetch('/api/settings', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ [b.key]: value }),
        });
        if (res.ok) {
          saved += 1;
        } else {
          const data = await res.json().catch(() => null);
          refused = data?.error?.message ?? b.key;
        }
      }
      if (refused) {
        setError(`${refused} — ${saved} autre(s) reglage(s) enregistre(s).`);
        router.refresh();
        return;
      }
      setDone(`${saved} reglage(s) enregistre(s).`);
      router.refresh();
    } catch {
      setError('Serveur injoignable');
    } finally {
      setBusy(false);
    }
  }

  const buckets = GROUPES.map((g) => {
    const items = bounds.filter(
      (b) => g.motifs.some((m) => m.test(b.key)) && !bounds.find((x) => x.key === b.key)?.key.startsWith('__'),
    );
    return { titre: g.titre, items };
  });
  const used = new Set(buckets.flatMap((b) => b.items.map((i) => i.key)));
  const rest = bounds.filter((b) => !used.has(b.key));

  const renderRow = (b: Bounds) => {
    const isLocale = b.kind === 'locale';
    return (
      <div key={b.key} className="grid gap-2 border-b border-border px-5 py-3 last:border-b-0 md:grid-cols-[1fr_160px] md:items-center md:gap-4">
        <div className="min-w-0">
          <div className="font-mono text-xs text-text-muted">{b.key}</div>
          <div className="mt-0.5 text-sm text-text-muted">{desc(b.key)}</div>
          {!isLocale && (
            <div className="mt-0.5 text-[11px] text-text-faint">
              bornes {b.lo} a {b.hi}
              {b.kind === 'ratio' ? ' (part de presence, ex. 0.5 pour 50 %)' : ''}
            </div>
          )}
        </div>
        {isLocale ? (
          <select
            value={draft[b.key] ?? 'fr'}
            onChange={(e) => setDraft((d) => ({ ...d, [b.key]: e.target.value }))}
            className={INPUT}
          >
            <option value="fr">Francais</option>
            <option value="en">English</option>
          </select>
        ) : (
          <input
            type="number"
            inputMode="decimal"
            step={b.kind === 'ratio' ? '0.05' : '1'}
            min={b.lo}
            max={b.hi}
            value={draft[b.key] ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, [b.key]: e.target.value }))}
            className={INPUT + ' tnum'}
          />
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-danger-bd bg-danger-bg px-3 py-2.5 text-sm text-danger-fg">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
          <span>{error}</span>
        </p>
      )}
      {done && !error && (
        <p className="flex items-start gap-2 rounded-md border border-success-bd bg-success-bg px-3 py-2.5 text-sm text-success-fg">
          <Check className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
          <span>{done}</span>
        </p>
      )}

      {buckets.map((b) => (
        <section key={b.titre} className="rounded-lg border border-border bg-surface shadow-[var(--shadow-sm)]">
          <h2 className="border-b border-border px-5 py-3 text-sm font-semibold">{b.titre}</h2>
          {b.items.map(renderRow)}
        </section>
      ))}
      {rest.length > 0 && (
        <section className="rounded-lg border border-border bg-surface shadow-[var(--shadow-sm)]">
          <h2 className="border-b border-border px-5 py-3 text-sm font-semibold">Autres reglages</h2>
          {rest.map(renderRow)}
        </section>
      )}

      {/* Barre collee : sans elle, un administrateur doit faire defiler toute
          la page pour trouver « Enregistrer ». */}
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface/95 py-3 backdrop-blur">
        <span className="text-sm text-text-muted">
          {touched.length === 0
            ? 'Aucune modification en attente'
            : `${touched.length} modification(s) en attente`}
        </span>
        <div className="flex items-center gap-2">
          {touched.length > 0 && (
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-border-strong bg-white px-4 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" strokeWidth={2.5} />
              Annuler
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={busy || touched.length === 0}
            className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-sky-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Save className="h-4 w-4" strokeWidth={2.5} />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
