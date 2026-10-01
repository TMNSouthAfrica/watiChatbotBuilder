"use client";

// Browser entry point: read a Canva PDF, find the pages to convert and turn
// them into one editor flow.

import { edgeId, type EditorFlow, type EditorNode } from "@/lib/wati/convert";
import { defaultHandleId, newNodeId, outputsFor, textToHtml } from "@/lib/wati/nodes";
import { loadPdfjs } from "@/lib/pdf-to-images";
import { extractPage, type PdfPageContent } from "./extract";
import { isCrossedOut, parseDiagramPage } from "./parse";

export interface DiagramPage {
  pageNumber: number;
  crossedOut: boolean;
  thumbnail: string;
  content: PdfPageContent;
}

export async function readDiagramPdf(file: File): Promise<DiagramPage[]> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: DiagramPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await extractPage(pdfjs as unknown as Parameters<typeof extractPage>[0], page);

    const viewport = page.getViewport({ scale: 320 / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (ctx) await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    pages.push({
      pageNumber: n,
      crossedOut: isCrossedOut(content),
      thumbnail: canvas.toDataURL("image/png"),
      content,
    });
  }
  return pages;
}

export function buildFlowFromPages(pages: DiagramPage[], flowName: string): { flow: EditorFlow; notes: string[] } {
  const flow: EditorFlow = { name: flowName, nodes: [], edges: [], extra: {} };
  const notes: string[] = [];
  let offsetY = 0;

  for (const page of pages) {
    const parsed = parseDiagramPage(page.content, flowName);
    const maxY = Math.max(0, ...parsed.flow.nodes.map((n) => n.position.y));
    for (const node of parsed.flow.nodes) {
      node.position = { x: node.position.x, y: node.position.y + offsetY };
      // Only the first page's start step can be the flow's start.
      if (flow.nodes.some((n) => n.data.isStartNode)) node.data.isStartNode = false;
      flow.nodes.push(node);
    }
    flow.edges.push(...parsed.flow.edges);
    notes.push(...parsed.notes.map((n) => (pages.length > 1 ? `Page ${page.pageNumber}: ${n}` : n)));
    offsetY += maxY + 800;
  }
  addNoMatchReplies(flow);
  return { flow, notes };
}

/** Moves a position down until it doesn't overlap an existing step. */
function clearSpot(nodes: EditorNode[], position: { x: number; y: number }) {
  let p = position;
  while (nodes.some((n) => Math.abs(n.position.x - p.x) < 260 && Math.abs(n.position.y - p.y) < 160)) {
    p = { ...p, y: p.y + 60 };
  }
  return p;
}

/**
 * Gives every menu the standard "please choose an option" reply for customers
 * who type instead of tapping, looping back to the same menu.
 */
function addNoMatchReplies(flow: EditorFlow) {
  const taken = new Set(flow.nodes.map((n) => n.id));
  const added: EditorNode[] = [];
  for (const menu of flow.nodes) {
    const type = menu.data.flowNodeType;
    if (type !== "InteractiveButtons" && type !== "InteractiveList") continue;
    const handle = defaultHandleId(menu.id);
    if (flow.edges.some((e) => e.source === menu.id && e.sourceHandle === handle)) continue;
    const rows = outputsFor(menu.id, type, menu.data.fields).length;
    const reply: EditorNode = {
      id: newNodeId("Message", flow.name, taken),
      type: "wati",
      position: clearSpot([...flow.nodes, ...added], {
        x: menu.position.x - 320,
        y: menu.position.y + 60 + rows * 26,
      }),
      data: {
        flowNodeType: "Message",
        isStartNode: false,
        fields: {
          flowReplies: [
            {
              flowReplyType: "Text",
              data: "",
              caption: textToHtml("Please select one of the options below to proceed."),
              mimeType: "",
            },
          ],
        },
      },
    };
    taken.add(reply.id);
    added.push(reply);
    flow.edges.push(
      { id: edgeId(menu.id, handle, reply.id), source: menu.id, sourceHandle: handle, target: reply.id },
      { id: edgeId(reply.id, null, menu.id), source: reply.id, sourceHandle: null, target: menu.id },
    );
  }
  flow.nodes.push(...added);
}
