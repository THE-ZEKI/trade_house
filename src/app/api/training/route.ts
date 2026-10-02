import { asUser, queryWith } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training — ce que l'utilisateur voit du module formation
 *
 * Deux vues radicalement differentes selon le role, servies par la meme route :
 *
 *   - le MANAGER voit ses cours (brouillons compris) et le suivi de ses traders ;
 *   - le TRADER voit uniquement les cours qu'on lui a attribues, avec sa
 *     progression et les corrections recues.
 *
 * Le RLS fait la separation de son cote : une seule requete ne peut pas
 * exposer au trader un cours qui ne lui est pas attribue, meme si l'interface
 * le demandait par erreur.
 */
export async function GET() {
  try {
    const user = await requireUser();

    const data = await asUser(user.userId, async (sql) => {
      const courses = await queryWith(
        sql,
        `select c.id, c.title, c.summary, c.status, c.created_at, c.updated_at,
                u.full_name as author,
                (select count(*) from public.training_exercises e
                  where e.course_id = c.id) as exercise_count
           from public.training_courses c
           join public.users u on u.id = c.author_id
          order by c.updated_at desc`,
      );

      const assignments = await queryWith(
        sql,
        `select a.id, a.course_id, a.trader_id, a.status, a.assigned_at, a.due_at,
                a.completed_at, c.title as course_title, t.full_name as trader_name,
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
          order by a.assigned_at desc`,
      );

      return { courses, assignments };
    });

    // Le trader ne recoit QUE ses attributions, meme si la base en a rendu
    // davantage : la defense est aussi cote serveur, pas seulement en base.
    const visible = can(user, 'training.assign')
      ? data
      : {
          courses: [],
          assignments: data.assignments.filter((a) => a.trader_id === user.userId),
        };

    return jsonOk({
      role: user.role,
      courses: visible.courses,
      assignments: visible.assignments,
    });
  } catch (error) {
    return jsonError(error);
  }
}