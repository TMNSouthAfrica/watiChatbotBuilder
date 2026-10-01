// Turns the shapes of a Canva flow diagram into an editor flow, using fixed
// rules (no AI). The rules follow the diagram style used by the team:
//
//   teal / pink outlined box ......... a message; its white pills are buttons
//   white pill on a line ............. a condition label, e.g. "name_updated = yes"
//   orange diamond ................... a condition (or just a branch label if
//                                      only one line leaves it)
//   green block ...................... start (nothing leads in) or hand-over (end)
//   grey tag beside a box ............ "Save Attribute <variable> = …"
//   grey lines with arrowheads ....... connections
//   red / purple / blue stickies ..... notes for whoever builds the bot
//
// Anything the rules can't place is reported so it can be fixed in the editor.

import type { EditorEdge, EditorFlow, EditorNode } from "@/lib/wati/convert";
import { edgeId } from "@/lib/wati/convert";
import { defaultFields, newItemId, newNodeId, textToHtml } from "@/lib/wati/nodes";
import {
  MAX_BUTTONS,
  MAX_LIST_ROW_DESCRIPTION,
  MAX_LIST_ROW_TITLE,
  type WatiNodeType,
} from "@/lib/wati/types";
import type { PdfPageContent, PdfShape, PdfText, Point, Rect } from "./extract";

// ---- Style key ------------------------------------------------------------

const COLORS = {
  boxStroke: ["#37b2bf", "#ff66c4"],
  diamond: ["#e97e3d"],
  terminal: ["#8ffbc4"],
  attributeTag: ["#acb8c0"],
  captureTag: ["#efba91"],
  note: ["#ff788f", "#c991ff", "#83c3ff"],
  crossOut: ["#f40f10", "#f91d0a", "#ff0000", "#e10600"],
  documentIcon: ["#f91d0a"],
  pill: ["#ffffff"],
};

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorIs(color: string | null, palette: string[], tolerance = 40): boolean {
  if (!color) return false;
  const [r, g, b] = hexToRgb(color);
  return palette.some((p) => {
    const [pr, pg, pb] = hexToRgb(p);
    return Math.hypot(r - pr, g - pg, b - pb) <= tolerance;
  });
}

// ---- Geometry helpers -------------------------------------------------------

const width = (r: Rect) => r.x1 - r.x0;
const height = (r: Rect) => r.y1 - r.y0;
const area = (r: Rect) => width(r) * height(r);
const center = (r: Rect): Point => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });

function contains(r: Rect, p: Point, pad = 0): boolean {
  return p.x >= r.x0 - pad && p.x <= r.x1 + pad && p.y >= r.y0 - pad && p.y <= r.y1 + pad;
}

function distToRect(p: Point, r: Rect): number {
  const dx = Math.max(r.x0 - p.x, 0, p.x - r.x1);
  const dy = Math.max(r.y0 - p.y, 0, p.y - r.y1);
  return Math.hypot(dx, dy);
}

function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(b.x0 - a.x1, 0, a.x0 - b.x1);
  const dy = Math.max(b.y0 - a.y1, 0, a.y0 - b.y1);
  return Math.hypot(dx, dy);
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  // Sample along the segment — plenty for axis-aligned connector lines.
  const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 1.5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (contains(r, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return true;
  }
  return false;
}

// ---- Diagram elements -------------------------------------------------------

type ElementKind =
  | "box"
  | "pill"
  | "label"
  | "diamond"
  | "terminal"
  | "attributeTag"
  | "captureTag"
  | "note";

interface Element {
  index: number;
  kind: ElementKind;
  bbox: Rect;
  texts: PdfText[];
  /** For pills: the box they sit in. */
  parent?: Element;
  hasDocumentIcon?: boolean;
}

interface Line {
  points: Point[][];
}

interface DiagramEdge {
  from: Element;
  to: Element;
  label: string;
}

export interface ParsedPage {
  flow: EditorFlow;
  /** Things the person building the bot should check or know about. */
  notes: string[];
}

