import { asUser, queryWith, queryOneWith } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { renderTrainingPdf, type PdfTraining, type TrainingExerciseRow } from '@/lib/pdf-training';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound() {
  return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Parcours introuvable' } }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * GET /api/training/assignments/:id/pdf — dossier de formation
 *
 * Meme exigence que le PDF de rapport : le contenu est relu sous le contexte de
 * l'appelant. Un parcours qu'il ne peut pas voir ne produit qu'un 404, jamais un
 * PDF vide — le document ne doit pas devenir un canal de fuite.
 *
 * Une seule version d'un exercice est developpee : celle dont `attempt` est la
 * plus elevee. C'est le travail final qui fait foi ; les tentatives
 * anterieures sont comptees, pas detaillees.
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID.test(id)) return notFound();

  try {
    const user = await requireUser();

    const data = await asUser(user.userId, async (sql) => {
      const assignment = await queryOneWith<Record<string, unknown>>(
        sql,
        `select a.id, a.status, a.assigned_at, a.due_at, a.completed_at, a.trader_id,
                c.title, c.summary, c.content,
                t.full_name as trader_name, t.email as trader_email,
                b.full_name as assigned_by_name
           from public.training_assignments a
           join public.training_courses c on c.id = a.course_id
           join public.users t on t.id = a.trader_id
           left join public.users b on b.id = a.assigned_by
          where a.id = $1::uuid`,
        [id],
      );
      if (!assignment) return null;

      // Defense cote serveur, en plus du RLS : une attribution qui ne serait pas
      // la sienne ne doit rien laisser apparaitre.
      if (!can(user, 'training.review') && assignment.trader_id !== user.userId) return null;

      // Version courante de chaque exercice : `distinct on` garde la ligne dont
      // l'identifiant de soumission est le plus grand pour un exercice donne.
      // L'alias `a` n'existe que dans la requete de l'attribution : celle-ci
      // retrouve le cours par elle-meme, faute de quoi PostgreSQL signalerait une
      // table inconnue dans la clause FROM.
      const exercises = await queryWith<Record<string, unknown>>(
        sql,
        `select distinct on (e.id)
                e.title, e.prompt, e.kind, e.options, e.explanation, e.position,
                s.id as submission_id, s.answer, s.answer_key, s.attempt, s.submitted_at,
                r.comment as review_comment, r.score, r.reviewed_at,
                u.full_name as reviewer,
                (select count(*) from public.training_submissions s2
                  where s2.assignment_id = $1::uuid and s2.exercise_id = e.id) as attempts
           from public.training_exercises e
           left join public.training_submissions s
                  on s.assignment_id = $1::uuid and s.exercise_id = e.id
           left join public.training_reviews r on r.submission_id = s.id
           left join public.users u on u.id = r.reviewer_id
          where e.course_id = (select course_id
                                from public.training_assignments
                               where id = $1::uuid)
          order by e.id, s.id desc nulls last`,
        [id],
      );

      const files = await queryWith<{ submission_id: string; id: string; name: string; mime: string; storage_path: string }>(
        sql,
        `select s.id as submission_id, f.id, f.original_name as name, f.mime_type as mime, f.storage_path
           from public.training_exercise_files f
           join public.training_submissions s on s.id = f.submission_id
          where s.assignment_id = $1::uuid`,
        [id],
      );

      return { assignment, exercises, files };
    });

    if (!data) return notFound();

    const a = data.assignment;

    // Les captures sont rattachees a l'exercice par l'identifiant de la
    // SOUMISSION version courante — et non par l'exercice, qui peut avoir
    // plusieurs versions dont seules les dernieres figurent au dossier.
    const rows: TrainingExerciseRow[] = data.exercises.map((e) => ({
      title: String(e.title ?? ''),
      prompt: String(e.prompt ?? ''),
      kind: e.kind === 'qcm' ? 'qcm' : 'written',
      options: (e.options ?? null) as Record<string, string> | null,
      explanation: (e.explanation ?? null) as string | null,
      position: Number(e.position ?? 0),
      answer: (e.answer ?? null) as string | null,
      answer_key: (e.answer_key ?? null) as string | null,
      attempt: e.attempt === null || e.attempt === undefined ? null : Number(e.attempt),
      attempts: Number(e.attempts ?? 0),
      submitted_at: (e.submitted_at ?? null) as string | null,
      review_comment: (e.review_comment ?? null) as string | null,
      score: e.score === null || e.score === undefined ? null : String(e.score),
      reviewer: (e.reviewer ?? null) as string | null,
      reviewed_at: (e.reviewed_at ?? null) as string | null,
      files: e.submission_id
        ? data.files
            .filter((f) => f.submission_id === e.submission_id)
            .map((f) => ({ id: f.id, name: f.name, mime: f.mime, storage_path: f.storage_path }))
        : [],
    }));

    const payload: PdfTraining = {
      course: {
        title: String(a.title ?? ''),
        summary: (a.summary ?? null) as string | null,
        content: String(a.content ?? ''),
      },
      assignment: {
        status: String(a.status ?? 'assigned'),
        assigned_at: (a.assigned_at ?? null) as string | null,
        due_at: (a.due_at ?? null) as string | null,
        completed_at: (a.completed_at ?? null) as string | null,
      },
      trader: { full_name: String(a.trader_name ?? ''), email: String(a.trader_email ?? '') },
      assignedBy: a.assigned_by_name ? { full_name: String(a.assigned_by_name) } : null,
      exercises: rows,
    };

    const pdf = await renderTrainingPdf(payload);
    return new Response(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-length': String(pdf.length),
        'content-disposition': `attachment; filename="formation-${id.slice(0, 8)}.pdf"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur';
    return new Response(JSON.stringify({ error: { code: 'INTERNAL', message } }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}