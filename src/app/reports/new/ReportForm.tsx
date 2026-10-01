'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Moon, Loader2, Check, TriangleAlert, ArrowRight, TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import type { SessionUser } from '@/lib/auth';
import { EMOTION, RESULT_TYPE, spec, TONE_CLASS, type Tone } from '@/lib/status';
import { Card, PageHeader } from '@/components/ui';

/**
 * Depot d'un rapport (DESIGN_SYSTEM §7).
 *
 * Deux etats dans un meme ecran : le rapport normal et la declaration « pas de
 * trading ». Ce n'est pas un cas d'erreur — c'est une decision legitime, et
 * l'interface le dit en ces mots. Un jour sans trade ne doit jamais ressembler
 * a un rapport vide.
 */

const EMOTIONS = ['calm', 'confident', 'fomo', 'impatience', 'stress', 'revenge', 'other'];

const INPUT =
  'h-11 w-full rounded-[10px] border border-border-strong bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100';
const AREA = `${INPUT} min-h-[140px] py-2.5 leading-relaxed resize-y`;
const LABEL = 'text-[13px] font-medium text-text-muted';

/** Libelle de champ + controle. `wide` n'affecte que la mise en page. */
function Field({
  label,
  required,
  wide,
  children,
}: {
  label: string;
  required?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={'grid gap-1.5' + (wide ? ' sm:col-span-2' : '')}>
      <span className={LABEL}>
        {label}
        {required && <span className="ml-1 text-danger-fg">*</span>}
      </span>
      {children}
    </label>
  );
}

/**
 * Les trois resultats possibles, avec leur teinte.
 *
 * La teinte vient de la table `RESULT_TYPE` et non d'un `if` local : c'est la
 * meme source que le reste de l'application, donc pas de divergence entre ce
 * que le trader choisit et ce que le manager lit ensuite.
 */
const RESULTS = [
  { key: 'gain' as const, Icon: TrendingUp, tone: 'success' as Tone },
  { key: 'loss' as const, Icon: TrendingDown, tone: 'danger' as Tone },
  { key: 'breakeven' as const, Icon: Minus, tone: 'neutral' as Tone },
];

const PLAN_CHOICES = [
  { value: true, text: 'Oui' },
  { value: false, text: 'Non' },
];

const EMOTION_KEYS = EMOTIONS;

type Form = {
  sessionDate: string;
  instrument: string;
  resultType: 'gain' | 'loss' | 'breakeven';
  resultAmount: string;
  nbTrades: string;
  planRespected: boolean | null;
  rrPlanned: string;
  rrRealized: string;
  strategy: string;
  emotions: string[];
  emotionsNote: string;
  highlights: string;
  mistakes: string;
  notes: string;
  isNoTrade: boolean;
  noTradeReason: string;
};

const today = () => new Date().toISOString().slice(0, 10);

const INITIAL: Form = {
  sessionDate: today(),
  instrument: '',
  resultType: 'gain',
  resultAmount: '',
  nbTrades: '',
  planRespected: null,
  rrPlanned: '',
  rrRealized: '',
  strategy: '',
  emotions: [],
  emotionsNote: '',
  highlights: '',
  mistakes: '',
  notes: '',
  isNoTrade: false,
  noTradeReason: '',
};

