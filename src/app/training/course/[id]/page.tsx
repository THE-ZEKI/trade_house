import { notFound } from 'next/navigation';
import Link from 'next/link';
import { pageUser } from '@/lib/page';
import { asUser, queryOneWith, queryWith } from '@/lib/db';
import Shell from '@/components/Shell';
import { Card, Empty, PageHeader, Badge } from '@/components/ui';
import { can } from '@/lib/permissions';
import { ArrowLeft, Send, Users } from 'lucide-react';
import CourseEditor from '@/components/CourseEditor';
import AssignCourse from '@/components/AssignCourse';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Edition d'un cours : contenu, exercices, publication, attribution.
 *
 * Reservee a l'auteur et a l'admin. La decision est prise par la base
 * (app.fn_can_write_course) comme par l'interface — un manager qui n'a pas ecrit
 * le cours voit la page, mais sans les commandes d'edition.
 */
export default async function CoursePage({ params }: Params) {
  const user = await pageUser();
  const { id } = await params;
  const isManager = can(user, 'training.create_course');

  const { course, exercises, traders, assignments } = await asUser(user.userId, async (sql) => {
    const c = await queryOneWith<{
      id: string;
      title: string;
      summary: string | null;
      content: string;
      status: string;
      author_id: string;
    }>(
      sql,
      `select id, title, summary, content, status, author_id
         from public.training_courses where id = $1::uuid`,
      [id],
    );
    if (!c) return { course: null, exercises: [], traders: [], assignments: [] };

    const e = await queryWith(
      sql,
      `select id, position, title, prompt, kind, options, correct_answer, explanation
         from public.training_exercises where course_id = $1::uuid order by position`,
      [id],
    );
    // Seuls les traders de l'equipe sont proposables : proposer toute la maison
    // laisserait croire qu on peut attribuer a n'importe qui.
    const t = await queryWith(
      sql,
      `select u.id, u.full_name
         from public.users u
        where u.role = 'trader' and u.is_active
          and (app.is_admin() or app.can_manage_trader(u.id))
        order by u.full_name`,
    );
    const a = await queryWith(
      sql,
      `select a.id, t.full_name as trader_name, a.status
         from public.training_assignments a
         join public.users t on t.id = a.trader_id
        where a.course_id = $1::uuid
        order by a.assigned_at desc`,
      [id],
    );
    return { course: c, exercises: e, traders: t, assignments: a };
  });

  if (!course) notFound();

  const canEdit = isManager && (user.role === 'admin' || course.author_id === user.userId);

  return (
    <Shell user={user}>
      <div className="space-y-6">
        <Link href="/training" className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.2} /> Retour a la formation
        </Link>

        <PageHeader
          title={course.title}
          subtitle={course.summary ?? undefined}
          actions={
            <Badge tone={course.status === 'published' ? 'success' : course.status === 'draft' ? 'warn' : 'neutral'}>
              {course.status === 'published' ? 'Publie' : course.status === 'draft' ? 'Brouillon' : 'Archive'}
            </Badge>
          }
        />

        {canEdit ? (
          <CourseEditor course={course} />
        ) : (
          <Card title="Le cours">
            <div className="whitespace-pre-wrap px-4 py-4 text-sm">{course.content || 'Cours non redige.'}</div>
          </Card>
        )}

        {canEdit && (
          <Card title={`Exercices (${exercises.length})`}>
            {exercises.length === 0 ? (
              <Empty Icon={Send} title="Aucun exercice">
                Ajoutez un exercice : une question de reflexion ou un QCM.
              </Empty>
            ) : (
              <ol className="divide-y divide-border">
                {exercises.map((e) => (
                  <li key={String(e.id)} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{String(e.title)}</p>
                        <p className="mt-0.5 text-sm text-text-muted">{String(e.prompt)}</p>
                      </div>
                      <Badge tone={e.kind === 'qcm' ? 'info' : 'neutral'}>
                        {e.kind === 'qcm' ? 'QCM' : 'Redaction'}
                      </Badge>
                    </div>
                    {e.explanation && (
                      <p className="mt-2 text-xs text-text-faint">Correction : {String(e.explanation)}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        )}

        {canEdit && (
          <Card title="Attribution">
            {course.status !== 'published' ? (
              <p className="px-4 py-4 text-sm text-text-muted">
                Publiez le cours pour pouvoir l attribuer : un trader ne doit pas decouvrir un cours
                encore en relecture.
              </p>
            ) : (
              <div className="grid gap-4 px-4 py-4">
                <AssignCourse courseId={course.id} traders={traders as { id: string; full_name: string }[]} />
                {assignments.length > 0 && (
                  <ul className="divide-y divide-border rounded-[10px] border border-border">
                    {assignments.map((a) => (
                      <li key={String(a.id)} className="flex items-center justify-between px-3 py-2.5 text-sm">
                        <span className="inline-flex items-center gap-2">
                          <Users className="h-4 w-4 text-text-faint" strokeWidth={2} />
                          {String(a.trader_name)}
                        </span>
                        <Badge tone={a.status === 'completed' ? 'success' : a.status === 'in_progress' ? 'info' : 'neutral'}>
                          {a.status === 'completed' ? 'Termine' : a.status === 'in_progress' ? 'En cours' : 'Attribue'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>
        )}
      </div>
    </Shell>
  );
}