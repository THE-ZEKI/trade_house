import { asUser, callApp } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/meetings/:id/link — B3, RG-11, RG-12
 * Nouveau lien principal : l'historique est conservé par la base, et
 * meetings.current_link_id est mis à jour automatiquement.
 */
export async function POST(request: Request, { params }: Params) {
  const raw = await request.json().catch(() => null);
  const url = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).url : null;
  const provider =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).provider : 'other';

  if (typeof url !== 'string' || !url.startsWith('https://')) {
    return jsonOk(
      { error: { code: 'VALIDATION', message: 'Le lien doit etre en https', rule: 'RG-11' } },
      422,
    );
  }

  try {
    const user = await requireUser();
    const { id } = await params;

    const linkId = await asUser(user.userId, (sql) =>
      callApp<string>(sql, 'app.update_meeting_link', [id, url, provider]),
    );

    return jsonOk({ status: 'updated', linkId, url });
  } catch (error) {
    return jsonError(error);
  }
}