/** A page is treated as crossed out when a red mark covers most of it. */
export function isCrossedOut(page: PdfPageContent): boolean {
  return page.shapes.some(
    (s) =>
      colorIs(s.fill ?? s.stroke, COLORS.crossOut, 30) &&
      width(s.bbox) > page.width * 0.25 &&
      height(s.bbox) > page.height * 0.25,
  );
}

function classify(page: PdfPageContent) {
  const elements: Element[] = [];
  const lines: Line[] = [];
  const arrowheads: Rect[] = [];
  const documentIcons: Rect[] = [];
  const bullets: Rect[] = [];
  const add = (kind: ElementKind, bbox: Rect) => elements.push({ index: elements.length, kind, bbox, texts: [] });

  const boxRects: Rect[] = [];
  for (const s of page.shapes) {
    if (s.closed && s.stroke && colorIs(s.stroke, COLORS.boxStroke) && width(s.bbox) > 20 && height(s.bbox) > 12) {
      boxRects.push(s.bbox);
    }
  }
  // Canva sometimes draws a box outline twice; keep one of each.
  for (const r of boxRects) {
    if (!elements.some((e) => e.kind === "box" && rectGap(e.bbox, r) === 0 && Math.abs(area(e.bbox) - area(r)) < area(r) * 0.1)) {
      add("box", r);
    }
  }

  const isThin = (s: PdfShape) => Math.min(width(s.bbox), height(s.bbox)) < 1.6 && Math.max(width(s.bbox), height(s.bbox)) > 4;

  for (const s of page.shapes) {
    const w = width(s.bbox);
    const h = height(s.bbox);
    const color = s.fill ?? s.stroke;

    // Arrowheads are tiny "V" strokes or triangles at the end of a line.
    if (Math.max(w, h) < 3 && Math.max(w, h) > 0.5 && (colorIs(color, COLORS.attributeTag) || colorIs(color, ["#ff66c4", "#37b2bf"]))) {
      arrowheads.push(s.bbox);
      continue;
    }
    if (!s.closed && s.stroke) {
      // An open stroked path is a connector, unless it just retraces a box outline.
      const retracesBox = elements.some(
        (e) => e.kind === "box" && Math.abs(width(e.bbox) - w) < 3 && Math.abs(height(e.bbox) - h) < 3,
      );
      if (!retracesBox && Math.max(w, h) > 3) lines.push({ points: s.subpaths });
      continue;
    }
    if (s.fill && isThin(s) && !colorIs(s.fill, COLORS.pill, 20)) {
      // Thin filled rectangles are drawn lines too.
      const c = center(s.bbox);
      lines.push({
        points: [w >= h ? [{ x: s.bbox.x0, y: c.y }, { x: s.bbox.x1, y: c.y }] : [{ x: c.x, y: s.bbox.y0 }, { x: c.x, y: s.bbox.y1 }]],
      });
      continue;
    }
    if (!s.fill) continue;
    if (w < 2.5 && h < 2.5 && w > 0.3 && Math.abs(w - h) < 0.4) {
      bullets.push(s.bbox);
      continue;
    }
    if (colorIs(s.fill, COLORS.documentIcon, 20) && w < 30 && h < 30) documentIcons.push(s.bbox);

    if (colorIs(s.fill, COLORS.diamond, 30) && w > 5 && h > 5) add("diamond", s.bbox);
    else if (colorIs(s.fill, COLORS.terminal, 30) && w > 10 && h > 5) add("terminal", s.bbox);
    else if (colorIs(s.fill, COLORS.attributeTag, 20) && w > 10 && h > 5) add("attributeTag", s.bbox);
    else if (colorIs(s.fill, COLORS.captureTag, 30) && w > 8 && h > 4) add("captureTag", s.bbox);
    else if (colorIs(s.fill, COLORS.note, 30) && w > 15 && h > 10) add("note", s.bbox);
    else if (colorIs(s.fill, COLORS.pill, 6) && h > 2 && h < 15 && w / h > 2) add("pill", s.bbox);
  }

  // De-duplicate overlapping shapes of the same kind (fill + shadow layers).
  const unique: Element[] = [];
  for (const e of elements) {
    const dup = unique.find(
      (u) =>
        u.kind === e.kind &&
        Math.abs(u.bbox.x0 - e.bbox.x0) < 2 &&
        Math.abs(u.bbox.y0 - e.bbox.y0) < 2 &&
        Math.abs(width(u.bbox) - width(e.bbox)) < 2 &&
        Math.abs(height(u.bbox) - height(e.bbox)) < 2,
    );
    if (!dup) unique.push({ ...e, index: unique.length });
  }

  // Pills inside a box are its buttons; pills elsewhere label a line.
  const boxes = unique.filter((e) => e.kind === "box");
  for (const e of unique) {
    if (e.kind !== "pill") continue;
    const c = center(e.bbox);
    const parent = boxes.filter((b) => contains(b.bbox, c)).sort((a, b) => area(a.bbox) - area(b.bbox))[0];
    if (parent) e.parent = parent;
    else e.kind = "label";
  }
  for (const b of boxes) {
    b.hasDocumentIcon = documentIcons.some((d) => contains(b.bbox, center(d)));
  }

  // Each piece of text belongs to the smallest element it sits in.
  for (const t of page.texts) {
    const c = center(t.bbox);
    const owner = unique
      .filter((e) => contains(e.bbox, c, 0.5))
      .sort((a, b) => area(a.bbox) - area(b.bbox))[0];
    owner?.texts.push(t);
  }

  return { elements: unique, lines, arrowheads, bullets };
}

