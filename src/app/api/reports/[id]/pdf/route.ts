import { asUser, queryWith, queryOneWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { renderReportPdf } from '@/lib/pdf';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/reports/:id/pdf — export PDF d'un rapport (D6)
 *
 * Le contenu est relu sous le contexte de l'appelant : un rapport qu'il ne
 * peut pas voir produit un 404, pas un PDF vide. Le PDF n'est donc jamais un
 * canal de fuite.
 *
 * Les accents passent par la police Helvetica integree (WinAnsi), qui couvre le
 * francais. Les emojis, eux, sont retires a la generation : ils n'existent pas
 * dans cet encodage et casseraient le rendu.
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID.test(id)) {
    return jsonOk({ error: { code: 'NOT_FOUND', message: 'Rapport introuvable', rule: null } }, 404);
  }

  try {
    const user = await requireUser();

    const data = await asUser(user.userId, async (sql) => {
      const report = await queryOneWith<Record<string, unknown>>(
        sql,
        `select r.*, t.full_name as trader_name, t.email as trader_email,
                v.full_name as reviewer_name
           from public.reports r
           join public.users t on t.id = r.trader_id
           left join public.users v on v.id = r.reviewer_id
          where r.id = $1::uuid`,
        [id],
      );
      if (!report) return null;

      const versions = await queryWith(sql, 'select * from public.report_versions where report_id = $1::uuid order by version_number', [id]);
      const corrections = await queryWith(
        sql,
        `select c.target_type, c.target_field, c.message, c.severity, c.status,
                c.created_at, u.full_name as author_name
           from public.report_corrections c
           join public.users u on u.id = c.author_id
          where c.report_id = $1::uuid
          order by c.created_at`,
        [id],
      );
      const files = await queryWith(
        sql,
        `select id, original_name, mime_type, storage_path
           from public.report_files where report_id = $1::uuid order by created_at`,
        [id],
      );

      return {
        report,
        trader: { full_name: String(report.trader_name), email: String(report.trader_email) },
        reviewer: report.reviewer_name ? { full_name: String(report.reviewer_name) } : null,
        versions: versions.map((v) => ({
          version_number: Number((v as { version_number: number }).version_number),
          submitted_at: String((v as { submitted_at: string }).submitted_at),
          submitted_by_name: (v as { submitted_by_name?: string }).submitted_by_name ?? null,
        })),
        corrections: corrections.map((c) => c as never),
        files: files as never,
      };
    });

    if (!data) {
      return jsonOk({ error: { code: 'NOT_FOUND', message: 'Rapport introuvable', rule: null } }, 404);
    }

    const pdf = await renderReportPdf(data as never);
    const name = `rapport-${String(data.report.session_date)}.pdf`;

    return new Response(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-length': String(pdf.length),
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
