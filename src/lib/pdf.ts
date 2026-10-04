import { chargerPdfKit } from './pdfkit-loader';
import { getFile } from './storage';
// COLORS, clean, EMBEDDABLE, line, section, keyValue et ensureSpace vivent
// dans pdf-kit : la formation les reutilise, et les dupliquer les ferait
// diverger au premier correctif.
import { COLORS, clean, line, section, keyValue, ensureSpace, EMBEDDABLE } from './pdf-kit';

/**
 * Generation du PDF d'un rapport (D6).
 *
 * Pourquoi PDFKit et non une impression HTML vers PDF : aucune dependance a
 * un navigateur, aucun Chromium a deployer (~400 Mo). Le rendu est
 * deterministe et tient dans une fonction serverless.
 *
 * Polices : Helvetica est une police integree, en encodage WinAnsi, qui couvre
 * le francais (accents, guillemets). Aucune police a embarquer.
 */

export type PdfReport = {
  report: Record<string, unknown>;
  trader: { full_name: string; email: string } | null;
  reviewer: { full_name: string } | null;
  versions: { version_number: number; submitted_at: string; submitted_by_name: string | null }[];
  corrections: {
    target_type: string; target_field: string | null; message: string;
    severity: string; status: string; author_name: string; created_at: string;
  }[];
  files: { id: string; original_name: string; mime_type: string; storage_path: string }[];
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', submitted: 'Soumis', in_review: 'En revision',
  correction_requested: 'Correction demandee', resubmitted: 'Resoumis',
  validated: 'Valide', dismissed: 'Rejete', declared: 'Declare',
};

const SEVERITY_LABELS: Record<string, string> = {
  mandatory: 'Obligatoire', suggestion: 'Suggestion',
};