const LIST_ITEM = /^([•●▪◦\-–*]|\d+[.)]|\p{Extended_Pictographic})/u;

/** Reassembles text items into lines and paragraphs. */
function textOf(texts: PdfText[], bullets: Rect[] = []): string {
  if (texts.length === 0) return "";
  const sorted = [...texts].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const rows: PdfText[][] = [];
  for (const t of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(center(row[0].bbox).y - center(t.bbox).y) < t.size * 0.5) row.push(t);
    else rows.push([t]);
  }
  let out = "";
  let prevBottom: number | null = null;
  for (const row of rows) {
    row.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    let line = "";
    let prevRight: number | null = null;
    for (const t of row) {
      const gap = prevRight === null ? 0 : t.bbox.x0 - prevRight;
      line += prevRight !== null && gap > t.size * 0.15 && !line.endsWith(" ") && !t.str.startsWith(" ") ? ` ${t.str}` : t.str;
      prevRight = t.bbox.x1;
    }
    const size = row[0].size;
    // Canva draws bullet points as small dots just left of the text.
    const first = row[0].bbox;
    const hasBullet = bullets.some(
      (b) => b.x1 <= first.x0 + 0.5 && b.x1 > first.x0 - size * 2 && center(b).y > first.y0 && center(b).y < first.y1,
    );
    const text = (hasBullet ? "• " : "") + line.replace(/\s+/g, " ").trim();
    if (prevBottom !== null) {
      // A bigger gap is a new paragraph. Otherwise the line is just Canva
      // wrapping text to the box width — rejoin it, unless it starts a list item.
      if (first.y0 - prevBottom > size * 0.9) out += "\n\n";
      else if (LIST_ITEM.test(text)) out += "\n";
      else if (!/https?:\/\/\S*$/.test(out)) out += " ";
    }
    out += text;
    prevBottom = Math.max(...row.map((t) => t.bbox.y1));
  }
  return out.trim();
}

