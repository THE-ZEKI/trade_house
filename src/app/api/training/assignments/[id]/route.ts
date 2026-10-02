import { asUser, queryWith, callApp } from '@/lib/db';
import { ALLOWED_MIME, sniffMime, putFile, deleteFile } from '@/lib/storage';
import { jsonOk, jsonError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** RG-32 : 10 Mo par capture, aligne sur les pieces jointes de rapport. */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * GET /api/training/assignments/:id — le cours, ses exercices et la copie du trader
 *
 * Une seule route sert les deux roles, mais la reponse n'est pas la meme :
 *
 *   - le MANAGER voit la progression de chaque trader, ses reponses et l'etat des
 *     corrections, sur TOUS les exercices du cours ;
 *   - le TRADER voit uniquement SES reponses, et la correction de chaque exercice
 *     lorsqu'elle existe.
 *
 * Melanger les deux serait commode et faux : un trader verrait le travail de ses
 * collegues, et la correction d'un exercice qu'il n'a pas encore rendu.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const isManager = can(user, 'training.review');

    const data = await asUser(user.userId, async (sql) => {
      const assignment = await queryWith(
        sql,
        `select a.id, a.course_id, a.trader_id, a.status, a.assigned_at, a.due_at,
                a.completed_at, c.title, c.summary, c.content, c.status as course_status
           from public.training_assignments a
           join public.training_courses c on c.id = a.course_id
          where a.id = $1::uuid`,
        [id],
      );

      const exercises = await queryWith(
        sql,
        `select e.id, e.position, e.title, e.prompt, e.kind, e.options,
                case when app.current_user_role() <> 'trader'
                     then e.explanation else null end as explanation,
                s.id as submission_id, s.answer, s.answer_key, s.submitted_at,
                r.score, r.comment as review_comment, r.reviewed_at,
                ru.full_name as reviewer
           from public.training_exercises e
           left join public.training_submissions s
                  on s.exercise_id = e.id and s.assignment_id = $1::uuid
           left join public.training_reviews r on r.submission_id = s.id
           left join public.users ru on ru.id = r.reviewer_id
          where e.course_id = (select course_id from public.training_assignments where id = $1::uuid)
          order by e.position`,
        [id],
      );

      return { assignment: assignment[0] ?? null, exercises };
    });

    if (!data.assignment) {
      throw new AppError('NOT_FOUND', 'Parcours introuvable', { status: 404 });
    }

    // Defense cote serveur, en plus du RLS : si une requete renvoyait par
    // megarde une attribution qui n'est pas la sienne, le trader ne verrait
    // quand meme rien.
    if (!isManager && data.assignment.trader_id !== user.userId) {
      throw new AppError('FORBIDDEN', 'Ce parcours ne vous appartient pas', { status: 403 });
    }

    return jsonOk({ ...data, viewerRole: user.role });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * POST /api/training/assignments/:id — rendre un exercice, captures comprises
 *
 * Accepte deux formes :
 *   - application/json (reponse seule) ;
 *   - multipart/form-data, avec `files` en plus de la reponse.
 *
 * Le multipart est le cas normal : un travail de trading se prouve par une
 * capture, et demander au trader de valider puis d aller chercher un bouton
 * « joindre » serait deux gestes pour une seule intention. La soumission et ses
 * fichiers partent donc ensemble.
 *
 * Les captures sont ecrites dans le stockage prive (RG-33) puis rattachees par
 * app.attach_training_file, qui refuse qu'un manager rattache une capture a la
 * place du trader. Le tout dans la transaction ouverte par asUser : pas de
 * reponse sans fichier, ni de fichier sans reponse.
 */
export async function POST(request: Request, { params }: Params) {
  // Declare hors du try : le catch doit pouvoir nettoyer des fichiers ecrits
  // avant un echec. Declare dedans, il serait hors de portee au moment du
  // rollback — et les captures resteraient orphelines sur le disque.
  const stored: { path: string }[] = [];

  try {
    const user = await requireUser();
    if (!can(user, 'training.submit')) {
      throw new AppError('FORBIDDEN', 'Seul un trader rend un exercice', { status: 403 });
    }
    const { id } = await params;

    const contentType = request.headers.get('content-type') ?? '';
    const multipart = contentType.includes('multipart/form-data');

    const read = async () => {
      if (multipart) {
        const form = await request.formData();
        const asText = (k: string) => {
          const v = form.get(k);
          return typeof v === 'string' ? v : null;
        };
        return {
          exerciseId: asText('exerciseId'),
          answer: asText('answer'),
          answerKey: asText('answerKey'),
          files: form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0),
        };
      }
      const body = (await request.json().catch(() => null)) as {
        exerciseId?: string;
        answer?: string;
        answerKey?: string;
      } | null;
      return { exerciseId: body?.exerciseId, answer: body?.answer, answerKey: body?.answerKey, files: [] as File[] };
    };

    const payload = await read();
    if (!payload.exerciseId) {
      throw new AppError('VALIDATION', 'Exercice manquant', { status: 422 });
    }

    // On ecrit les fichiers dans la boucle ci-dessous ; ils sont memorises ici pour
    // que le catch puisse les supprimer si la transaction echoue.

    const submissionId = await asUser(user.userId, async (sql) => {
      const sid = await callApp<string>(sql, 'submit_training_exercise', [
        id,
        payload.exerciseId,
        payload.answer?.trim() ? payload.answer.trim() : null,
        payload.answerKey ?? null,
      ]);

      for (const file of payload.files) {
        if (!ALLOWED_MIME[file.type]) {
          throw new AppError('VALIDATION', `Format non autorise : ${file.name}`, { status: 422 });
        }
        if (file.size > MAX_BYTES) {
          throw new AppError('VALIDATION', `${file.name} depasse ${MAX_BYTES / 1048576} Mo`, { status: 422 });
        }
        const content = Buffer.from(await file.arrayBuffer());
        // Meme defense que les pieces jointes de rapport : un .png contenant du
        // HTML passerait sinon un controle base sur le seul Content-Type, que le
        // client controle.
        const realMime = sniffMime(content);
        if (realMime !== file.type) {
          throw new AppError('VALIDATION', `Le contenu de ${file.name} ne correspond pas a son type`, {
            status: 422,
          });
        }

        const path = await putFile(user.userId, realMime, content);
        stored.push({ path });

        await callApp(sql, 'attach_training_file', [sid, path, file.name || 'capture', realMime, content.length]);
      }

      return sid;
    });

    return jsonOk({ submission: { id: submissionId }, files: stored.length }, 201);
  } catch (error) {
    // Fichiers ecrits mais echec de la transaction : ils seraient orphelins.
    for (const s of stored) await deleteFile(s.path).catch(() => {});
    return jsonError(error);
  }
}

