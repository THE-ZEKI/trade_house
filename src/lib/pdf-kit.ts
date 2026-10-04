import { chargerPdfKit } from './pdfkit-loader';

// PDFDocument n'est plus importe directement. Voir pdfkit-loader.ts : en ESM,
// sur le bundler de Vercel, cela echouait sur « Cannot find module
// '#standard-fonts/Helvetica' » des le premier glyphe. newDoc est donc async et
// attend le constructeur.

/**
 * Primitives de mise en page partagees par les exports PDF.
 *
 * Elles vivaient dans pdf.ts, qui ne produisait alors que le rapport de seance.
 * Ajouter la formation sans les extraire aurait dui soit les dupliquer — et
 * diverger au premier correctif — soit gonfler pdf.ts jusqu'a y melanger deux
 * documents sans rapport. Le meme raisonnement que pour les cours de
 * formation : le contenu vit a part, il n'est pas duplique.
 */

export const COLORS = {
  text: '#1a1a1a',
  muted: '#6b7280',
  line: '#d1d5db',
  accent: '#1d4ed8',
  warn: '#b45309',
  bad: '#b91c1c',
  good: '#15803d',
} as const;

/**
 * Les emojis n'existent pas en WinAnsi : on les retire plutot que de laisser
 * pdfkit ecrire des octets invalides. Idem pour les caracteres de controle.
 */
export function clean(value: unknown, max = 600): string {
  const s = value === null || value === undefined ? '' : String(value);
  return s
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u0000-\b\u000b\f\u000e-\u001f]/g, ' ')
    .trim()
    .slice(0, max);
}

/** Filet horizontal, a plat, entre deux sections. */
export function line(doc: PDFKit.PDFDocument) {
  doc.moveDown(0.5);
  const y = doc.y;
  doc.strokeColor(COLORS.line).lineWidth(0.5)
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .stroke();
  doc.moveDown(0.5);
}

/** Evite un titre orphelin en bas de page. */
export function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

export function section(doc: PDFKit.PDFDocument, title: string) {
  ensureSpace(doc, 40);
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor(COLORS.accent).font('Helvetica-Bold').text(title);
  doc.moveDown(0.25);
}

export function keyValue(doc: PDFKit.PDFDocument, label: string, value: string) {
  doc.fontSize(9.5).fillColor(COLORS.muted).font('Helvetica')
    .text(`${label} : `, { continued: true })
    .fillColor(COLORS.text).font('Helvetica').text(value);
}

/** Collecte les morceaux du PDF et renvoie le document assemblé. */
export function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  return new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/** pdfkit n'embarque que PNG et JPEG : le reste est liste, pas affiche. */
export const EMBEDDABLE = new Set(['image/png', 'image/jpeg']);

export async function newDoc(title: string, subject: string): Promise<PDFKit.PDFDocument> {
  const PDFDocument = await chargerPdfKit();
  return new PDFDocument({
    size: 'A4',
    margin: 45,
    info: { Title: title, Author: 'Trade House', Subject: subject },
  });
}