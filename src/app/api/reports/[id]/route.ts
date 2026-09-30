import { asUser, queryWith, queryOneWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const FIELDS = [
  'result_type', 'result_amount', 'strategy', 'nb_trades', 'plan_respected',
  'rr_planned', 'rr_realized', 'emotions', 'emotions_note', 'highlights',
  'mistakes', 'notes', 'instrument',
] as const;

/**
 * GET /api/reports/:id — detail complet (E5, E6, E7)
 *
 * Renvoye l'inventaire des versions, les pieces jointes et les corrections,
 * avec pour chaque version l'ecart par rapport a la precedente (E6).
 * L'acces est filtre par le RLS : un rapport invisible renvoie 404, pas 403
 * (on ne confirme pas l'existence d'une donnee sans droits).
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const detail = await asUser(user.userId, async (sql) => {
      const report = await queryOneWith(
        sql,
        `select r.*, t.full_name as trader_name, u.full_name as reviewer_name
           from public.reports r
           join public.users t on t.id = r.trader_id
           left join public.users u on u.id = r.reviewer_id
          where r.id = $1::uuid`,
        [id],
      );
      if (!report) return null;

      const versions = await queryWith(
        sql,
        `select v.id, v.version_number, v.submitted_at, u.full_name as submitted_by_name,
                v.content_snapshot,
                -- E6 : champs modifies par rapport a la version precedente
                coalesce((
                  select array_agg(k order by k)
                    from jsonb_each(v.content_snapshot - coalesce(prev.snap, '{}'::jsonb)) as k
                ), '{}') as changed_fields
           from public.report_versions v
           left join public.users u on u.id = v.submitted_by
           left join lateral (
             select content_snapshot as snap from public.report_versions p
              where p.report_id = v.report_id and p.version_number = v.version_number - 1
           ) prev on true
          where v.report_id = $1::uuid
          order by v.version_number`,
        [id],
      );

      const files = await queryWith(
        sql,
        `select f.id, f.kind, f.original_name, f.mime_type, f.size_bytes, f.version_id,
                f.created_at, u.full_name as uploaded_by_name,
                (select count(*)::int from public.file_annotations a where a.file_id = f.id) as annotations_count
           from public.report_files f
           left join public.users u on u.id = f.uploaded_by
          where f.report_id = $1::uuid
          order by f.created_at`,
        [id],
      );

      const corrections = await queryWith(
        sql,
        `select c.id, c.version_id, c.target_type, c.target_field, c.target_file_id,
                c.message, c.severity, c.status, c.trader_reply, c.rejection_reason,
                c.created_at, c.resolved_at, u.full_name as author_name
           from public.report_corrections c
           join public.users u on u.id = c.author_id
          where c.report_id = $1::uuid
          order by c.created_at`,
        [id],
      );

      return { report, versions, files, corrections };
    });

    if (!detail) {
      return jsonOk({ error: { code: 'NOT_FOUND', message: 'Rapport introuvable', rule: null } }, 404);
    }
    return jsonOk(detail);
  } catch (error) {
    return jsonError(error);
  }
}



const NUMERIC_FIELDS = new Set(['result_amount', 'nb_trades', 'rr_planned', 'rr_realized']);
const BOOL_FIELDS = new Set(['plan_respected']);
const TEXT_FIELDS = new Set(['emotions_note', 'highlights', 'mistakes', 'notes', 'instrument']);

/**
 * PATCH /api/reports/:id — modification d'un brouillon
 *
 * Un rapport soumis n'est plus modifiable directement : la correction passe
 * par un cycle de correction (RG-34), puis par une nouvelle version. C'est ce
 * qui garantit l'historique E6 : le contenu de chaque version est fige.
 */
export async function PATCH(request: Request, { params }: Params) {
  const raw = await request.json().catch(() => null);
  if (typeof raw !== 'object' || raw === null) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Donnees invalides', rule: null } }, 422);
  }
  const body = raw as Record<string, unknown>;

  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (col: string, val: unknown) => {
    values.push(val);
    sets.push(`${col} = $${values.length}::${NUMERIC_FIELDS.has(col) ? 'numeric' : BOOL_FIELDS.has(col) ? 'boolean' : 'text'}`);
  };

  for (const field of FIELDS) {
    if (!(field in body)) continue;
    const v = body[field];
    if (field === 'emotions') {
      if (!Array.isArray(v)) continue;
      add('emotions', v.filter((e) => typeof e === 'string'));
    } else if (NUMERIC_FIELDS.has(field) || BOOL_FIELDS.has(field)) {
      if (v === null || v === '') add(field, null);
      else if (typeof v === 'boolean') add(field, v);
      else if (Number.isFinite(Number(v))) add(field, Number(v));
    } else if (TEXT_FIELDS.has(field)) {
      if (v === null) add(field, null);
      else if (typeof v === 'string') add(field, v.slice(0, 8000) || null);
    } else if (field === 'result_type') {
      if (typeof v === 'string' && ['gain', 'loss', 'breakeven'].includes(v)) {
        add('result_type', v);
      }
    }
  }

  if (sets.length === 0) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Aucun champ modifiable', rule: null } }, 422);
  }

  try {
    const user = await requireUser();
    const { id } = await params;

    const updated = await asUser(user.userId, async (sql) => {
      const rows = await queryWith(
        sql,
        `update public.reports set ${sets.join(', ')}, updated_at = now()
          where id = $${values.length + 1}::uuid
            and trader_id = $${values.length + 2}::uuid
            and status in ('draft', 'correction_requested')
          returning id, status, current_version, updated_at`,
        [...values, id, user.userId],
      );
      return rows[0] ?? null;
    });

    if (!updated) {
      return jsonOk(
        { error: { code: 'CONFLICT', message: 'Rapport non modifiable (soumis ou absent)', rule: null } },
        409,
      );
    }
    return jsonOk({ report: updated });
  } catch (error) {
    return jsonError(error);
  }
}
