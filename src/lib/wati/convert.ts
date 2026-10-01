// Deterministic conversion between the editor's graph and WATI's flow JSON,
// plus validation. Edge/handle naming mirrors WATI's own export, which is
// itself a React Flow graph:
//   edge id       = "reactflow__edge-<source><handle>-<target>"
//   sourceNodeId  = "<source>__<handle>"  (just "<source>" for a single output)

import type { Edge, Node } from "@xyflow/react";
import { defaultHandleId, htmlToText, nodePreview, outputsFor } from "./nodes";
import {
  MAX_BUTTON_TEXT,
  MAX_BUTTONS,
  MAX_LIST_BUTTON_TEXT,
  MAX_LIST_ROW_DESCRIPTION,
  MAX_LIST_ROW_TITLE,
  MAX_LIST_ROWS,
  NODE_TYPE_LABELS,
  type ButtonItem,
  type FlowReply,
  type ListSection,
  type WatiFlow,
  type WatiFlowEdge,
  type WatiFlowNode,
  type WatiNodeData,
  type WatiNodeType,
} from "./types";

export type EditorNode = Node<WatiNodeData, "wati">;
export type EditorEdge = Edge;

export interface EditorFlow {
  name: string;
  nodes: EditorNode[];
  edges: EditorEdge[];
  /** Top-level fields from an imported file, carried through on export. */
  extra: Record<string, unknown>;
}

const NODE_BASE_KEYS = new Set(["id", "flowNodeType", "flowNodePosition", "isStartNode"]);

export function edgeId(source: string, handle: string | null | undefined, target: string): string {
  return `reactflow__edge-${source}${handle ?? ""}-${target}`;
}

// ---- Export ---------------------------------------------------------------

export function toWatiFlow(flow: EditorFlow): WatiFlow {
  const nodeIds = new Set(flow.nodes.map((n) => n.id));
  const edges = flow.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  const targetOf = (source: string, handle: string | null) =>
    edges.find((e) => e.source === source && (e.sourceHandle ?? null) === handle)?.target ?? "";

  const flowNodes: WatiFlowNode[] = flow.nodes.map((node) => {
    const type = node.data.flowNodeType;
    const fields = structuredClone(node.data.fields);

    // Routing fields are always rebuilt from the edges so they can't disagree.
    if (type === "InteractiveButtons") {
      const items = (fields.interactiveButtonsItems as ButtonItem[] | undefined) ?? [];
      fields.interactiveButtonsItems = items.map((b) => ({ ...b, nodeResultId: targetOf(node.id, b.id) }));
      fields.interactiveButtonsDefaultNodeResultId = targetOf(node.id, defaultHandleId(node.id));
    } else if (type === "InteractiveList") {
      const sections = (fields.interactiveListSections as ListSection[] | undefined) ?? [];
      fields.interactiveListSections = sections.map((s) => ({
        ...s,
        rows: s.rows.map((r) => ({ ...r, nodeResultId: targetOf(node.id, r.id) })),
      }));
      fields.interactiveListDefaultNodeResultId = targetOf(node.id, defaultHandleId(node.id));
    } else if (type === "Condition") {
      fields.conditionResult = {
        ...((fields.conditionResult as object | undefined) ?? {}),
        yResultNodeId: targetOf(node.id, "true"),
        nResultNodeId: targetOf(node.id, "false"),
      };
    }

    return {
      ...fields,
      id: node.id,
      flowNodeType: type,
      flowNodePosition: {
        posX: String(Math.round(node.position.x)),
        posY: String(Math.round(node.position.y)),
      },
      isStartNode: node.data.isStartNode,
    };
  });

  const flowEdges: WatiFlowEdge[] = edges.map((e) => ({
    id: edgeId(e.source, e.sourceHandle, e.target),
    sourceNodeId: e.sourceHandle ? `${e.source}__${e.sourceHandle}` : e.source,
    targetNodeId: e.target,
  }));

  return {
    id: null,
    tenantId: null,
    created: null,
    lastUpdated: null,
    isDeleted: false,
    transform: null,
    isPro: false,
    flowVersion: null,
    fallback: null,
    channelTypes: null,
    ...flow.extra,
    name: flow.name,
    flowNodes,
    flowEdges,
  };
}

// ---- Import ---------------------------------------------------------------

