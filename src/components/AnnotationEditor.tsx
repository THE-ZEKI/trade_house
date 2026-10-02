'use client';

import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  MousePointer2,
  ArrowUpRight,
  Circle,
  Square,
  Type,
  Pencil,
  Trash2,
  Save,
  Loader2,
  AlertCircle,
  X,
} from 'lucide-react';

/**
 * Editeur d'annotations sur une capture (RG-46).
 *
 * L'image d'origine n'est JAMAIS modifiee : on superpose une couche SVG, et
 * chaque forme est enregistree separement en coordonnees normalisees (0..1).
 * Deux consequences utiles :
 *
 *   - le meme dessin se rejoue fidelement a une autre taille d'affichage, ou
 *     sur un zoom, sans degradation ;
 *   - on peut annuler une annotation sans avoir a recharger l'image.
 *
 * Le dessin se fait en SVG et non sur un <canvas> : chaque forme reste un
 * element du DOM, donc selectionnable et supprimable individuellement.
 */

type Shape = 'arrow' | 'circle' | 'rectangle' | 'text' | 'freehand';

export type Annotation = {
  id: string;
  shape: Shape;
  data: Record<string, unknown>;
  correction_id: string | null;
  created_at: string;
  author?: string | null;
};

type Draft = {
  tool: Shape;
  start: { x: number; y: number } | null;
  points: { x: number; y: number }[];
  text: string;
};

const TOOLS: { tool: Shape; label: string; Icon: typeof ArrowUpRight }[] = [
  { tool: 'arrow', label: 'Fleche', Icon: ArrowUpRight },
  { tool: 'rectangle', label: 'Rectangle', Icon: Square },
  { tool: 'circle', label: 'Cercle', Icon: Circle },
  { tool: 'text', label: 'Texte', Icon: Type },
  { tool: 'freehand', label: 'Main levee', Icon: Pencil },
];

const COLORS = ['#e11d48', '#f59e0b', '#0ea5e9', '#16a34a', '#7c3aed'];