export default function ReportForm({
  user,
  locale,
  label,
}: {
  user: SessionUser;
  locale: string | null;
  label: (k: string) => string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(INITIAL);
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Le signe suit le type : saisir « -420 » sur une perte donnerait « -(-420) ».
  const signedAmount = () => {
    const n = Number(form.resultAmount);
    if (!Number.isFinite(n) || form.resultAmount === '') return '';
    if (form.resultType === 'loss') return String(-Math.abs(n));
    if (form.resultType === 'gain') return String(Math.abs(n));
    return '0';
  };

  // L'ecart planifie/realise est l'indicateur que le manager suit en premier :
  // il se calcule ici, en direct, pendant la saisie.
  const gap =
    form.rrPlanned !== '' && form.rrRealized !== ''
      ? Number(form.rrRealized) - Number(form.rrPlanned)
      : null;

  async function send(submit: boolean) {
    setBusy(submit ? 'submit' : 'draft');
    setError(null);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionDate: form.sessionDate,
          instrument: form.instrument,
          resultType: form.isNoTrade ? '' : form.resultType,
          resultAmount: form.isNoTrade ? null : Number(signedAmount()),
          strategy: form.strategy,
          nbTrades: form.nbTrades === '' ? null : Number(form.nbTrades),
          planRespected: form.planRespected,
          rrPlanned: form.rrPlanned === '' ? null : Number(form.rrPlanned),
          rrRealized: form.rrRealized === '' ? null : Number(form.rrRealized),
          emotions: form.emotions,
          emotionsNote: form.emotionsNote,
          highlights: form.highlights,
          mistakes: form.mistakes,
          notes: form.notes,
          isNoTrade: form.isNoTrade,
          noTradeReason: form.noTradeReason,
          // Le depot se fait par un second appel : creer puis soumettre.
          // On cree d'abord, on soumet si demande, et on ne navigue qu'a la fin.
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Enregistrement impossible');
        return;
      }
      const id = data?.report?.id ?? data?.id;
      if (submit && id) {
        const act = await fetch(`/api/reports/${id}/actions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'submit' }),
        });
        if (!act.ok) {
          const d2 = await act.json();
          // Le brouillon existe : on ne perd rien, on ne pretend pas avoir
          // depose. On explique et on renvoie vers le rapport.
          setError(`${d2?.error?.message ?? 'Depot refuse'} — brouillon enregistre.`);
          router.refresh();
          return;
        }
      }
      router.push(id ? `/reports/${id}` : '/reports');
      router.refresh();
    } catch {
      setError('Serveur injoignable');
    } finally {
      setBusy(null);
    }
  }

return (
    <div className="space-y-5">
      <PageHeader title={label('action.new_report')} subtitle={label('dash.my_drafts')} />

      {!form.isNoTrade && (
        <button
          type="button"
          onClick={() => set('isNoTrade', true)}
          className="inline-flex items-center gap-2.5 rounded-lg border border-neutral-bd bg-neutral-bg px-4 py-3 text-sm text-neutral-fg"
        >
          <Moon className="h-4 w-4 shrink-0" strokeWidth={2.5} />
          <span>{label('form.no_trade_toggle')}</span>
        </button>
      )}

      {form.isNoTrade ? (
        <>
          <Card>
            <div className="flex items-start gap-3 px-5 py-4">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-neutral-bg">
                <Moon className="h-5 w-5 text-neutral-fg" strokeWidth={2} />
              </span>
              <div>
                <h2 className="text-base font-semibold">{label('form.no_trade_title')}</h2>
                <p className="mt-0.5 text-sm text-text-muted">{label('form.no_trade_hint')}</p>
              </div>
            </div>
          </Card>

          <Card title={label('form.no_trade_reason')}>
            <div className="grid gap-4 px-5 py-4">
              <Field label={label('form.session_date')} required>
                <input type="date" value={form.sessionDate} onChange={(e) => set('sessionDate', e.target.value)} required className={INPUT} />
              </Field>
              <Field label={label('form.instrument')}>
                <input value={form.instrument} onChange={(e) => set('instrument', e.target.value)} className={INPUT} placeholder="EURUSD" />
              </Field>
              <Field label={label('form.no_trade_reason')} required>
                <textarea value={form.noTradeReason} onChange={(e) => set('noTradeReason', e.target.value)} required className={AREA} />
              </Field>
              <button type="button" onClick={() => set('isNoTrade', false)} className="justify-self-start text-[13px] font-semibold text-sky-700 hover:underline">
                Modifier le rapport
              </button>
            </div>
          </Card>
        </>
      ) : (
        <>
          <Card title={label('form.result_type')}>
            <div className="grid gap-4 px-5 py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={label('form.session_date')} required>
                  <input type="date" value={form.sessionDate} onChange={(e) => set('sessionDate', e.target.value)} required className={INPUT} />
                </Field>
                <Field label={label('form.instrument')}>
                  <input value={form.instrument} onChange={(e) => set('instrument', e.target.value)} className={INPUT} placeholder="EURUSD" />
                </Field>
              </div>

              <fieldset className="grid gap-2">
                <legend className={LABEL}>{label('form.result_type')}</legend>
                <div className="grid grid-cols-3 gap-2">
                  {RESULTS.map((r) => {
                    const active = form.resultType === r.key;
                    const Icon = r.Icon;
                    return (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => set('resultType', r.key)}
                        aria-pressed={active}
                        className={'flex min-h-[56px] items-center justify-center gap-2 rounded-md border text-sm font-semibold transition-colors ' + (active ? TONE_CLASS[r.tone] + ' ring-2 ring-sky-300' : 'border-border-strong bg-white text-text-muted hover:bg-surface-alt')}
                      >
                        <Icon className="h-4 w-4" strokeWidth={2.5} />
                        {label('result.' + r.key)}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={label('form.result_amount')}>
                  <div className="relative">
                    <input type="number" inputMode="decimal" value={form.resultAmount} onChange={(e) => set('resultAmount', e.target.value)} className={INPUT + ' tnum pr-16'} placeholder="0" />
                    {form.resultAmount !== '' && (
                      <span className="tnum pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-muted">
                        {signedAmount()}
                      </span>
                    )}
                  </div>
                </Field>
                <Field label={label('form.nb_trades')}>
                  <input type="number" inputMode="numeric" min={0} value={form.nbTrades} onChange={(e) => set('nbTrades', e.target.value)} className={INPUT} />
                </Field>
                <fieldset className="grid gap-1.5">
                  <legend className={LABEL}>{label('form.plan_respected')}</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {PLAN_CHOICES.map((v) => {
                      const active = form.planRespected === v.value;
                      return (
                        <button
                          key={String(v.value)}
                          type="button"
                          onClick={() => set('planRespected', active ? null : v.value)}
                          aria-pressed={active}
                          className={'inline-flex h-11 items-center justify-center gap-1.5 rounded-[10px] border text-sm font-semibold transition-colors ' + (active ? (v.value ? 'border-success-bd bg-success-bg text-success-fg' : 'border-warn-bd bg-warn-bg text-warn-fg') : 'border-border-strong bg-white text-text-muted hover:bg-surface-alt')}
                        >
                          {active && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                          {v.text}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={label('form.rr_planned')}>
                  <input type="number" inputMode="decimal" step="0.1" value={form.rrPlanned} onChange={(e) => set('rrPlanned', e.target.value)} className={INPUT + ' tnum'} placeholder="2.0" />
                </Field>
                <Field label={label('form.rr_realized')}>
                  <input type="number" inputMode="decimal" step="0.1" value={form.rrRealized} onChange={(e) => set('rrRealized', e.target.value)} className={INPUT + ' tnum'} placeholder="1.4" />
                </Field>
              </div>

              {gap !== null && (
                <div className={'flex items-center gap-2 rounded-md border px-3 py-2 text-sm ' + (gap >= 0 ? 'border-success-bd bg-success-bg text-success-fg' : 'border-warn-bd bg-warn-bg text-warn-fg')}>
                  {gap >= 0 ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <TriangleAlert className="h-4 w-4" strokeWidth={2.5} />}
                  <span className="tnum font-semibold">{label('form.rr_gap')} : {gap > 0 ? '+' : ''}{gap.toFixed(1)} R</span>
                </div>
              )}
            </div>
          </Card>

          <Card title={label('form.strategy')}>
            <div className="grid gap-4 px-5 py-4">
              <Field label={label('form.strategy')} wide>
                <textarea value={form.strategy} onChange={(e) => set('strategy', e.target.value)} className={AREA + ' min-h-[100px]'} />
              </Field>

              <fieldset className="grid gap-2">
                <legend className={LABEL}>{label('form.emotions')}</legend>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {EMOTION_KEYS.map((e) => {
                    const { Icon, tone } = spec(EMOTION, e);
                    const active = form.emotions.includes(e);
                    return (
                      <button
                        key={e}
                        type="button"
                        aria-pressed={active}
                        onClick={() => set('emotions', active ? form.emotions.filter((x) => x !== e) : form.emotions.concat(e))}
                        className={'flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-md border p-1 text-[11px] font-semibold transition-colors ' + (active ? TONE_CLASS[tone] + ' ring-2 ring-sky-300' : 'border-border bg-white text-text-muted hover:bg-surface-alt')}
                      >
                        <Icon className="h-4 w-4" strokeWidth={2.2} />
                        <span className="truncate">{label('emotion.' + e)}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <Field label={label('form.emotions_note')}>
                <input value={form.emotionsNote} onChange={(e) => set('emotionsNote', e.target.value)} className={INPUT} />
              </Field>
              <Field label={label('form.highlights')} wide>
                <textarea value={form.highlights} onChange={(e) => set('highlights', e.target.value)} className={AREA} />
              </Field>
              <Field label={label('form.mistakes')} wide>
                <textarea value={form.mistakes} onChange={(e) => set('mistakes', e.target.value)} className={AREA} />
              </Field>
              <Field label={label('form.notes')} wide>
                <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} className={AREA + ' min-h-[100px]'} />
              </Field>
            </div>
          </Card>
        </>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-danger-bd bg-danger-bg px-3 py-2.5 text-sm text-danger-fg">{error}</p>
      )}

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface/95 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => send(false)}
          disabled={busy !== null || !form.sessionDate}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-border-strong bg-white px-4 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50 disabled:opacity-50"
        >
          {busy === 'draft' && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
          {label('form.save_draft')}
        </button>
        <button
          type="button"
          onClick={() => send(true)}
          disabled={busy !== null || !form.sessionDate}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-sky-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:opacity-50"
        >
          {busy === 'submit' ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <ArrowRight className="h-4 w-4" strokeWidth={2.5} />}
          {label('action.submit')}
        </button>
      </div>
    </div>
  );
}
