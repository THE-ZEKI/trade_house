import { asUser, queryWith } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ fileId: string }> };

/** Formes autorisees : alignees sur l'enum annotation_shape de la base. */
const SHAPES = new Set(['rectangle', 'circle', 'arrow', 'freehand', 'text']);

/**
 * GET  /api/reports/files/:fileId/annotations — lire les annotations
 * POST /api/reports/files/:fileId/annotations — ajouter une annotation (RG-46)
 *
 * RG-46 : l'image d'origine n'est jamais modifiee. Les annotations sont stockees
 * a part, en coordonnees normalisees (0..1), ce qui les rend independantes de la
 * taille d'affichage et permet de rejouer le meme dessin sur une capture de
 * resolution differente.
 *
 * L'ecriture est reservee a l'encadrement : c'est la base qui le refuse, via la
 * politique `annotations_insert` (migration 020). Cette verification applicative
 * ne fait qu'accompagner le refus d'un message lisible.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { fileId } = await params;

    const annotations = await asUser(user.userId, (sql) =>
      queryWith(
        sql,
        `select a.id, a.shape, a.data, a.correction_id, a.created_at, u.full_name as author
           from public.file_annotations a
           left join public.users u on u.id = a.author_id
          where a.file_id = $1::uuid
          order by a.created_at`,
        [fileId],
      ),
    );

    return jsonOk({ annotations });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { fileId } = await params;
    const body = (await request.json().catch(() => null)) as {
      shape?: string;
      data?: Record<string, unknown>;
      correction_id?: string | null;
    } | null;

    if (!body?.shape || !SHAPES.has(body.shape)) {
      throw new AppError('VALIDATION', 'Forme d annotation invalide', { status: 422, rule: 'RG-46' });
    }
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
      throw new AppError('VALIDATION', 'Donnees de l annotation invalides', { status: 422, rule: 'RG-46' });
    }

    // Les coordonnees sont normalisees par le client, mais on les VERIFIE ici
    // au lieu de les recadrer. Un recadrage silencieux deplacerait l'annotation
    // ailleurs que ce que l'utilisateur a dessine, et il ne le saurait jamais ;
    // la contrainte SQL de la migration 020 rejette de toute facon ces valeurs.
    const inRange = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
    if (!inRange(body.data.x) || !inRange(body.data.y)) {
      throw new AppError('VALIDATION', 'Coordonnees hors cadre (attendu : 0 a 1)', {
        status: 422,
        rule: 'RG-46',
      });
    }

    const data: Record<string, unknown> = { ...body.data, x: body.data.x, y: body.data.y };
    if (body.shape === 'rectangle' || body.shape === 'circle') {
      const w = body.data.w;
      const h = body.data.h;
      // Une forme d'aire nulle serait invisible et impossible a corriger
      // ensuite : elle est refusee ici et par la contrainte SQL.
      if (typeof w !== 'number' || typeof h !== 'number' || w <= 0 || h <= 0) {
        throw new AppError('VALIDATION', 'Taille de forme invalide', { status: 422, rule: 'RG-46' });
      }
      if (w > 1 || h > 1) {
        throw new AppError('VALIDATION', 'Taille de forme hors cadre', { status: 422, rule: 'RG-46' });
      }
      data.w = w;
      data.h = h;
    }
    if (typeof body.data.text === 'string') {
      const text = body.data.text.slice(0, 500);
      if (!text.trim()) {
        throw new AppError('VALIDATION', 'Le texte de l annotation est obligatoire', { status: 422, rule: 'RG-46' });
      }
      data.text = text;
    }

    const rows = await asUser(user.userId, (sql) =>
      queryWith(
        sql,
        `insert into public.file_annotations (file_id, correction_id, shape, data, author_id)
         values ($1::uuid, $2::uuid, $3::annotation_shape, $4::jsonb, $5::uuid)
         returning id, shape, data, correction_id, created_at`,
        [fileId, body.correction_id ?? null, body.shape, JSON.stringify(data), user.userId],
      ),
    );

    return jsonOk({ annotation: rows[0] }, 201);
  } catch (error) {
    return jsonError(error);
  }
}