/** Connector lines → directed element-to-element edges. */
function connect(elements: Element[], lines: Line[], arrowheads: Rect[]): DiagramEdge[] {
  const segments = lines.map((l) =>
    l.points.flatMap((pts) => pts.slice(1).map((p, i) => [pts[i], p] as [Point, Point])),
  );

  // Group lines that touch into networks (merging branches, T-junctions).
  const parent = lines.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const endpoints = lines.map((l) => l.points.flatMap((pts) => [pts[0], pts[pts.length - 1]]));
  const touches = (p: Point, j: number) => segments[j].some(([a, b]) => distToSegment(p, a, b) < 2.5);
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      if (endpoints[i].some((p) => touches(p, j)) || endpoints[j].some((p) => touches(p, i))) {
        parent[find(i)] = find(j);
      }
    }
  }

  const attachable = elements.filter((e) => ["box", "pill", "diamond", "terminal"].includes(e.kind));
  const attach = (p: Point): Element | null => {
    let best: Element | null = null;
    let bestScore = Infinity;
    for (const e of attachable) {
      const d = distToRect(p, e.bbox);
      const limit = e.kind === "pill" ? 3 : 8;
      if (d > limit) continue;
      // Prefer the closest element; among equally close ones, the smallest
      // (a button inside a box wins over the box).
      const score = Math.round(d) * 1e7 + area(e.bbox);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  };

  const networks = new Map<number, { sources: Set<Element>; targets: Set<Element>; lineIdx: number[] }>();
  for (let i = 0; i < lines.length; i++) {
    const root = find(i);
    if (!networks.has(root)) networks.set(root, { sources: new Set(), targets: new Set(), lineIdx: [] });
    const net = networks.get(root)!;
    net.lineIdx.push(i);
    for (const p of endpoints[i]) {
      const isHead = arrowheads.some((a) => contains(a, p, 3));
      const el = attach(p);
      if (!el) continue;
      // A point shared with another line is a junction (branches merging or
      // splitting) — unless it sits right on a step or carries an arrowhead.
      const joined = lines.some((_, j) => j !== i && find(j) === root && touches(p, j));
      if (joined && !isHead && distToRect(p, el.bbox) > 2) continue;
      (isHead ? net.targets : net.sources).add(el);
    }
  }

  const labels = elements.filter((e) => e.kind === "label");
  const edges: DiagramEdge[] = [];
  for (const net of networks.values()) {
    let { sources, targets } = net;
    if (targets.size === 0 && sources.size === 2) {
      // No arrowhead found — assume the line runs top-to-bottom / left-to-right.
      const [a, b] = [...sources].sort((x, y) => x.bbox.y0 - y.bbox.y0 || x.bbox.x0 - y.bbox.x0);
      sources = new Set([a]);
      targets = new Set([b]);
    }
    const label = labels.find((l) =>
      net.lineIdx.some((i) => segments[i].some(([a, b]) => segmentHitsRect(a, b, l.bbox))),
    );
    for (const from of sources) {
      for (const to of targets) {
        if (from !== to) edges.push({ from, to, label: label ? textOf(label.texts) : "" });
      }
    }
  }
  return edges;
}

/**
 * WhatsApp list options are limited to 24 characters, with a 72-character
 * description line underneath. Long labels from the diagram are split so the
 * file imports: "Account Query (Statement / Invoices)" becomes the title
 * "Account Query" with "Statement / Invoices" as its description.
 */
function fitListRow(label: string): { title: string; description: string } {
  if (label.length <= MAX_LIST_ROW_TITLE) return { title: label, description: "" };
  const paren = label.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (paren && paren[1].length <= MAX_LIST_ROW_TITLE) {
    return { title: paren[1].trim(), description: paren[2].trim().slice(0, MAX_LIST_ROW_DESCRIPTION) };
  }
  let title = "";
  for (const word of label.split(" ")) {
    if ((title ? `${title} ${word}` : word).length > MAX_LIST_ROW_TITLE) break;
    title = title ? `${title} ${word}` : word;
  }
  if (!title) title = label.slice(0, MAX_LIST_ROW_TITLE);
  const rest = label.slice(title.length).trim();
  return { title, description: rest.slice(0, MAX_LIST_ROW_DESCRIPTION) };
}

/** Fits every option of one menu, keeping titles distinct from each other. */
function fitListRows(labels: string[]): { title: string; description: string }[] {
  const rows = labels.map(fitListRow);
  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => groups.set(r.title.toLowerCase(), [...(groups.get(r.title.toLowerCase()) ?? []), i]));
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    // Options sharing a start ("Eco-Choice Certificate Proclean / Probio …"):
    // title them by what differs and keep the full name as the description.
    const words = indexes.map((i) => labels[i].split(" "));
    let common = 0;
    while (words.every((w) => w[common] !== undefined && w[common] === words[0][common]) && words.every((w) => w.length > common + 1)) {
      common++;
    }
    for (const [k, i] of indexes.entries()) {
      const rest = words[k].slice(common).join(" ");
      if (!rest) continue;
      rows[i] = {
        title: fitListRow(rest).title,
        description: labels[i].slice(0, MAX_LIST_ROW_DESCRIPTION),
      };
    }
  }
  return rows;
}

