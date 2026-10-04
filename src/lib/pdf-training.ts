import { getFile } from './storage';
import { COLORS, clean, line, section, keyValue, ensureSpace, EMBEDDABLE, newDoc, collect } from './pdf-kit';

/**
 * Dossier de formation PDF.
 *
 * Un SEUL document, et c'est un choix : un PDF « du cours seul » dupliquerait
 * ce qui est deja a l'ecran, et sa valeur d'archive est nulle puisque le cours
 * est versionne en base. Le dossier du trader, lui, prouve ce qui a ete fait,
 * ce qui a ete corrige et par qui — c'est ce que l'on consultera dans six mois.
 * Il n'y a donc pas deux exports a maintainir : un document, une route.
 *
 * La VERSION COURANTE d'un exercice est celle dont `attempt` est la plus elevee.
 * Les tentatives anterieures sont comptees et signalees sans etre developpees :
 * le detail qui interesse le lecteur est le travail final, pas ses brouillons.
 */

export type TrainingExerciseRow = {
  title: string;
  prompt: string;
  kind: 'written' | 'qcm';
  options: Record<string, string> | null;
  explanation: string | null;
  position: number;
  answer: string | null;
  answer_key: string | null;
  attempt: number | null;
  attempts: number;
  submitted_at: string | null;
  review_comment: string | null;
  score: string | number | null;
  reviewer: string | null;
  reviewed_at: string | null;
  files: { id: string; name: string; mime: string; storage_path?: string }[];
};

export type PdfTraining = {
  course: { title: string; summary: string | null; content: string };
  assignment: {
    status: string;
    assigned_at: string | null;
    due_at: string | null;
    completed_at: string | null;
  };
  trader: { full_name: string; email: string } | null;
  assignedBy: { full_name: string } | null;
  exercises: TrainingExerciseRow[];
};

const ASSIGNMENT_STATUS: Record<string, string> = {
  assigned: 'Attribue, non commence',
  in_progress: 'En cours',
  completed: 'Termine',
  archived: 'Archive',
};

const KIND_LABEL: Record<string, string> = { written: 'Redaction', qcm: 'QCM' };

function fmt(value: unknown): string {
  return value
    ? new Date(String(value)).toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '-';
}