export default function AnnotationEditor({
  fileId,
  fileName,
  mimeType,
  initial,
  canAnnotate,
}: {
  fileId: string;
  fileName: string;
  mimeType: string;
  initial: Annotation[];
  canAnnotate: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [draft, setDraft] = useState<Draft>({ tool: 'arrow', start: null, points: [], text: '' });
  const [pendingText, setPendingText] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Un PDF ne peut pas etre annote directement : on ne peut pas y poser une
  // forme au pixel pres sans le rasteriser. On le dit plutot que d'afficher
  // un canevas qui ne dessinerait rien.
  const isImage = mimeType.startsWith('image/');

  function toLocal(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!canAnnotate) return;
    const p = toLocal(e);
    setSelected(null);
    if (draft.tool === 'text') {
      setPendingText(p);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraft({ ...draft, start: p, points: [p] });
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!draft.start || !canAnnotate) return;
    const p = toLocal(e);
    // La main levee accumule les points ; les autres formes n'ont besoin que
    // de leur point d'arrivee, recalculer 60 fois par seconde le rectangle
    // complet n'aurait aucun effet visible.
    setDraft((d) =>
      d.tool === 'freehand' ? { ...d, points: [...d.points, p] } : { ...d, start: d.start, points: [p] },
    );
  }

  function onPointerUp() {
    if (!draft.start || !canAnnotate) return;
    void save(draft);
    setDraft({ tool: draft.tool, start: null, points: [], text: '' });
  }

  async function save(d: Draft) {
    if (!d.start || d.points.length === 0) return;
    const start = d.start;
    const end = d.points[d.points.length - 1];

    const data: Record<string, unknown> = { x: start.x, y: start.y, color };
    if (d.tool === 'arrow' || d.tool === 'rectangle' || d.tool === 'circle') {
      const w = Math.abs(end.x - start.x);
      const h = Math.abs(end.y - start.y);
      // Une forme d'aire nulle est invisible : elle ne pourrait etre ni vue ni
      // corrigee ensuite, et la base la refuserait (controle w/h > 0).
      if (w < 0.01 || h < 0.01) return;
      data.w = w;
      data.h = h;
    } else if (d.tool === 'freehand') {
      if (d.points.length < 2) return;
      data.points = d.points.map((p) => [p.x, p.y]);
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/files/${fileId}/annotations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shape: d.tool, data }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || payload?.error) {
        setError(payload?.error?.message ?? 'Annotation refusee');
        return;
      }
      setAnnotations((p) => [...p, payload.annotation]);
    } catch {
      setError('Annotation impossible : connexion interrompue');
    } finally {
      setBusy(false);
    }
  }

  async function saveText(text: string) {
    if (!pendingText) return;
    const trimmed = text.trim();
    if (trimmed) {
      await save({ tool: 'text', start: pendingText, points: [pendingText], text: trimmed });
    }
    setPendingText(null);
    setDraft((d) => ({ ...d, text: '' }));
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/files/${fileId}/annotations/${id}`, { method: 'DELETE' });
      const payload = await res.json().catch(() => null);
      if (!res.ok || payload?.error) {
        setError(payload?.error?.message ?? 'Suppression refusee');
        return;
      }
      setAnnotations((p) => p.filter((a) => a.id !== id));
      setSelected(null);
    } catch {
      setError('Suppression impossible : connexion interrompue');
    } finally {
      setBusy(false);
    }
  }

  if (!isImage) {
    return (
      <div className="rounded-[10px] border border-border bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <span className="min-w-0 truncate text-sm font-semibold">{fileName}</span>
          <a href={`/api/reports/files/${fileId}`} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-accent hover:underline">
            Ouvrir le PDF
          </a>
        </div>
        <p className="px-4 py-6 text-center text-sm text-text-muted">
          L edition d annotations s applique aux captures d ecran. Pour un PDF, ouvrez le document et
          utilisez le bouton de partage mis en place par votre lecteur.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="min-w-0 truncate text-sm font-semibold">{fileName}</span>
        <div className="flex items-center gap-2">
          {annotations.length > 0 && (
            <span className="text-xs text-text-faint">
              {annotations.length} annotation{annotations.length > 1 ? 's' : ''}
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-2.5 text-xs font-semibold text-sky-700 hover:bg-sky-50"
          >
            <MousePointer2 className="h-3.5 w-3.5" strokeWidth={2.2} />
            {open ? 'Masquer' : 'Annoter'}
          </button>
        </div>
      </div>

      {open && canAnnotate && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-alt px-4 py-2.5">
          {TOOLS.map(({ tool, label, Icon }) => (
            <button
              key={tool}
              type="button"
              onClick={() => setDraft({ tool, start: null, points: [], text: '' })}
              aria-pressed={draft.tool === tool}
              title={label}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors ${
                draft.tool === tool
                  ? 'border-sky-500 bg-sky-500 text-white'
                  : 'border-border bg-white text-text-muted hover:bg-sky-50'
              }`}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
          <span className="mx-1 h-6 w-px bg-border" />
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Couleur ${c}`}
              aria-pressed={color === c}
              className={`h-6 w-6 rounded-pill border-2 ${color === c ? 'border-text' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}

      {error && (
        <p className="flex items-center gap-2 border-b border-danger-bd bg-danger-bg px-4 py-2 text-xs text-danger-fg">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          {error}
        </p>
      )}

      <div className="relative bg-surface-alt">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/reports/files/${fileId}`} alt={fileName} className="block w-full select-none" draggable={false} />
        <svg
          ref={svgRef}
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          className={`absolute inset-0 h-full w-full ${open && canAnnotate ? 'cursor-crosshair' : 'pointer-events-none'}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {annotations.map((a) => (
            <ShapeView
              key={a.id}
              annotation={a}
              selectable={Boolean(open && canAnnotate)}
              active={selected === a.id}
              onSelect={() => setSelected(a.id)}
            />
          ))}
          {draft.start && draft.points.length > 0 && <DraftView draft={draft} color={color} />}
        </svg>

        {busy && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-pill bg-white/90 px-3 py-1.5 text-xs font-semibold text-sky-700 shadow-sm">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Enregistrement
          </span>
        )}
      </div>

      {selected && canAnnotate && (
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
          <span className="text-xs text-text-muted">Annotation selectionnee</span>
          <button
            type="button"
            onClick={() => remove(selected)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-danger-bd bg-danger-bg px-2.5 text-xs font-semibold text-danger-fg"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} /> Supprimer
          </button>
        </div>
      )}

      {pendingText && (
        <div className="border-t border-border bg-white px-4 py-3">
          <label className="block text-xs font-semibold text-text-muted" htmlFor={`txt-${fileId}`}>
            Texte de l annotation
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id={`txt-${fileId}`}
              autoFocus
              value={draft.text}
              onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveText(draft.text);
                if (e.key === 'Escape') setPendingText(null);
              }}
              placeholder="Ce qu il faut corriger sur la capture"
              className="h-10 min-w-0 flex-1 rounded-[10px] border border-border-strong px-3 text-sm outline-none focus:border-sky-400"
            />
            <button
              type="button"
              onClick={() => void saveText(draft.text)}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] bg-sky-500 px-3 text-sm font-semibold text-white hover:bg-sky-600"
            >
              <Save className="h-4 w-4" strokeWidth={2.2} /> Enregistrer
            </button>
            <button
              type="button"
              onClick={() => setPendingText(null)}
              aria-label="Annuler"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-border text-text-faint hover:bg-surface-alt"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Relecture seule : un trader voit ce que l encadrement a dessine. */}
      {!canAnnotate && annotations.length > 0 && (
        <ul className="divide-y divide-border border-t border-border">
          {annotations.map((a) => (
            <li key={a.id} className="px-4 py-2.5 text-sm">
              <span
                className="mr-2 inline-block h-2.5 w-2.5 rounded-pill align-middle"
                style={{ backgroundColor: String(a.data.color ?? '#e11d48') }}
              />
              {typeof a.data.text === 'string' ? a.data.text : a.shape}
              {a.author && <span className="ml-2 text-xs text-text-faint">— {a.author}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Convertit une coordonnee normalisee (0..1) en unites du viewBox (0..1000). */
const V = 1000;
const px = (v: unknown) => Number(v ?? 0) * V;

/**
 * Rendu d une forme enregistree.
 *
 * La zone cliquable est plus large que le trait lui-meme : un trait de 6 px a
 * cette echelle est practically impossible a attraper au pointeur.
 */
function ShapeView({
  annotation,
  selectable,
  active,
  onSelect,
}: {
  annotation: Annotation;
  selectable: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  const d = annotation.data;
  const color = String(d.color ?? '#e11d48');
  const x = px(d.x);
  const y = px(d.y);
  const w = px(d.w);
  const h = px(d.h);
  const stroke = active ? 12 : 7;
  const hit = { fill: 'transparent', stroke: 'transparent', strokeWidth: 28 };

  const common = {
    stroke: color,
    strokeWidth: stroke,
    fill: 'none',
    vectorEffect: 'non-scaling-stroke' as const,
  };

  let body: ReactNode = null;
  if (annotation.shape === 'rectangle') {
    body = <rect x={x} y={y} width={w} height={h} rx={6} {...common} />;
  } else if (annotation.shape === 'circle') {
    body = <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />;
  } else if (annotation.shape === 'arrow') {
    // La pointe est tracee a la main a partir du vecteur, plutot qu'avec un
    // <marker> : un marqueur se dimensionne avec le viewBox etvectionne donc
    // de facon inattendue des que l'image n'a pas un ratio carre.
    const cx = x + w;
    const cy = y + h;
    const angle = Math.atan2(h, w);
    const size = 34;
    const a1 = [cx - size * Math.cos(angle - 0.42), cy - size * Math.sin(angle - 0.42)];
    const a2 = [cx - size * Math.cos(angle + 0.42), cy - size * Math.sin(angle + 0.42)];
    body = (
      <g>
        <line x1={x} y1={y} x2={cx} y2={cy} {...common} />
        <polyline
          points={`${a1[0]},${a1[1]} ${cx},${cy} ${a2[0]},${a2[1]}`}
          {...common}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    );
  } else if (annotation.shape === 'freehand') {
    const pts = Array.isArray(d.points) ? (d.points as [number, number][]) : [];
    body = (
      <polyline
        points={pts.map(([a, b]) => `${px(a)},${px(b)}`).join(' ')}
        {...common}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  } else {
    body = (
      <text
        x={x}
        y={y}
        fill={color}
        fontSize={34}
        fontWeight={700}
        stroke="white"
        strokeWidth={6}
        paintOrder="stroke"
        style={{ paintOrder: 'stroke' }}
      >
        {String(d.text ?? '')}
      </text>
    );
  }

  return (
    <g
      onPointerDown={selectable ? (e) => { e.stopPropagation(); onSelect(); } : undefined}
      style={{ cursor: selectable ? 'pointer' : 'default' }}
    >
      {body}
      {selectable && (
        <rect
          x={x - 14}
          y={y - 14}
          width={w + 28 || 28}
          height={h + 28 || 28}
          {...hit}
        />
      )}
    </g>
  );
}

/** Previsualisation de la forme en cours de tracé. */
function DraftView({ draft, color }: { draft: Draft; color: string }) {
  const start = draft.start!;
  const end = draft.points[draft.points.length - 1];
  const x = px(start.x);
  const y = px(start.y);
  const w = px(Math.abs(end.x - start.x));
  const h = px(Math.abs(end.y - start.y));
  const common = {
    stroke: color,
    strokeWidth: 7,
    fill: 'none',
    strokeDasharray: '14 10',
    vectorEffect: 'non-scaling-stroke' as const,
  };

  if (draft.tool === 'rectangle') return <rect x={x} y={y} width={w} height={h} rx={6} {...common} />;
  if (draft.tool === 'circle') return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />;
  if (draft.tool === 'arrow') return <line x1={x} y1={y} x2={x + w} y2={y + h} {...common} />;
  if (draft.tool === 'freehand') {
    return (
      <polyline
        points={draft.points.map((p) => `${px(p.x)},${px(p.y)}`).join(' ')}
        {...common}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
  return null;
}