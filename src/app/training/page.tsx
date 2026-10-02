import { pageUser } from '@/lib/page';
import { asUser, queryWith } from '@/lib/db';
import Shell from '@/components/Shell';
import { Card, Empty, Badge, PageHeader, Stat } from '@/components/ui';
import { can } from '@/lib/permissions';
import Link from 'next/link';
import { GraduationCap, BookOpen, ClipboardCheck, Clock } from 'lucide-react';
import NewCourse from '@/components/NewCourse';

export const dynamic = 'force-dynamic';

type Course = {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  exercise_count: string | number;
  author: string;
};

type Assignment = {
  id: string;
  trader_name?: string;
  course_title: string;
  status: string;
  due_at: string | null;
  total: string | number;
  done: string | number;
  reviewed: string | number;
};

/**
 * La formation, vue par le role qui la consulte.
 *
 * L'encadrement y PILOTE (ses cours, la progression de ses traders) ; le trader
 * y TRAVAILLE (ses cours attribues, ses exercices a rendre, ses corrections).
 * Une page unique evite au trader d'avoir a aller chercher « ou est mon cours »
 * dans l'espace d'administration.
 */
export default async function TrainingPage() {
  const user = await pageUser();
  const isManager = can(user, 'training.assign');

  const { courses, assignments } = await asUser(user.userId, async (sql) => ({
    courses: isManager
      ? await queryWith(
          sql,
          `select c.id, c.title, c.summary, c.status, u.full_name as author,
                  (select count(*) from public.training_exercises e
                    where e.course_id = c.id) as exercise_count
             from public.training_courses c
             join public.users u on u.id = c.author_id
            order by c.updated_at desc`,
        )
      : await queryWith(
          sql,
          // Le trader ne voit que les cours qui lui sont reellement attribues.
          //
          // DISTINCT + ORDER BY : PostgreSQL exige que toute expression de
          // tri figure dans la liste SELECT. Or le tri porte sur
          // c.updated_at, qui n'est pas selectionne : la page renvoyait une
          // erreur 500 « pour SELECT DISTINCT, ORDER BY, les expressions
          // doivent apparaitre dans la liste SELECT » — c'est-a-dire
          // l'affectation existait, mais la page etait INACCESSIBLE au
          // trader. On selectionne donc aussi la colonne de tri.
          `select distinct c.id, c.title, c.summary, c.status, u.full_name as author,
                  c.updated_at
             from public.training_assignments a
             join public.training_courses c on c.id = a.course_id
             join public.users u on u.id = c.author_id
            where a.trader_id = $1::uuid
            order by c.updated_at desc`,
          [user.userId],
        ),
    assignments: await queryWith<Assignment>(
      sql,
      isManager
        ? `select a.id, a.course_id, a.trader_id, a.status, a.assigned_at, a.due_at,
                  t.full_name as trader_name, c.title as course_title,
                  (select count(*) from public.training_exercises e
                    where e.course_id = a.course_id) as total,
                  (select count(*) from public.training_submissions s
                    where s.assignment_id = a.id) as done,
                  (select count(*) from public.training_submissions s
                     join public.training_reviews r on r.submission_id = s.id
                    where s.assignment_id = a.id) as reviewed
             from public.training_assignments a
             join public.training_courses c on c.id = a.course_id
             join public.users t on t.id = a.trader_id
            order by a.assigned_at desc`
        : `select a.id, a.course_id, a.trader_id, a.status, a.assigned_at, a.due_at,
                  c.title as course_title,
                  (select count(*) from public.training_exercises e
                    where e.course_id = a.course_id) as total,
                  (select count(*) from public.training_submissions s
                    where s.assignment_id = a.id) as done,
                  (select count(*) from public.training_submissions s
                     join public.training_reviews r on r.submission_id = s.id
                    where s.assignment_id = a.id) as reviewed
             from public.training_assignments a
             join public.training_courses c on c.id = a.course_id
            where a.trader_id = $1::uuid
            order by a.assigned_at desc`,
      isManager ? [] : [user.userId],
    ),
  }));

  const pendingReview = assignments.filter(
    (a) => Number(a.done) > Number(a.reviewed) && Number(a.done) > 0,
  ).length;

  return (
    <Shell user={user}>
      <div className="space-y-6">
        <PageHeader
          title="Formation"
          subtitle={
            isManager ? 'Vos cours et la progression de vos traders' : 'Vos cours attribues et vos exercices'
          }
          actions={isManager ? <NewCourse /> : undefined}
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label={isManager ? 'Cours' : 'Cours attribues'} value={courses.length} Icon={BookOpen} />
          <Stat
            label="Parcours en cours"
            value={assignments.filter((a) => a.status === 'in_progress').length}
            Icon={Clock}
          />
          <Stat
            label={isManager ? 'Travaux a corriger' : 'Exercices rendus'}
            value={isManager ? pendingReview : assignments.reduce((n, a) => n + Number(a.done), 0)}
            Icon={ClipboardCheck}
          />
        </div>

        {assignments.length > 0 && (
          <Card title={isManager ? 'Progression des traders' : 'Mes parcours'}>
            <ul className="divide-y divide-border">
              {assignments.map((a) => {
                const total = Number(a.total);
                const done = Number(a.done);
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                return (
                  <li key={a.id}>
                    <Link
                      href={`/training/${a.id}`}
                      className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-alt"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {isManager ? a.trader_name : a.course_title}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-text-muted">
                          {isManager ? a.course_title : 'Ouvrir le cours'}
                          {a.due_at && ` · pour le ${new Date(a.due_at).toLocaleDateString('fr-FR')}`}
                        </p>
                      </div>
                      <div className="w-28 shrink-0">
                        <div className="h-2 overflow-hidden rounded-pill bg-surface-alt">
                          <div
                            className={`h-full rounded-pill ${pct === 100 ? 'bg-emerald-500' : 'bg-sky-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="mt-1 text-right text-[11px] text-text-faint tnum">
                          {done}/{total} exercices
                        </p>
                      </div>
                      {isManager && done > 0 && (
                        <Badge tone={done > Number(a.reviewed) ? 'warn' : 'success'}>
                          {done - Number(a.reviewed)} a corriger
                        </Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {isManager && (
          <Card title="Mes cours">
            {courses.length === 0 ? (
              <Empty Icon={GraduationCap} title="Aucun cours" action={<NewCourse />}>
                Creez un cours, ajoutez des exercices, puis attribuez-le a vos traders.
              </Empty>
            ) : (
              <ul className="divide-y divide-border">
                {(courses as Course[]).map((c) => (
                  <li key={c.id} className="flex items-center gap-4 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{c.title}</p>
                      {c.summary && <p className="mt-0.5 truncate text-xs text-text-muted">{c.summary}</p>}
                    </div>
                    <Badge tone={c.status === 'published' ? 'success' : 'neutral'}>
                      {c.status === 'published' ? 'Publie' : 'Brouillon'}
                    </Badge>
                    <span className="shrink-0 text-xs text-text-faint tnum">
                      {Number(c.exercise_count)} exercice(s)
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {!isManager && assignments.length === 0 && (
          <Card>
            <Empty Icon={GraduationCap} title="Aucun cours pour le moment">
              Votre manager vous attribuera des cours. Ils apparaitront ici.
            </Empty>
          </Card>
        )}
      </div>
    </Shell>
  );
}