export function fromWatiFlow(input: unknown): EditorFlow {
  if (!input || typeof input !== "object") throw new Error("File is not a JSON object.");
  const raw = input as Partial<WatiFlow>;
  if (!Array.isArray(raw.flowNodes)) {
    throw new Error('This doesn\'t look like a WATI flow export (no "flowNodes" list).');
  }

  const nodes: EditorNode[] = raw.flowNodes.map((n, i) => {
    if (!n || typeof n.id !== "string" || typeof n.flowNodeType !== "string") {
      throw new Error(`Node #${i + 1} is missing an id or flowNodeType.`);
    }
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) if (!NODE_BASE_KEYS.has(k)) fields[k] = v;
    return {
      id: n.id,
      type: "wati",
      position: {
        x: Number.parseFloat(String(n.flowNodePosition?.posX ?? 0)) || 0,
        y: Number.parseFloat(String(n.flowNodePosition?.posY ?? 0)) || 0,
      },
      data: { flowNodeType: n.flowNodeType, isStartNode: n.isStartNode === true, fields },
    };
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: EditorEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (source: string, handle: string | null, target: string) => {
    const key = `${source}|${handle ?? ""}`;
    if (seen.has(key) || !nodeIds.has(source) || !nodeIds.has(target)) return;
    seen.add(key);
    edges.push({ id: edgeId(source, handle, target), source, sourceHandle: handle, target });
  };

  for (const e of raw.flowEdges ?? []) {
    if (!e || typeof e.sourceNodeId !== "string" || typeof e.targetNodeId !== "string") continue;
    const split = e.sourceNodeId.indexOf("__");
    const source = split === -1 ? e.sourceNodeId : e.sourceNodeId.slice(0, split);
    const handle = split === -1 ? null : e.sourceNodeId.slice(split + 2);
    addEdge(source, handle, e.targetNodeId);
  }

  // Fall back to the nodes' own routing fields for any branch the edge list
  // left out, so a slightly inconsistent export still opens correctly.
  for (const n of nodes) {
    const f = n.data.fields;
    if (n.data.flowNodeType === "InteractiveButtons") {
      for (const b of (f.interactiveButtonsItems as ButtonItem[] | undefined) ?? []) {
        if (b.nodeResultId) addEdge(n.id, b.id, b.nodeResultId);
      }
      const d = f.interactiveButtonsDefaultNodeResultId;
      if (typeof d === "string" && d) addEdge(n.id, defaultHandleId(n.id), d);
    } else if (n.data.flowNodeType === "InteractiveList") {
      for (const s of (f.interactiveListSections as ListSection[] | undefined) ?? []) {
        for (const r of s.rows ?? []) if (r.nodeResultId) addEdge(n.id, r.id, r.nodeResultId);
      }
      const d = f.interactiveListDefaultNodeResultId;
      if (typeof d === "string" && d) addEdge(n.id, defaultHandleId(n.id), d);
    } else if (n.data.flowNodeType === "Condition") {
      const r = f.conditionResult as { yResultNodeId?: string; nResultNodeId?: string } | undefined;
      if (r?.yResultNodeId) addEdge(n.id, "true", r.yResultNodeId);
      if (r?.nResultNodeId) addEdge(n.id, "false", r.nResultNodeId);
    }
  }

  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k !== "flowNodes" && k !== "flowEdges" && k !== "name") extra[k] = v;
  }

  return { name: typeof raw.name === "string" ? raw.name : "Imported flow", nodes, edges, extra };
}

// ---- Validation -------------------------------------------------------------

export interface Issue {
  level: "error" | "warning";
  nodeId?: string;
  message: string;
}