/**
 * PUT /api/training/assignments/:id — deux actions selon le corps
 *
 *   { action: 'resubmit', exerciseId, answer, answerKey }  -> nouvelle tentative
 *   { action: 'review', submissionId, score, comment }      -> correction
 *
 * Un fichier de route Next.js n'exporte qu'un seul PUT : deux fonctions de meme
 * nom ne compileraient pas. La distinction se fait donc sur `action`, ce qui
 * evite aussi d'imaginer deux URL pour un meme objet « envoi de l'exercice ».
 */
export async function PUT(request: Request, { params }: Params) {
  try {
    const user = await requireUser();

    // Le meme corps que POST : JSON, ou multipart quand des captures sont
  // jointes — la lecture est factorisee pour que les deux verbes ne puissent
  // pas diverger sur ce qui est accepte.
    const isMultipart = (request.headers.get('content-type') ?? '').includes('multipart/form-data');
    const form = isMultipart ? await request.formData() : null;
    const field = (k: string) => {
      if (form) {
        const v = form.get(k);
        return typeof v === 'string' ? v : undefined;
      }
      return undefined;
    };

    let body = {
      action: field('action'),
      exerciseId: field('exerciseId'),
      answer: field('answer'),
      answerKey: field('answerKey'),
      submissionId: field('submissionId'),
      score: field('score'),
      comment: field('comment'),
    } as {
      action?: string;
      exerciseId?: string;
      answer?: string;
      answerKey?: string;
      submissionId?: string;
      score?: string;
      comment?: string;
    };

    if (!isMultipart) {
      body = ((await request.json().catch(() => null)) as typeof body) ?? body;
    }

    // --- le trader rend a nouveau, apres une correction -------------------
    if (body?.action === 'resubmit') {
      if (!can(user, 'training.submit')) {
        throw new AppError('FORBIDDEN', 'Seul un trader rend un exercice', { status: 403 });
      }
      if (!body.exerciseId) {
        throw new AppError('VALIDATION', 'Exercice manquant', { status: 422 });
      }
      const { id } = await params;
      const files = form ? form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0) : [];
      const paths: string[] = [];

      try {
        const submissionId = await asUser(user.userId, async (sql) => {
          const sid = await callApp<string>(sql, 'resubmit_training_exercise', [
            id,
            body.exerciseId!,
            body.answer?.trim() ? body.answer.trim() : null,
            body.answerKey ?? null,
          ]);
          // Meme traitement que sur POST : validation du type reel puis
          // rattachement par la fonction qui refuse un auteur different.
          for (const file of files) {
            if (!ALLOWED_MIME[file.type] || file.size > MAX_BYTES) {
              throw new AppError('VALIDATION', `Fichier refuse : ${file.name}`, { status: 422 });
            }
            const content = Buffer.from(await file.arrayBuffer());
            const realMime = sniffMime(content);
            if (realMime !== file.type) {
              throw new AppError('VALIDATION', `Le contenu de ${file.name} ne correspond pas a son type`, {
                status: 422,
              });
            }
            const path = await putFile(user.userId, realMime, content);
            paths.push(path);
            await callApp(sql, 'attach_training_file', [sid, path, file.name || 'capture', realMime, content.length]);
          }
          return sid;
        });
        return jsonOk({ submission: { id: submissionId }, files: files.length }, 201);
      } catch (e) {
        for (const p of paths) await deleteFile(p).catch(() => {});
        throw e;
      }
    }

    // --- le manager corrige -------------------------------------------------
    if (!can(user, 'training.review')) {
      throw new AppError('FORBIDDEN', 'Seul un manager corrige un travail', { status: 403 });
    }
    if (!body?.submissionId) {
      throw new AppError('VALIDATION', 'Soumission manquante', { status: 422 });
    }
    // Le commentaire est obligatoire : une note seule ne dit pas QUOI corriger,
    // et le module repose precisement sur cela.
    const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
    if (!comment) {
      throw new AppError('VALIDATION', 'Le commentaire est obligatoire', { status: 422 });
    }

    // La note est facultative (un QCM peut etre corrige sans chiffrer) mais
    // bornee : hors de 0..20 elle est refusee par la base.
    let score: number | null = null;
    if (body.score !== null && body.score !== undefined && body.score !== '') {
      const parsed = Number(body.score);
      if (!Number.isFinite(parsed)) {
        throw new AppError('VALIDATION', 'Note invalide', { status: 422 });
      }
      score = parsed;
    }

    await asUser(user.userId, (sql) => callApp(sql, 'review_training', [body.submissionId, score, comment]));
    return jsonOk({ reviewed: body.submissionId });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * DELETE /api/training/assignments/:id — retirer le parcours d'un trader
 *
 * Archive, ne supprime pas : le travail rendu et sa correction restent lisibles
 * dans l'historique. Supprimer aurait efface la seule trace de ce que le
 * trader a suivi.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    if (!can(user, 'training.review')) {
      throw new AppError('FORBIDDEN', 'Seul un encadrement retire un parcours', { status: 403 });
    }
    const { id } = await params;

    await asUser(user.userId, (sql) => callApp(sql, 'unassign_training', [id]));
    return jsonOk({ archived: id });
  } catch (error) {
    return jsonError(error);
  }
}