export async function renderTrainingPdf(data: PdfTraining): Promise<Buffer> {
  // await obligatoire : newDoc charge pdfkit et ses polices (voir
  // pdfkit-loader.ts). C'est cette attente qui remplace l'import direct, qui
  // echouait sur le bundler de Vercel.
  const doc = await newDoc(`Dossier de formation - ${clean(data.course.title, 120)}`, 'Dossier de formation');
  const done = collect(doc);

  // --- en-tete -----------------------------------------------------------
  doc.fillColor(COLORS.accent).fontSize(18).font('Helvetica-Bold').text('Trade House');
  doc.moveDown(0.2);
  doc.fillColor(COLORS.text).fontSize(13).font('Helvetica').text(`Formation - ${clean(data.course.title, 120)}`);
  if (data.course.summary) {
    doc.fillColor(COLORS.muted).fontSize(9.5).text(clean(data.course.summary, 300));
  }

  const status = ASSIGNMENT_STATUS[data.assignment.status] ?? data.assignment.status;
  doc.moveDown(0.4);
  doc.fontSize(10)
    .fillColor(data.assignment.status === 'completed' ? COLORS.good : COLORS.text)
    .text(`Parcours : ${clean(status)}`);

  doc.moveDown(0.6);
  doc.fontSize(9).fillColor(COLORS.muted);
  keyValue(doc, 'Trader', clean(data.trader?.full_name, 120));
  doc.text(`Attribue le ${fmt(data.assignment.assigned_at)}`);
  if (data.assignment.due_at) doc.text(`Echeance : ${fmt(data.assignment.due_at)}`);
  if (data.assignment.completed_at) doc.text(`Termine le ${fmt(data.assignment.completed_at)}`);
  if (data.assignedBy) doc.text(`Par ${clean(data.assignedBy.full_name, 120)}`);
  line(doc);

  // --- le cours -----------------------------------------------------------
  section(doc, 'Le cours');
  const content = clean(data.course.content, 8000);
  doc.fontSize(9.5).fillColor(COLORS.text).text(content || 'Le contenu du cours n a pas ete renseigne.');
  line(doc);

  // --- exercices ----------------------------------------------------------
  const corrects = data.exercises.filter((e) => e.review_comment);
  const notes = data.exercises.map((e) => Number(e.score)).filter((n) => Number.isFinite(n));

  section(doc, `Exercices (${data.exercises.length})`);
  if (notes.length > 0) {
    const moyenne = notes.reduce((a, b) => a + b, 0) / notes.length;
    doc.fontSize(9.5).fillColor(COLORS.muted)
      .text(`${corrects.length} correction(s) sur ${data.exercises.length} exercices - moyenne ${moyenne.toFixed(2)}/20`);
    doc.moveDown(0.5);
  }

  if (data.exercises.length === 0) {
    doc.fontSize(9.5).fillColor(COLORS.muted).text('Aucun exercice.');
  }

  for (const ex of data.exercises) {
    ensureSpace(doc, 90);

    doc.fontSize(10).fillColor(COLORS.text).font('Helvetica-Bold')
      .text(`${ex.position}. ${clean(ex.title, 160)}   `, { continued: true })
      .fontSize(8.5).fillColor(COLORS.muted).font('Helvetica')
      .text(`(${KIND_LABEL[ex.kind] ?? ex.kind})`);
    doc.moveDown(0.2);

    doc.fontSize(9.5).fillColor(COLORS.muted).text(clean(ex.prompt, 1000));
    doc.moveDown(0.3);

    if (ex.answer || ex.answer_key) {
      let reponse = ex.answer ?? '';
      if (ex.kind === 'qcm' && ex.answer_key) {
        reponse = `${ex.answer_key.toUpperCase()}. ${ex.options?.[ex.answer_key] ?? '(proposition inconnue)'}`;
      }
      doc.fontSize(9).fillColor(COLORS.muted).font('Helvetica-Bold').text('Reponse du trader');
      doc.fontSize(9.5).fillColor(COLORS.text).font('Helvetica').text(clean(reponse, 2000) || '(vide)');
      doc.moveDown(0.2);

      if (ex.attempt && ex.attempt > 1) {
        // Le nombre de versions est signale sans les developper : le lecteur
        // veut le travail final, pas ses brouillons.
        doc.fontSize(8).fillColor(COLORS.muted)
          .text(`Version ${ex.attempt} - ${ex.attempts} tentatives au total.`);
      }
    } else {
      doc.fontSize(9.5).fillColor(COLORS.muted).text('Non rendu.');
    }

    if (ex.review_comment) {
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor(COLORS.bad).font('Helvetica-Bold')
        .text(`Correction${ex.score !== null && ex.score !== '' ? ` - ${clean(ex.score)}/20` : ''}`);
      if (ex.reviewer) {
        doc.fontSize(8.5).fillColor(COLORS.muted).text(`${clean(ex.reviewer, 120)} - ${fmt(ex.reviewed_at)}`);
      }
      doc.fontSize(9.5).fillColor(COLORS.text).font('Helvetica').text(clean(ex.review_comment, 2000));

      // L'explication pedagogique n'est transmise qu'apres correction : avant,
      // elle donnerait la reponse au trader.
      if (ex.explanation) {
        doc.moveDown(0.2);
        doc.fontSize(9).fillColor(COLORS.muted).font('Helvetica-Bold').text('Pourquoi');
        doc.fontSize(9.5).fillColor(COLORS.text).font('Helvetica').text(clean(ex.explanation, 1000));
      }
    }

    // Captures : PNG et JPEG sont incorpores, le reste est liste. Meme limite
    // que le rapport de seance - pdfkit n'embarque pas les autres formats.
    if (ex.files.length > 0) {
      doc.moveDown(0.2);
      doc.fontSize(8.5).fillColor(COLORS.muted)
        .text(`Captures : ${ex.files.map((f) => clean(f.name, 80)).join(', ')}`);
    }
    for (const f of ex.files.filter((x) => EMBEDDABLE.has(x.mime) && x.storage_path)) {
      try {
        const buf = await getFile(String(f.storage_path));
        ensureSpace(doc, 200);
        doc.image(buf, { fit: [500, 260], align: 'center' });
        doc.moveDown(0.3);
      } catch {
        // Une capture manquante ne doit pas faire echouer l'export entier : le
        // dossier reste utilisable et le nom du fichier est deja liste.
      }
    }

    line(doc);
  }

  // --- pied de page -------------------------------------------------------
  doc.fontSize(7.5).fillColor(COLORS.muted).text(
    `Document genere par Trade House le ${new Date().toLocaleString('fr-FR')}. Confidentiel.`,
    { align: 'center' },
  );

  doc.end();
  return done;
}