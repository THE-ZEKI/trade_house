import { notFound } from 'next/navigation';
import { pageUser } from '@/lib/page';
import { asUser, queryWith } from '@/lib/db';
import Shell from '@/components/Shell';
import { Card, Empty, PageHeader, Badge } from '@/components/ui';
import { can } from '@/lib/permissions';
import Link from 'next/link';
import { ArrowLeft, BookOpen, ClipboardList, Download } from 'lucide-react';
import Exercise from '@/components/TrainingExercise';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

type Row = {
  id: string;
  title: string;
  prompt: string;
  kind: 'written' | 'qcm';
  options: Record<string, string> | null;
  answer: string | null;
  answer_key: string | null;
  submission_id: string | null;
  review_comment: string | null;
  score: string | number | null;
  reviewer: string | null;
  files: { id: string; name: string; mime: string }[] | null;
};

/**
 * Un parcours de formation : le cours, ses exercices, et la copie du trader.
 *
 * La page se sert aux deux roles avec la meme donnee, mais n'affiche pas les
 * memes choses : le manager dispose du formulaire de correction, le trader du
 * bouton « rendre ». Aucun des deux ne voit ce qui n'est pas lui — un trader ne
 * voit pas la reponse d'un collegue, un manager ne rend pas a la place du
 * trader.
 */
export default async function TrainingAssignment({ params }: Params) {
  const user = await pageUser();
  const { id } = await params;
  const isManager = can(user, 'training.review');

  const { assignment, exercises } = await asUser(user.userId, async (sql) => {
    const a = await queryWith(
      sql,
      `select a.id, a.status, a.due_at, a.trader_id, c.title, c.summary, c.content
         from public.training_assignments a
         join public.training_courses c on c.id = a.course_id
        where a.id = $1::uuid`,
      [id],
    );
    const e = await queryWith<Row>(
      sql,
      `select e.id, e.title, e.prompt, e.kind, e.options,
              s.answer, s.answer_key, s.id as submission_id,
              r.comment as review_comment, r.score, u.full_name as reviewer,
              coalesce(
                (select json_agg(json_build_object(
                          'id', tf.id, 'name', tf.original_name, 'mime', tf.mime_type
                        ) order by tf.created_at)
                   from public.training_exercise_files tf
                  where tf.submission_id = s.id),
                '[]'::json
              ) as files
         from public.training_exercises e
         left join public.training_submissions s
                on s.exercise_id = e.id and s.assignment_id = $1::uuid
         left join public.training_reviews r on r.submission_id = s.id
         left join public.users u on u.id = r.reviewer_id
        where e.course_id = (select course_id from public.training_assignments where id = $1::uuid)
        order by e.position`,
      [id],
    );
    return { assignment: a[0] ?? null, exercises: e };
  });

  if (!assignment) notFound();

  const done = exercises.filter((e) => e.submission_id).length;

  return (
    <Shell user={user}>
      <div className="space-y-6">
        <Link href="/training" className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.2} /> Retour a la formation
        </Link>

        <PageHeader
          title={String(assignment.title)}
          subtitle={isManager ? 'Correction du travail du trader' : 'Votre parcours'}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={done === exercises.length && done > 0 ? 'success' : 'info'}>
                {done}/{exercises.length} exercices rendus
              </Badge>
              <a
                href={`/api/training/assignments/${id}/pdf`}
                className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-border-strong bg-white px-3 text-sm font-semibold text-sky-700 hover:bg-sky-50"
              >
                <Download className="h-4 w-4" strokeWidth={2.2} /> Dossier PDF
              </a>
            </div>
          }
        />

        <Card title="Le cours">
          <div className="space-y-3 px-4 py-4">
            {assignment.summary && <p className="text-sm text-text-muted">{String(assignment.summary)}</p>}
            <div className="whitespace-pre-wrap text-sm leading-relaxed">
              {String(assignment.content ?? '').trim() || 'Le contenu du cours n a pas encore ete redige.'}
            </div>
          </div>
        </Card>

        <Card title="Exercices">
          {exercises.length === 0 ? (
            <Empty Icon={ClipboardList} title="Aucun exercice">
              Le manager n a pas encore ajoute d exercice a ce cours.
            </Empty>
          ) : (
            <ul className="divide-y divide-border">
              {exercises.map((e) => (
                <Exercise
                  key={e.id}
                  assignmentId={id}
                  exercise={e}
                  canSubmit={can(user, 'training.submit')}
                  canReview={isManager}
                />
              ))}
            </ul>
          )}
        </Card>

        {!isManager && (
          <p className="flex items-center gap-2 text-xs text-text-faint">
            <BookOpen className="h-3.5 w-3.5" strokeWidth={2} />
            Votre reponse est transmise a votre manager, qui vous corrigera. La correction est
            obligatoire : c est elle qui vous dira quoi améliorer.
          </p>
        )}
      </div>
    </Shell>
  );
}