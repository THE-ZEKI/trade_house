import { asUser, callApp } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const STATUS = new Set(['draft', 'published', 'archived']);

type Body = {
  title?: string;
  summary?: string | null;
  content?: string;
  status?: string;
};

/**
 * POST /api/training/courses — creer un cours
 *
 * Naissant en `draft` : un cours n'est pas attribuable tant qu'il n'est pas
 * publie. C'est legerement penible, mais cela evite qu'un trader decouvre un
 * cours encore en relecture.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!can(user, 'training.create_course')) {
      throw new AppError('FORBIDDEN', 'Seul un manager cree un cours', { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as Body | null;
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title) {
      throw new AppError('VALIDATION', 'Le titre est obligatoire', { status: 422 });
    }
    const status = body?.status && STATUS.has(body.status) ? body.status : 'draft';

    const id = await asUser(user.userId, (sql) =>
      callApp<string>(sql, 'create_training_course', [
        title,
        typeof body?.summary === 'string' && body.summary.trim() ? body.summary.trim() : null,
        typeof body?.content === 'string' ? body.content : '',
        status,
      ]),
    );

    return jsonOk({ course: { id, title, status } }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

/** PATCH /api/training/courses — modifier, publier ou archiver un cours */
export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    if (!can(user, 'training.edit_course')) {
      throw new AppError('FORBIDDEN', 'Seul un manager modifie un cours', { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as (Body & { id?: string }) | null;
    if (!body?.id) {
      throw new AppError('VALIDATION', 'Cours manquant', { status: 422 });
    }
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      throw new AppError('VALIDATION', 'Le titre est obligatoire', { status: 422 });
    }
    const status = body.status && STATUS.has(body.status) ? body.status : 'draft';

    await asUser(user.userId, (sql) =>
      callApp(sql, 'update_training_course', [
        body.id,
        title,
        typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim() : null,
        typeof body.content === 'string' ? body.content : '',
        status,
      ]),
    );

    return jsonOk({ updated: body.id });
  } catch (error) {
    return jsonError(error);
  }
}