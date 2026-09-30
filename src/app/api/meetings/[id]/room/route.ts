import { asUser, callApp, queryOne, queryOneWith } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { signRoomToken, type RoomClaims } from '@/lib/room-token';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/meetings/:id/room-token — entree en salle (C4, C5, RG-25)
 *
 * Renvoie un jeton de courte duree (30 min par defaut) et le role obtenu.
 * Deux decisions sont prises ici :
 *
 *  - le DROIT d'entrer est rendu par app.room_claims, en base : un non-invite
 *    est refuse, sauf s'il est administrateur (canal de secours) ;
 *  - le ROLE (moderator / participant) est lui aussi decide en base, jamais
 *    demande par le client — sinon n'importe qui pourrait se declarer
 *    moderateur (RG-25).
 *
 * C5 exige une session : le secret de la salle ne transite donc jamais dans
 * un lien d'email, meme pour le bouton « Rejoindre ».
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID.test(id)) return notFound();

  try {
    const user = await requireUser();

    const result = await asUser(user.userId, async (sql) => {
      const claims = await callApp<Record<string, unknown>>(sql, 'room_claims', [id, null]);
      if (!claims) return null;

      const token = signRoomToken(claims as unknown as RoomClaims);

      // le fournisseur est un reglage : l'application ne depend d'aucun nom
      const cfg = await queryOne<{ video_provider: string; video_room_minutes: number }>(
        'select video_provider, video_room_minutes from app.settings()',
      );
      const meeting = await queryOneWith<{
        title: string; starts_at: string; type: string; is_room_open: boolean;
      }>(
        sql,
        `select m.title, m.starts_at, m.type, v.is_room_open
           from public.meetings m
           left join public.v_meeting_room_window v on v.id = m.id
          where m.id = $1::uuid`,
        [id],
      );

      return {
        token,
        role: claims.r,
        expiresAt: new Date(Number(claims.e) * 1000).toISOString(),
        provider: cfg?.video_provider ?? 'external',
        roomMinutes: cfg?.video_room_minutes ?? 60,
        meeting,
      };
    });

    if (!result) return notFound();
    return jsonOk(result);
  } catch (error) {
    if (error instanceof Error && /C4/.test(error.message)) {
      return jsonOk({ error: { code: 'FORBIDDEN', message: error.message, rule: 'C4' } }, 403);
    }
    return jsonError(error);
  }
}

/**
 * POST /api/meetings/:id/attendance — presence automatique (C8, RG-23)
 *
 *   body: { event: 'join' } ou { event: 'leave' }
 *
 * L'interface signale l'entree et la sortie, la base mesure. Un segment est
 * ouvert a la connexion et ferme a la deconnexion ; le job de cloture borne
 * les segments orphelins (onglet ferme sans evenement).
 *
 * On ne fait PAS confiance a un horodatage envoye par le client : c'est now()
 * qui fait foi, sinon un onglet ferme puis reouvert fabriquerait une presence.
 */
export async function POST(request: Request, { params }: Params) {
  const raw = await request.json().catch(() => null);
  const event =
    typeof raw === 'object' && raw !== null ? (raw as { event?: unknown }).event : undefined;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  if (event !== 'join' && event !== 'leave') {
    return jsonOk(
      { error: { code: 'VALIDATION', message: 'evenement « join » ou « leave »', rule: null } },
      422,
    );
  }

  try {
    const user = await requireUser();

    const attendance = await asUser(user.userId, async (sql) => {
      if (event === 'join') {
        const segmentId = await callApp<string>(sql, 'attendance_join', [id, user.userId, 'client']);
        return { event, segmentId };
      }
      await callApp(sql, 'attendance_leave', [id, user.userId, 'client']);
      return { event, closed: true };
    });

    return jsonOk(attendance);
  } catch (error) {
    return jsonError(error);
  }
}

function notFound() {
  return jsonOk({ error: { code: 'NOT_FOUND', message: 'Reunion introuvable', rule: null } }, 404);
}
