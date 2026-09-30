import { asUser, queryWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// valeurs réelles des énumérations PostgreSQL (vérifiées sur la base)
const RESULT_TYPES = ['gain', 'loss', 'breakeven'];
const EMOTIONS = ['calm', 'confident', 'fomo', 'impatience', 'stress', 'revenge', 'other'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/reports — liste (D5, E5)
 *
 * Filtres : statut, trader, periode, instrument.
 * La visibilite est filtree par le RLS : un trader ne voit que ses rapports,
 * un superviseur voit ceux de son equipe (app.can_view_trader).
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const p = new URL(request.url).searchParams;
    const status = p.get('status');
    const traderId = p.get('traderId');
    const instrument = p.get('instrument');
    const from = p.get('from');
    const to = p.get('to');

    if (status && !/^[a-z_]+$/.test(status)) {
      return jsonOk({ error: { code: 'VALIDATION', message: 'Statut invalide', rule: null } }, 422);
    }
    if (traderId && !UUID.test(traderId)) {
      return jsonOk({ error: { code: 'VALIDATION', message: 'Identifiant invalide', rule: null } }, 422);
    }
    if ((from && !DATE.test(from)) || (to && !DATE.test(to))) {
      return jsonOk({ error: { code: 'VALIDATION', message: 'Date invalide (AAAA-MM-JJ)', rule: null } }, 422);
    }

    const rows = await asUser(user.userId, (sql) =>
      queryWith(
        sql,
        `select r.id, r.session_date, r.instrument, r.result_type, r.result_amount,
                r.strategy, r.nb_trades, r.plan_respected, r.rr_planned, r.rr_realized,
                r.emotions, r.is_no_trade, r.is_late, r.status, r.current_version,
                r.reviewer_id, r.submitted_at, r.reviewed_at, r.validated_at,
                t.full_name as trader_name,
                (select count(*)::int from public.report_files f where f.report_id = r.id) as files_count,
                (select count(*)::int from public.report_corrections c
                   where c.report_id = r.id and c.status = 'open') as open_corrections
           from public.reports r
           join public.users t on t.id = r.trader_id
          where ($1::report_status is null or r.status = $1::report_status)
            and ($2::uuid is null or r.trader_id = $2::uuid)
            and ($3::text is null or r.instrument = $3)
            and ($4::date is null or r.session_date >= $4::date)
            and ($5::date is null or r.session_date <= $5::date)
          order by r.session_date desc, r.created_at desc
          limit 500`,
        [status, traderId, instrument, from, to],
      ),
    );

    return jsonOk({ reports: rows });
  } catch (error) {
    return jsonError(error);
  }
}

type CreateBody = {
  sessionDate: string;
  instrument: string | null;
  resultType: string | null;
  resultAmount: number | null;
  strategy: string | null;
  nbTrades: number | null;
  planRespected: boolean | null;
  rrPlanned: number | null;
  rrRealized: number | null;
  emotions: string[];
  emotionsNote: string | null;
  highlights: string | null;
  mistakes: string | null;
  notes: string | null;
  isNoTrade: boolean;
  noTradeReason: string | null;
};

function parseCreate(raw: unknown): CreateBody | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const b = raw as Record<string, unknown>;

  const sessionDate = typeof b.sessionDate === 'string' ? b.sessionDate : '';
  if (!DATE.test(sessionDate)) return null;

  const isNoTrade = b.isNoTrade === true;
  // un jour sans trade porte is_no_trade = true ; result_type reste vide
  const resultType = typeof b.resultType === 'string' ? b.resultType : '';
  if (!isNoTrade && !RESULT_TYPES.includes(resultType)) return null;

  const emotions = Array.isArray(b.emotions)
    ? (b.emotions as unknown[]).filter((e): e is string => typeof e === 'string' && EMOTIONS.includes(e))
    : [];

  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    sessionDate,
    instrument: typeof b.instrument === 'string' ? b.instrument.trim().slice(0, 30) || null : null,
    resultType: isNoTrade ? null : resultType,
    resultAmount: num(b.resultAmount),
    strategy: typeof b.strategy === 'string' ? b.strategy.trim().slice(0, 200) || null : null,
    nbTrades: num(b.nbTrades),
    planRespected: b.planRespected === null || b.planRespected === undefined ? null : b.planRespected === true,
    rrPlanned: num(b.rrPlanned),
    rrRealized: num(b.rrRealized),
    emotions,
    emotionsNote: typeof b.emotionsNote === 'string' ? b.emotionsNote || null : null,
    highlights: typeof b.highlights === 'string' ? b.highlights || null : null,
    mistakes: typeof b.mistakes === 'string' ? b.mistakes || null : null,
    notes: typeof b.notes === 'string' ? b.notes || null : null,
    isNoTrade,
    noTradeReason: typeof b.noTradeReason === 'string' ? b.noTradeReason || null : null,
  };
}

/**
 * POST /api/reports — creation d'un brouillon (P7)
 *
 * Le brouillon est cree en base ; sa soumission passe obligatoirement par
 * app.submit_report, qui controle le delai RG-32 et fige la version 1.
 */
export async function POST(request: Request) {
  const body = parseCreate(await request.json().catch(() => null));
  if (!body) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Donnees invalides', rule: null } }, 422);
  }

  try {
    const user = await requireUser();

    const created = await asUser(user.userId, async (sql) => {
      const rows = await queryWith(
        sql,
        `insert into public.reports (
            trader_id, session_date, instrument, result_type, result_amount, strategy,
            nb_trades, plan_respected, rr_planned, rr_realized, emotions, emotions_note,
            highlights, mistakes, notes, is_no_trade, no_trade_reason, status)
         values ($1::uuid, $2::date, $3, $4::report_result_type, $5::numeric, $6, $7::int, $8::boolean,
                 $9::numeric, $10::numeric, $11::emotion_code[], $12, $13, $14, $15,
                 $16::boolean, $17, 'draft')
         returning id, status, current_version, session_date, created_at`,
        [
          user.userId, body.sessionDate, body.instrument, body.resultType, body.resultAmount,
          body.strategy, body.nbTrades, body.planRespected, body.rrPlanned, body.rrRealized,
          body.emotions, body.emotionsNote, body.highlights, body.mistakes, body.notes,
          body.isNoTrade, body.noTradeReason,
        ],
      );
      return rows[0] ?? null;
    });

    if (!created) {
      return jsonOk({ error: { code: 'CONFLICT', message: 'Rapport deja existant pour cette seance', rule: null } }, 409);
    }
    return jsonOk({ report: created }, 201);
  } catch (error) {
    // un seul rapport par (trader, seance) : violation 23505 -> 409 explicite
    if (error instanceof Error && (error as { code?: string }).code === '23505') {
      return jsonOk({ error: { code: 'CONFLICT', message: 'Un rapport existe deja pour cette seance', rule: null } }, 409);
    }
    return jsonError(error);
  }
}