const EMPTY_VALUE = /\b(nothing|blank|empty|none|null|not set|no value)\b/i;

function parseLabel(label: string): { variable: string; value: string } | null {
  const m = label.replace(/\s+/g, " ").match(/^(.+?)\s*=\s*(.*)$/);
  return m ? { variable: m[1].trim(), value: m[2].trim() } : null;
}

function variableFromTag(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^save attribute$/i.test(l));
  const first = lines.join(" ");
  const name = (first.includes("=") ? first.split("=")[0] : first).trim();
  return name.replace(/\s+/g, "_");
}

export function parseDiagramPage(page: PdfPageContent, flowName: string): ParsedPage {
  const notes: string[] = [];
  const { elements, lines, arrowheads, bullets } = classify(page);
  const edges = connect(elements, lines, arrowheads);

  // Lines into a button really go into its box.
  const owner = (e: Element) => (e.kind === "pill" && e.parent ? e.parent : e);
  for (const edge of edges) edge.to = owner(edge.to);

  const outgoing = (e: Element) => edges.filter((x) => owner(x.from) === e);
  const incoming = (e: Element) => edges.filter((x) => x.to === e);

  // Diamonds with a single exit are just labels on a branch — skip over them.
  const passThrough = new Set(elements.filter((e) => e.kind === "diamond" && outgoing(e).length <= 1));
  const resolve = (e: Element, seen = new Set<Element>()): Element | null => {
    if (!passThrough.has(e)) return e;
    if (seen.has(e)) return null;
    seen.add(e);
    const next = outgoing(e)[0];
    return next ? resolve(next.to, seen) : null;
  };

  const terminals = elements.filter((e) => e.kind === "terminal");
  const startTerminals = terminals.filter((t) => incoming(t).length === 0 && outgoing(t).length > 0);

  // ---- Create a step for every box, condition and hand-over block ----------
  const taken = new Set<string>();
  const nodeFor = new Map<Element, EditorNode>();
  const boxes = elements.filter((e) => e.kind === "box");
  const medianBoxWidth = boxes.map((b) => width(b.bbox)).sort((a, b) => a - b)[Math.floor(boxes.length / 2)] ?? 40;
  const scale = 300 / medianBoxWidth;
  const position = (e: Element) => ({ x: Math.round(e.bbox.x0 * scale), y: Math.round(e.bbox.y0 * scale) });
  const make = (e: Element, type: WatiNodeType, fields: Record<string, unknown>, note?: string) => {
    const node: EditorNode = {
      id: newNodeId(type, flowName, taken),
      type: "wati",
      position: position(e),
      data: { flowNodeType: type, isStartNode: false, fields, ...(note ? { note } : {}) },
    };
    taken.add(node.id);
    nodeFor.set(e, node);
    return node;
  };

  const tags = elements.filter((e) => e.kind === "attributeTag");
  const tagFor = (box: Element) => tags.find((t) => rectGap(t.bbox, box.bbox) < 6);
  const buttonsOf = new Map<Element, { pill: Element; id: string }[]>();

  const MENU_FALLBACK_TEXT = "Please choose an option below:";
  for (const box of boxes) {
    const pills = elements
      .filter((e) => e.kind === "pill" && e.parent === box)
      .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
    const body = textOf(box.texts, bullets);
    const tag = tagFor(box);
    const variable = tag ? variableFromTag(textOf(tag.texts)) : "";
    const noteParts: string[] = [];
    if (box.hasDocumentIcon) noteParts.push("Attach the document shown in the diagram.");
    // WhatsApp menus must have message text; the diagram sometimes leaves it out.
    const menuBody = body || MENU_FALLBACK_TEXT;
    if (pills.length > 0 && !body) noteParts.push(`No text in the diagram — “${MENU_FALLBACK_TEXT}” was added.`);

    if (pills.length > 0 && pills.length <= MAX_BUTTONS) {
      const items = pills.map((p) => ({ pill: p, id: newItemId() }));
      buttonsOf.set(box, items);
      make(box, "InteractiveButtons", {
        ...defaultFields("InteractiveButtons"),
        interactiveButtonsBody: textToHtml(menuBody),
        interactiveButtonsItems: items.map(({ pill, id }) => ({
          id,
          buttonText: textOf(pill.texts).replace(/\n+/g, " "),
          nodeResultId: "",
        })),
        interactiveButtonsUserInputVariable: variable,
      }, noteParts.join(" ") || undefined);
    } else if (pills.length > MAX_BUTTONS) {
      const items = pills.map((p) => ({ pill: p, id: newItemId() }));
      buttonsOf.set(box, items);
      make(box, "InteractiveList", {
        ...defaultFields("InteractiveList"),
        interactiveListBody: textToHtml(menuBody),
        interactiveListSections: [
          {
            id: newItemId(),
            title: "",
            rows: fitListRows(items.map(({ pill }) => textOf(pill.texts).replace(/\n+/g, " "))).map((row, i) => ({
              id: items[i].id,
              ...row,
              nodeResultId: "",
            })),
          },
        ],
        interactiveListUserInputVariable: variable,
      }, noteParts.join(" ") || undefined);
    } else if (variable) {
      const fields = defaultFields("Question");
      fields.flowReplies = [{ flowReplyType: "Text", data: textToHtml(body), caption: "", mimeType: "" }];
      fields.userInputVariable = variable;
      make(box, "Question", fields, noteParts.join(" ") || undefined);
    } else if (box.hasDocumentIcon && !/^https?:\/\//i.test(body.trim())) {
      // A document box: WATI sends the file itself, captioned with its name.
      // The file has to be uploaded in WATI after importing.
      make(box, "Message", {
        flowReplies: [{ flowReplyType: "Document", data: "", caption: body.trim(), mimeType: "" }],
      }, body.trim() ? "Upload this document in WATI after importing." : "Upload the document shown in the diagram (no file name was given).");
    } else {
      make(box, "Message", {
        flowReplies: [{ flowReplyType: "Text", data: textToHtml(body), caption: "", mimeType: "" }],
      }, noteParts.join(" ") || undefined);
    }
  }

  const conditionInfo = new Map<Element, { trueEdge: DiagramEdge; falseEdge: DiagramEdge | null }>();
  for (const d of elements.filter((e) => e.kind === "diamond" && !passThrough.has(e))) {
    const outs = outgoing(d);
    const parsed = outs.map((o) => ({ edge: o, label: parseLabel(o.label) }));
    const withValue = parsed.find((p) => p.label && p.label.value && !EMPTY_VALUE.test(p.label.value));
    const trueSide = withValue ?? parsed[0];
    const falseSide = parsed.find((p) => p !== trueSide) ?? null;
    const variable = (withValue ?? parsed.find((p) => p.label))?.label?.variable ?? "";
    const value = trueSide.label?.value ?? "";
    conditionInfo.set(d, { trueEdge: trueSide.edge, falseEdge: falseSide?.edge ?? null });
    const description = textOf(d.texts).replace(/\n/g, " ");
    make(d, "Condition", {
      ...defaultFields("Condition"),
      flowNodeConditions: [
        {
          id: newItemId(),
          flowConditionType: "Equal",
          variable: variable ? `{{${variable.replace(/^\{\{|\}\}$/g, "")}}}` : "",
          value,
        },
      ],
    }, description || undefined);
    if (!variable) notes.push(`Condition “${description}”: no “variable = value” label found on its lines — set it in the editor.`);
    if (outs.length > 2) notes.push(`Condition “${description}” has ${outs.length} exits; WATI conditions have two. Only the first two were used.`);
  }

  for (const t of terminals) {
    if (startTerminals.includes(t)) continue;
    if (incoming(t).length === 0) continue;
    const text = textOf(t.texts).replace(/\n+/g, " ");
    if (/clos|end|finish|thank/i.test(text) && !/hand|team|agent|transfer/i.test(text)) {
      make(t, "UpdateChatStatus", defaultFields("UpdateChatStatus"), text);
    } else {
      make(t, "AssignTeam", defaultFields("AssignTeam"), text);
    }
  }

  // ---- Connections -----------------------------------------------------------
  const flowEdges: EditorEdge[] = [];
  const used = new Set<string>();
  const link = (source: EditorNode, handle: string | null, targetEl: Element) => {
    const resolved = resolve(targetEl);
    const target = resolved ? nodeFor.get(resolved) : undefined;
    if (!target || target === source) return;
    const key = `${source.id}|${handle ?? ""}`;
    if (used.has(key)) {
      notes.push(`A step has more than one line leaving the same exit; only one was kept (${target.id}).`);
      return;
    }
    used.add(key);
    flowEdges.push({ id: edgeId(source.id, handle, target.id), source: source.id, sourceHandle: handle, target: target.id });
  };

  for (const [el, node] of nodeFor) {
    const type = node.data.flowNodeType;
    if (type === "InteractiveButtons" || type === "InteractiveList") {
      const items = buttonsOf.get(el) ?? [];
      const boxLevel = edges.filter((x) => x.from === el);
      const anyFromButtons = items.some(({ pill }) => edges.some((x) => x.from === pill));
      for (const { pill, id } of items) {
        const fromPill = edges.filter((x) => x.from === pill);
        if (fromPill.length) for (const e of fromPill) link(node, id, e.to);
        // One line from the whole box means every option leads to the same next step.
        else if (!anyFromButtons && boxLevel.length === 1) link(node, id, boxLevel[0].to);
      }
      if (anyFromButtons && boxLevel.length) {
        notes.push(`“${textOf(el.texts).slice(0, 40)}…”: a line leaves the box itself rather than one of its buttons — connect it in the editor.`);
      }
    } else if (type === "Condition") {
      const info = conditionInfo.get(el)!;
      link(node, "true", info.trueEdge.to);
      if (info.falseEdge) link(node, "false", info.falseEdge.to);
    } else if (type === "Message" || type === "Question") {
      const outs = edges.filter((x) => owner(x.from) === el);
      for (const e of outs) link(node, null, e.to);
    }
  }

  // ---- Start step -------------------------------------------------------------
  let start: EditorNode | undefined;
  const startTerminal = startTerminals.sort((a, b) => a.bbox.y0 - b.bbox.y0)[0];
  if (startTerminal) {
    const first = outgoing(startTerminal)[0];
    const resolved = first ? resolve(first.to) : null;
    start = resolved ? nodeFor.get(resolved) : undefined;
  }
  if (!start) {
    const targets = new Set(flowEdges.map((e) => e.target));
    start = [...nodeFor.values()]
      .filter((n) => !targets.has(n.id))
      .sort((a, b) => a.position.y - b.position.y)[0];
  }
  if (start) start.data.isStartNode = true;
  for (const extraStart of startTerminals.filter((t) => t !== startTerminal)) {
    notes.push(
      `Second entry point “${textOf(extraStart.texts).replace(/\n+/g, " ")}” — WATI flows have one start step, so set this up as a separate keyword flow.`,
    );
  }

  // ---- Notes from stickies and tags ------------------------------------------
  const stepNodes = [...nodeFor.entries()];
  for (const e of elements.filter((x) => x.kind === "note" || x.kind === "captureTag")) {
    const text = textOf(e.texts).replace(/\n+/g, " ");
    if (!text) continue;
    const nearest = stepNodes
      .map(([el, node]) => ({ node, d: rectGap(el.bbox, e.bbox) }))
      .sort((a, b) => a.d - b.d)[0];
    if (nearest && nearest.d < 40) {
      const existing = nearest.node.data.note as string | undefined;
      nearest.node.data.note = existing ? `${existing}\n${text}` : text;
    } else {
      notes.push(`Note on the diagram: “${text}”`);
    }
  }

  const nodes = [...nodeFor.values()];
  if (nodes.length === 0) notes.push("No flow boxes were recognised on this page.");

  return { flow: { name: flowName, nodes, edges: flowEdges, extra: {} }, notes };
}
