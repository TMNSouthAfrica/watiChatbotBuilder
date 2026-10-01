// Pulls the vector shapes, text and images out of one PDF page using pdf.js,
// in page coordinates (origin top-left, y down). Canva exports diagrams as
// real vector data, so boxes, lines and their colours are all recoverable.

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PdfShape {
  /** "#rrggbb" fill colour, if the path is filled. */
  fill: string | null;
  /** "#rrggbb" stroke colour, if the path is stroked. */
  stroke: string | null;
  /** Each subpath as a list of points (curves reduced to their end points). */
  subpaths: Point[][];
  closed: boolean;
  bbox: Rect;
}

export interface PdfText {
  str: string;
  bbox: Rect;
  /** Font size in page units. */
  size: number;
}

export interface PdfPageContent {
  width: number;
  height: number;
  shapes: PdfShape[];
  texts: PdfText[];
  images: Rect[];
}

// Minimal structural types for the parts of pdf.js used here, so this module
// works with both the browser and the Node ("legacy") builds.
interface PdfJsLike {
  OPS: Record<string, number>;
}

interface PdfPageLike {
  view: number[];
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  getTextContent(): Promise<{ items: unknown[] }>;
}

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  // Returns n · m — applies m first, then n (PDF "cm" concatenation order).
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function apply(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

// DrawOPS codes inside constructPath's packed path data (pdf.js >= 5).
const DRAW_MOVE = 0;
const DRAW_LINE = 1;
const DRAW_CURVE = 2;
const DRAW_QUAD = 3;
const DRAW_CLOSE = 4;

function normaliseColor(c: unknown): string | null {
  if (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  return null;
}

export function bboxOf(points: Point[]): Rect {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

export async function extractPage(pdfjs: PdfJsLike, page: PdfPageLike): Promise<PdfPageContent> {
  const OPS = pdfjs.OPS;
  const [vx0, vy0, vx1, vy1] = page.view;
  const height = vy1 - vy0;
  // PDF space (y up) → page space (y down).
  const toPage: Matrix = [1, 0, 0, -1, -vx0, vy1];

  const paintOps = new Map<number, { fill: boolean; stroke: boolean }>([
    [OPS.fill, { fill: true, stroke: false }],
    [OPS.eoFill, { fill: true, stroke: false }],
    [OPS.stroke, { fill: false, stroke: true }],
    [OPS.closeStroke, { fill: false, stroke: true }],
    [OPS.fillStroke, { fill: true, stroke: true }],
    [OPS.eoFillStroke, { fill: true, stroke: true }],
    [OPS.closeFillStroke, { fill: true, stroke: true }],
    [OPS.closeEOFillStroke, { fill: true, stroke: true }],
  ]);

  const { fnArray, argsArray } = await page.getOperatorList();
  const shapes: PdfShape[] = [];
  const images: Rect[] = [];

  let ctm: Matrix = IDENTITY;
  let fill: string | null = "#000000";
  let stroke: string | null = "#000000";
  const stack: { ctm: Matrix; fill: string | null; stroke: string | null }[] = [];

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[];
    if (fn === OPS.save) {
      stack.push({ ctm, fill, stroke });
    } else if (fn === OPS.restore) {
      const s = stack.pop();
      if (s) ({ ctm, fill, stroke } = s);
    } else if (fn === OPS.transform) {
      ctm = multiply(args as unknown as Matrix, ctm);
    } else if (fn === OPS.paintFormXObjectBegin) {
      stack.push({ ctm, fill, stroke });
      const m = args[0] as number[] | null;
      if (m && m.length === 6) ctm = multiply(m as unknown as Matrix, ctm);
    } else if (fn === OPS.paintFormXObjectEnd) {
      const s = stack.pop();
      if (s) ({ ctm, fill, stroke } = s);
    } else if (fn === OPS.setFillRGBColor) {
      fill = normaliseColor(args[0]);
    } else if (fn === OPS.setStrokeRGBColor) {
      stroke = normaliseColor(args[0]);
    } else if (fn === OPS.setFillColorN) {
      fill = normaliseColor(args[0]);
    } else if (fn === OPS.setStrokeColorN) {
      stroke = normaliseColor(args[0]);
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      // Images are drawn into the unit square of the current matrix.
      const m = multiply(ctm, toPage);
      images.push(bboxOf([apply(m, 0, 0), apply(m, 1, 0), apply(m, 0, 1), apply(m, 1, 1)]));
    } else if (fn === OPS.constructPath) {
      const paint = paintOps.get(args[0] as number);
      if (!paint) continue; // clipping paths etc.
      const data = (args[1] as ArrayLike<number>[] | undefined)?.[0];
      if (!data) continue;
      const m = multiply(ctm, toPage);
      const subpaths: Point[][] = [];
      let current: Point[] = [];
      let closed = false;
      for (let k = 0; k < data.length; ) {
        const op = data[k++];
        if (op === DRAW_MOVE) {
          if (current.length) subpaths.push(current);
          current = [apply(m, data[k++], data[k++])];
        } else if (op === DRAW_LINE) {
          current.push(apply(m, data[k++], data[k++]));
        } else if (op === DRAW_CURVE) {
          k += 4;
          current.push(apply(m, data[k++], data[k++]));
        } else if (op === DRAW_QUAD) {
          k += 2;
          current.push(apply(m, data[k++], data[k++]));
        } else if (op === DRAW_CLOSE) {
          closed = true;
          if (current.length) current.push({ ...current[0] });
        } else {
          break;
        }
      }
      if (current.length) subpaths.push(current);
      const all = subpaths.flat();
      if (all.length < 2) continue;
      shapes.push({
        fill: paint.fill ? fill : null,
        stroke: paint.stroke ? stroke : null,
        subpaths,
        closed: closed || paint.fill,
        bbox: bboxOf(all),
      });
    }
  }

  const { items } = await page.getTextContent();
  const texts: PdfText[] = [];
  for (const raw of items) {
    const item = raw as { str?: string; transform?: number[]; width?: number; height?: number };
    if (!item.str || !item.str.trim() || !item.transform) continue;
    const [a, b, , d, e, f] = item.transform;
    const size = Math.hypot(a, b) || Math.abs(d) || 1;
    const x = e - vx0;
    const baseline = vy1 - f;
    texts.push({
      str: item.str,
      size,
      bbox: { x0: x, y0: baseline - size * 0.8, x1: x + (item.width ?? 0), y1: baseline + size * 0.2 },
    });
  }

  return { width: vx1 - vx0, height, shapes, texts, images };
}