const CORRECTION_STATUS_LABELS: Record<string, string> = {
  open: 'Ouvert', done: 'Traite', rejected: 'Rejete par le trader', dropped: 'Abandonne',
};
export async function renderReportPdf(data: PdfReport): Promise<Buffer> {
  // via pdfkit-loader : l'import direct de pdfkit echouait sur le bundler de
  // Vercel (« Cannot find module '#standard-fonts/Helvetica' »). C'est le seul
  // endroit du projet ou le constructeur est obtenu sans passer par newDoc,
  // parce que ce document a ses propres options de mise en page.
  const PDFDocument = await chargerPdfKit();
  const doc = new PDFDocument({
    size: 'A4',
    margin: 45,
    info: {
      Title: `Rapport de seance ${clean(data.report.session_date)}`,
      Author: 'Trade House',
      Subject: 'Rapport de trading',
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const r = data.report;

  // --- en-tete -----------------------------------------------------------
  doc.fillColor(COLORS.accent).fontSize(18).font('Helvetica-Bold').text('Trade House');
  doc.moveDown(0.2);
  doc.fillColor(COLORS.text).fontSize(13).font('Helvetica')
    .text(`Rapport de seance du ${clean(r.session_date)}`);

  const statut = STATUS_LABELS[String(r.status)] ?? String(r.status);
  doc.fillColor(r.status === 'validated' ? COLORS.good : COLORS.text).fontSize(10)
    .text(`Statut : ${statut}${r.is_late ? '  (hors delai)' : ''}`);

  doc.moveDown(0.6);
  doc.fontSize(9).fillColor(COLORS.muted)
    .text(`Trader : ${clean(data.trader?.full_name)}  ·  Version ${clean(r.current_version)}`);
  if (data.reviewer) doc.text(`Revu par : ${clean(data.reviewer.full_name)}`);
  doc.moveDown(0.8);
  line(doc);

  // --- champs D1 ---------------------------------------------------------
  section(doc, 'Contenu du rapport');
  const emotions = Array.isArray(r.emotions) ? r.emotions.join(', ') : '';
  const rows: [string, string][] = [
    ['Instrument', clean(r.instrument, 40)],
    ['Resultat', `${clean(r.result_type)}${r.result_amount !== null ? ` (${clean(r.result_amount)})` : ''}`],
    ['Strategie', clean(r.strategy, 120)],
    ['Trades', clean(r.nb_trades, 20)],
    ['Plan respecte', r.plan_respected === null ? '' : r.plan_respected ? 'Oui' : 'Non'],
    ['R:R prevu / realise', `${clean(r.rr_planned)} / ${clean(r.rr_realized)}`],
    ['Emotions', clean(emotions, 120)],
  ];
  for (const [label, value] of rows) {
    if (value) keyValue(doc, label, value);
  }

  for (const [key, label] of [
    ['highlights', 'Points forts'], ['mistakes', 'Erreurs'], ['notes', 'Notes'],
  ] as const) {
    const value = clean(r[key], 2000);
    if (!value) continue;
    doc.moveDown(0.5);
    section(doc, label);
    doc.fontSize(9.5).fillColor(COLORS.text).font('Helvetica').text(value, { align: 'left' });
  }

  const emotionNote = clean(r.emotions_note, 1000);
  if (emotionNote) {
    doc.moveDown(0.5);
    section(doc, 'Note emotionnelle');
    doc.fontSize(9.5).fillColor(COLORS.text).text(emotionNote);
  }

  if (r.is_no_trade) {
    doc.moveDown(0.5);
    section(doc, 'Jour sans trade');
    doc.fontSize(9.5).fillColor(COLORS.text)
      .text(clean(r.no_trade_reason, 500) || 'Motif non precise.');
  }

  // --- historique des versions (E6) -------------------------------------
  doc.moveDown(0.8);
  section(doc, 'Historique des versions');
  if (data.versions.length === 0) {
    doc.fontSize(9.5).fillColor(COLORS.muted).text('Aucune version soumise.');
  }
  for (const v of data.versions) {
    doc.fontSize(9.5).fillColor(COLORS.text)
      .text(`Version ${v.version_number} — ${new Date(v.submitted_at).toLocaleString('fr-FR')}`, {
        continued: true,
      })
      .fillColor(COLORS.muted)
      .text(v.submitted_by_name ? `  (${clean(v.submitted_by_name)})` : '');
  }

  // --- correctifs (E1-E3) ------------------------------------------------
  doc.moveDown(0.8);
  section(doc, `Correctifs (${data.corrections.length})`);
  if (data.corrections.length === 0) {
    doc.fontSize(9.5).fillColor(COLORS.muted).text('Aucun correctif.');
  }
  for (const c of data.corrections) {
    ensureSpace(doc, 90);
    const cible =
      c.target_type === 'field' ? `champ « ${clean(c.target_field)} »`
        : c.target_type === 'file' ? 'piece jointe' : 'rapport entier';
    doc.fontSize(9.5)
      .fillColor(c.severity === 'mandatory' ? COLORS.bad : COLORS.warn)
      .font('Helvetica-Bold')
      .text(`[${SEVERITY_LABELS[c.severity] ?? c.severity}] ${cible}`, { continued: true })
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .text(`  —  ${CORRECTION_STATUS_LABELS[c.status] ?? c.status}`);
    doc.fillColor(COLORS.text).fontSize(9).text(clean(c.message, 800), { indent: 10 });
    doc.fillColor(COLORS.muted).fontSize(8)
      .text(`${clean(c.author_name)}, le ${new Date(c.created_at).toLocaleDateString('fr-FR')}`, {
        indent: 10,
      });
    doc.moveDown(0.4);
  }

  // --- pieces jointes ----------------------------------------------------
  doc.moveDown(0.8);
  section(doc, `Pieces jointes (${data.files.length})`);
  for (const f of data.files) {
    doc.fontSize(9).fillColor(COLORS.text)
      .text(`• ${clean(f.original_name, 80)}`, { continued: true })
      .fillColor(COLORS.muted)
      .text(`  (${clean(f.mime_type)})`);

    if (!EMBEDDABLE.has(f.mime_type)) continue;
    try {
      const buf = await getFile(f.storage_path);
      ensureSpace(doc, 200);
      doc.moveDown(0.3);
      // hauteur bornee : une capture tres haute deborderait sur la page suivante
      doc.image(buf, { fit: [500, 340] });
    } catch {
      doc.fillColor(COLORS.muted).fontSize(8).text('  (image indisponible)');
    }
  }

  line(doc);
  doc.fontSize(7.5).fillColor(COLORS.muted).text(
    `Document genere par Trade House le ${new Date().toLocaleString('fr-FR')}. Confidentiel.`,
    { align: 'center' },
  );

  doc.end();
  return done;
}