export function validateFlow(flow: EditorFlow): Issue[] {
  const issues: Issue[] = [];
  const { nodes, edges } = flow;

  if (nodes.length === 0) {
    issues.push({ level: "error", message: "The flow is empty. Add at least one step." });
    return issues;
  }

  const starts = nodes.filter((n) => n.data.isStartNode);
  if (starts.length === 0) {
    issues.push({ level: "error", message: "No start step. Select a step and click “Make start”." });
  } else if (starts.length > 1) {
    issues.push({ level: "error", message: "More than one start step — WATI allows exactly one." });
  }

  for (const node of nodes) {
    const { flowNodeType: type, fields } = node.data;
    const name = describe(node);
    const outs = outputsFor(node.id, type, fields);

    for (const out of outs) {
      const connected = edges.some(
        (e) => e.source === node.id && (e.sourceHandle ?? null) === out.id,
      );
      if (!connected) {
        issues.push({
          level: "warning",
          nodeId: node.id,
          message: out.label
            ? `${name}: “${out.label}” isn't connected to a next step.`
            : `${name} isn't connected to a next step.`,
        });
      }
    }

    const replies = (fields.flowReplies as FlowReply[] | undefined) ?? [];
    if (type === "Message" && !replies.some((r) => htmlToText(r.caption || r.data).trim() || r.flowReplyType !== "Text")) {
      issues.push({ level: "error", nodeId: node.id, message: `${name} has no text.` });
    }
    if (type === "Question" && !htmlToText(replies[0]?.data ?? "").trim()) {
      issues.push({ level: "error", nodeId: node.id, message: `${name} has no question text.` });
    }

    if (type === "InteractiveButtons") {
      const items = (fields.interactiveButtonsItems as ButtonItem[] | undefined) ?? [];
      if (!htmlToText(String(fields.interactiveButtonsBody ?? "")).trim()) {
        issues.push({ level: "error", nodeId: node.id, message: `${name} has no message text.` });
      }
      if (items.length === 0) {
        issues.push({ level: "error", nodeId: node.id, message: `${name} has no buttons.` });
      }
      if (items.length > MAX_BUTTONS) {
        issues.push({ level: "error", nodeId: node.id, message: `${name} has ${items.length} buttons — WhatsApp allows at most ${MAX_BUTTONS}. Use a List instead.` });
      }
      for (const b of items) {
        if (!b.buttonText.trim()) {
          issues.push({ level: "error", nodeId: node.id, message: `${name} has a button with no text.` });
        } else if (b.buttonText.length > MAX_BUTTON_TEXT) {
          issues.push({ level: "error", nodeId: node.id, message: `${name}: button “${b.buttonText}” is longer than ${MAX_BUTTON_TEXT} characters.` });
        }
      }
    }

    if (type === "InteractiveList") {
      const sections = (fields.interactiveListSections as ListSection[] | undefined) ?? [];
      const rows = sections.flatMap((s) => s.rows);
      if (!htmlToText(String(fields.interactiveListBody ?? "")).trim()) {
        issues.push({ level: "error", nodeId: node.id, message: `${name} has no message text.` });
      }
      if (rows.length === 0) {
        issues.push({ level: "error", nodeId: node.id, message: `${name} has no options.` });
      }
      if (rows.length > MAX_LIST_ROWS) {
        issues.push({ level: "error", nodeId: node.id, message: `${name} has ${rows.length} options — WhatsApp allows at most ${MAX_LIST_ROWS}.` });
      }
      const buttonText = String(fields.interactiveListButtonText ?? "");
      if (!buttonText.trim() || buttonText.length > MAX_LIST_BUTTON_TEXT) {
        issues.push({ level: "error", nodeId: node.id, message: `${name}: the menu button text must be 1–${MAX_LIST_BUTTON_TEXT} characters.` });
      }
      for (const r of rows) {
        if (!r.title.trim()) {
          issues.push({ level: "error", nodeId: node.id, message: `${name} has an option with no title.` });
        } else if (r.title.length > MAX_LIST_ROW_TITLE) {
          issues.push({ level: "error", nodeId: node.id, message: `${name}: option “${r.title}” is longer than ${MAX_LIST_ROW_TITLE} characters.` });
        }
        if ((r.description ?? "").length > MAX_LIST_ROW_DESCRIPTION) {
          issues.push({ level: "error", nodeId: node.id, message: `${name}: description of “${r.title}” is longer than ${MAX_LIST_ROW_DESCRIPTION} characters.` });
        }
      }
    }

    if (type === "Condition") {
      const c = (fields.flowNodeConditions as { variable?: string }[] | undefined)?.[0];
      if (!c?.variable?.trim()) {
        issues.push({ level: "error", nodeId: node.id, message: `${name} has no variable to check.` });
      }
    }

    if (type === "AssignTeam" && !((fields.teamIds as string[] | undefined) ?? []).length) {
      issues.push({ level: "warning", nodeId: node.id, message: `${name}: no Team ID set — fill it in here or in WATI after importing.` });
    }
    if (type === "AssignAgent" && !fields.agentId) {
      issues.push({ level: "warning", nodeId: node.id, message: `${name}: no Agent ID set — fill it in here or in WATI after importing.` });
    }
    if (type === "InteractiveWhatsAppFlow" && !fields.whatsAppFlowId) {
      issues.push({ level: "warning", nodeId: node.id, message: `${name}: no WhatsApp Flow ID set.` });
    }
  }

  // Steps nothing leads to (other than the start) will never run.
  if (starts.length === 1) {
    const reachable = new Set<string>([starts[0].id]);
    const queue = [starts[0].id];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of edges) {
        if (e.source === id && !reachable.has(e.target)) {
          reachable.add(e.target);
          queue.push(e.target);
        }
      }
    }
    for (const node of nodes) {
      if (!reachable.has(node.id)) {
        issues.push({ level: "warning", nodeId: node.id, message: `${describe(node)} can't be reached from the start step.` });
      }
    }
  }

  return issues;
}

function describe(node: EditorNode): string {
  const type = node.data.flowNodeType;
  const label = NODE_TYPE_LABELS[type as WatiNodeType] ?? type;
  const preview =
    type === "AssignTeam" || type === "AssignAgent" ? "" : nodePreview(type, node.data.fields).trim();
  return preview ? `${label} “${preview.length > 30 ? `${preview.slice(0, 30)}…` : preview}”` : label;
}
