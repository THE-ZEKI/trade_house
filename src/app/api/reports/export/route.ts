import { asUser, queryWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Neutralise les separateurs CSV : un point-virgule dans une note ne doit
 *  pas pouvoir ouvrir une formule (=cmd) dans Excel ou Sheets. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",;\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * GET /api/reports/export — export CSV (D6)
 *
 * Colonnes D6 : seance, trader, instrument, resultat, R:R prevu/realise,
 * plan respecte, statut, validateur, date de validation. L'export suit les
 * memes filtres que la liste et le meme perimetre RLS : un trader n'exporte
 * que ses propres donnees.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const p = new URL(request.url).searchParams;
    const from = p.get('from');
    const to = p.get('to');
    const traderId = p.get('traderId');
    const status = p.get('status');

    if ((from && !DATE.test(from)) || (to && !DATE.test(to))) {
      return jsonOk({ error: { code: 'VALIDATION', message: 'Date invalide (AAAA-MM-JJ)', rule: null } }, 422);
    }
    if (traderId && !UUID.test(traderId)) {
      return jsonOk({ error: { code: 'VALIDATION', message: 'Identifiant invalide', rule: null } }, 422);
    }

    const rows = await asUser(user.userId, (sql) =>
      queryWith<Record<string, unknown>>(
        sql,
        `select r.session_date, t.full_name as trader, r.instrument, r.result_type,
                r.result_amount, r.strategy, r.nb_trades, r.plan_respected,
                r.rr_planned, r.rr_realized, r.is_no_trade, r.is_late, r.status,
                r.current_version, rv.full_name as validator, r.validated_at
           from public.reports r
           join public.users t on t.id = r.trader_id
           left join public.users rv on rv.id = r.validated_by
          where ($1::date is null or r.session_date >= $1::date)
            and ($2::date is null or r.session_date <= $2::date)
            and ($3::uuid is null or r.trader_id = $3::uuid)
            and ($4::report_status is null or r.status = $4::report_status)
          order by r.session_date desc, t.full_name`,
        [from, to, traderId, status],
      ),
    );

    const header = [
      'seance', 'trader', 'instrument', 'resultat', 'montant', 'strategie', 'nb_trades',
      'plan_respecte', 'rr_prevu', 'rr_realise', 'no_trade', 'en_retard', 'statut',
      'version', 'validateur', 'valide_le',
    ];
    const lines = [header.join(';')];
    for (const r of rows) {
      lines.push([
        r.session_date, r.trader, r.instrument, r.result_type, r.result_amount, r.strategy,
        r.nb_trades, r.plan_respected === null ? '' : r.plan_respected ? 'oui' : 'non',
        r.rr_planned, r.rr_realized, r.is_no_trade ? 'oui' : 'non', r.is_late ? 'oui' : 'non',
        r.status, r.current_version, r.validator, r.validated_at
          ? new Date(r.validated_at as string).toISOString().slice(0, 19).replace('T', ' ')
          : '',
      ].map(csvCell).join(';'));
    }

    // BOM UTF-8 : sans lui, Excel affiche les accents de travers
    const csv = '﻿' + lines.join('\r\n') + '\r\n';
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="rapports-${from ?? 'debut'}-${to ?? 'aujourdhui'}.csv"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
