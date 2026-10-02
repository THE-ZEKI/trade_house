import { asUser, queryWith, callApp } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/training/courses/:id/exercises — ajouter un exercice
 *
 * Un exercice ecrit (redaction) ou un QCM. Le QCM porte ses propositions et sa
 * cle ; la base refuse une cle absente des propositions, sinon la correction
 * automatique ne pourrait jamais etre juste.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    if (!can(user, 'training.add_exercise')) {
      throw new AppError('FORBIDDEN', 'Seul un manager ajoute un exercice', { status: 403 });
    }
    const { id: courseId } = await params;

    const body = (await request.json().catch(() => null)) as {
      title?: string;
      prompt?: string;
      kind?: string;
      options?: unknown;
      correctIndex?: number;
      explanation?: string;
    } | null;

    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    if (!title || !prompt) {
      throw new AppError('VALIDATION', 'Titre et enonce sont obligatoires', { status: 422 });
    }

    const kind = body?.kind === 'qcm' ? 'qcm' : 'written';

    // Les propositions arrivent en liste, pas en objet : la cle (« a », « b »…)
    // designe une POSITION, ce n'est pas une donnee saisie par l'utilisateur.
    const options = Array.isArray(body?.options)
      ? (body.options as unknown[]).filter((o): o is string => typeof o === 'string' && o.trim() !== '')
      : [];
    const map: Record<string, string> = {};
    options.forEach((text, i) => {
      map[String.fromCharCode(97 + i)] = text.trim();
    });
    const correct =
      kind === 'qcm' && Number.isInteger(body?.correctIndex) && Number(body?.correctIndex) >= 0
        ? String.fromCharCode(97 + Number(body?.correctIndex))
        : null;

    if (kind === 'qcm' && !correct) {
      throw new AppError('VALIDATION', 'Indiquez la bonne proposition', { status: 422 });
    }

    const id = await asUser(user.userId, (sql) =>
      callApp<string>(sql, 'add_training_exercise', [
        courseId,
        title,
        prompt,
        kind,
        Object.keys(map).length ? JSON.stringify(map) : null,
        correct,
        typeof body?.explanation === 'string' && body.explanation.trim() ? body.explanation.trim() : null,
      ]),
    );

    return jsonOk({ exercise: { id, courseId, kind } }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * GET /api/training/courses/:id/exercises — les exercices d'un cours
 *
 * La cle de correction N'EST PAS envoyee au trader : il pourrait envoyer la bonne
 * reponse sans avoir reflechi. Seule l'explication — le « pourquoi » — est
 * transmise, et seulement a l'encadrement.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id: courseId } = await params;

    const rows = await asUser(user.userId, (sql) =>
      queryWith(
        sql,
        `select e.id, e.position, e.title, e.prompt, e.kind, e.options,
                case when app.current_user_role() <> 'trader'
                     then e.correct_answer else null end as correct_answer,
                case when app.current_user_role() <> 'trader'
                     then e.explanation else null end as explanation
           from public.training_exercises e
          where e.course_id = $1::uuid
          order by e.position`,
        [courseId],
      ),
    );

    return jsonOk({ exercises: rows });
  } catch (error) {
    return jsonError(error);
  }
}