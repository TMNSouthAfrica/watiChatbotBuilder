"use client";

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  edgeId,
  fromWatiFlow,
  toWatiFlow,
  validateFlow,
  type EditorEdge,
  type EditorFlow,
  type EditorNode,
} from "@/lib/wati/convert";
import { defaultFields, defaultHandleId, newItemId, newNodeId, outputsFor, textToHtml } from "@/lib/wati/nodes";
import {
  ALL_NODE_TYPES,
  NODE_TYPE_DESCRIPTIONS,
  NODE_TYPE_LABELS,
  type WatiNodeType,
} from "@/lib/wati/types";
import { buildFlowFromPages, readDiagramPdf, type DiagramPage } from "@/lib/pdf-diagram/import";
import { Inspector } from "./Inspector";
import { TYPE_COLORS, WatiNodeCard } from "./WatiNodeCard";

const STORAGE_KEY = "wati-flow-editor:v1";
const nodeTypes: NodeTypes = { wati: WatiNodeCard };

interface SavedState {
  name: string;
  nodes: EditorNode[];
  edges: EditorEdge[];
  extra: Record<string, unknown>;
  importNotes?: string[];
}

function loadSaved(): SavedState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedState;
    // Earlier versions kept text messages in "caption"; WATI expects "data".
    for (const n of saved.nodes) {
      const replies = n.data.fields.flowReplies as { flowReplyType: string; data: string; caption: string }[] | undefined;
      for (const r of replies ?? []) {
        if (r.flowReplyType === "Text" && !r.data && r.caption) {
          r.data = r.caption;
          r.caption = "";
        }
      }
    }
    return saved;
  } catch {
    return null;
  }
}

function save(state: SavedState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked — the editor still works, it just won't remember.
  }
}

function makeNode(
  type: WatiNodeType,
  flowName: string,
  taken: Set<string>,
  position: { x: number; y: number },
  isStartNode: boolean,
): EditorNode {
  return {
    id: newNodeId(type, flowName, taken),
    type: "wati",
    position,
    data: { flowNodeType: type, isStartNode, fields: defaultFields(type) },
  };
}

/** Moves a position down until it doesn't overlap an existing step. */
function clearSpot(nodes: EditorNode[], position: { x: number; y: number }) {
  let p = position;
  while (nodes.some((n) => Math.abs(n.position.x - p.x) < 240 && Math.abs(n.position.y - p.y) < 120)) {
    p = { ...p, y: p.y + 140 };
  }
  return p;
}

function Editor() {
  const [initial] = useState(loadSaved);
  const [flowName, setFlowName] = useState(initial?.name ?? "");
  const [extra, setExtra] = useState<Record<string, unknown>>(initial?.extra ?? {});
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorNode>(initial?.nodes ?? []);
  const [edges, setEdges, onEdgesChange] = useEdgesState<EditorEdge>(initial?.edges ?? []);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [importNotes, setImportNotes] = useState<string[]>(initial?.importNotes ?? []);
  const [pdfPages, setPdfPages] = useState<DiagramPage[] | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView, getNodes } = useReactFlow();
  // Bumped when a whole new flow is loaded, to zoom out to show all of it
  // once React Flow has measured every step.
  const [fitRequest, setFitRequest] = useState(0);
  useEffect(() => {
    if (fitRequest === 0) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const all = getNodes();
      if (all.every((n) => n.measured?.width) || ++tries > 30) {
        window.clearInterval(timer);
        void fitView({ padding: 0.08, minZoom: 0.05 });
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [fitRequest, getNodes, fitView]);

  // Remember the flow in this browser so a refresh doesn't lose work.
  useEffect(() => {
    const t = window.setTimeout(() => save({ name: flowName, nodes, edges, extra, importNotes }), 400);
    return () => window.clearTimeout(t);
  }, [flowName, nodes, edges, extra, importNotes]);

  const flow: EditorFlow = useMemo(
    () => ({ name: flowName.trim() || "Untitled Flow", nodes, edges, extra }),
    [flowName, nodes, edges, extra],
  );
  const issues = useMemo(() => validateFlow(flow), [flow]);
  const errorCount = issues.filter((i) => i.level === "error").length;
  const warningCount = issues.length - errorCount;

  const selected = nodes.find((n) => n.selected);
  const selectedCount = nodes.filter((n) => n.selected).length;

  const centerPosition = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const p = screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    // Small jitter so several new steps don't stack exactly on top of each other.
    return { x: p.x - 120 + Math.random() * 40, y: p.y - 60 + Math.random() * 40 };
  }, [screenToFlowPosition]);

  /**
   * Adds a step. If one step is selected, the new step goes to its right and
   * is connected to its first unconnected output, so a flow can be built by
   * repeatedly selecting a step and clicking the next step type.
   */
  const addNode = useCallback(
    (type: WatiNodeType) => {
      const taken = new Set(nodes.map((n) => n.id));
      const selectedNodes = nodes.filter((n) => n.selected);
      const parent = selectedNodes.length === 1 ? selectedNodes[0] : null;

      let position = centerPosition();
      let link: { source: string; handle: string | null } | null = null;
      if (parent) {
        const outputs = outputsFor(parent.id, parent.data.flowNodeType, parent.data.fields);
        const freeIndex = outputs.findIndex(
          (o) => !edges.some((e) => e.source === parent.id && (e.sourceHandle ?? null) === o.id),
        );
        if (freeIndex !== -1) link = { source: parent.id, handle: outputs[freeIndex].id };
        position = {
          x: parent.position.x + 320,
          y: parent.position.y + Math.max(freeIndex, 0) * 160,
        };
      }
      position = clearSpot(nodes, position);

      const node = makeNode(type, flowName, taken, position, nodes.length === 0);
      setNodes((current) => [...current.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
      if (link) {
        const { source, handle } = link;
        setEdges((current) => [
          ...current,
          { id: edgeId(source, handle, node.id), source, sourceHandle: handle, target: node.id },
        ]);
      }
    },
    [nodes, edges, flowName, centerPosition, setNodes, setEdges],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      setEdges((current) => [
        // Each output goes to exactly one next step — replace any existing line.
        ...current.filter((e) => !(e.source === c.source && (e.sourceHandle ?? null) === (c.sourceHandle ?? null))),
        {
          id: edgeId(c.source, c.sourceHandle, c.target),
          source: c.source,
          sourceHandle: c.sourceHandle ?? null,
          target: c.target,
        },
      ]);
    },
    [setEdges],
  );

  const updateFields = useCallback(
    (nodeId: string, fields: Record<string, unknown>) => {
      const type = nodes.find((n) => n.id === nodeId)?.data.flowNodeType;
      if (!type) return;
      const validHandles = new Set(outputsFor(nodeId, type, fields).map((o) => o.id));
      setNodes((current) =>
        current.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, fields } } : n)),
      );
      // Drop lines from buttons/options that were just removed.
      setEdges((current) =>
        current.filter((e) => e.source !== nodeId || validHandles.has(e.sourceHandle ?? null)),
      );
    },
    [nodes, setNodes, setEdges],
  );

  const makeStart = useCallback(
    (nodeId: string) =>
      setNodes((current) =>
        current.map((n) => ({ ...n, data: { ...n.data, isStartNode: n.id === nodeId } })),
      ),
    [setNodes],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((current) => current.filter((n) => n.id !== nodeId));
      setEdges((current) => current.filter((e) => e.source !== nodeId && e.target !== nodeId));
    },
    [setNodes, setEdges],
  );

  const duplicateNode = useCallback(
    (nodeId: string) =>
      setNodes((current) => {
        const original = current.find((n) => n.id === nodeId);
        if (!original) return current;
        const type = original.data.flowNodeType as WatiNodeType;
        const copy = makeNode(type, flowName, new Set(current.map((n) => n.id)), {
          x: original.position.x + 40,
          y: original.position.y + 40,
        }, false);
        // Fresh ids for buttons/rows so the copy's outputs are independent.
        const fields = structuredClone(original.data.fields);
        const newItem = (item: Record<string, unknown>) => ({
          ...item,
          id: newItemId(),
          nodeResultId: "",
        });
        if (Array.isArray(fields.interactiveButtonsItems)) {
          fields.interactiveButtonsItems = fields.interactiveButtonsItems.map(newItem);
        }
        if (Array.isArray(fields.interactiveListSections)) {
          fields.interactiveListSections = (fields.interactiveListSections as { rows: Record<string, unknown>[] }[]).map(
            (s) => ({ ...s, rows: s.rows.map(newItem) }),
          );
        }
        return [
          ...current.map((n) => ({ ...n, selected: false })),
          { ...copy, selected: true, data: { ...copy.data, fields } },
        ];
      }),
    [flowName, setNodes],
  );

  /** Adds the standard "please choose an option" message that loops back. */
  const addFallback = useCallback(
    (nodeId: string) => {
      const owner = nodes.find((n) => n.id === nodeId);
      if (!owner) return;
      const message = makeNode(
        "Message",
        flowName,
        new Set(nodes.map((n) => n.id)),
        clearSpot(nodes, { x: owner.position.x + 320, y: owner.position.y + 260 }),
        false,
      );
      message.data.fields = {
        flowReplies: [
          {
            flowReplyType: "Text",
            data: textToHtml("Please select one of the options below to proceed."),
            caption: "",
            mimeType: "",
          },
        ],
      };
      const handle = defaultHandleId(nodeId);
      setNodes((current) => [...current, message]);
      setEdges((current) => [
        ...current.filter((e) => !(e.source === nodeId && e.sourceHandle === handle)),
        { id: edgeId(nodeId, handle, message.id), source: nodeId, sourceHandle: handle, target: message.id },
        { id: edgeId(message.id, null, nodeId), source: message.id, sourceHandle: null, target: nodeId },
      ]);
    },
    [nodes, flowName, setNodes, setEdges],
  );

  const handleExport = useCallback(() => {
    if (errorCount > 0) {
      const ok = window.confirm(
        `This flow has ${errorCount} problem(s) that may stop WATI from importing it. Download anyway?`,
      );
      if (!ok) return;
    }
    const json = JSON.stringify(toWatiFlow(flow), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${flow.name.replace(/[^a-z0-9-_]+/gi, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice({ kind: "ok", text: "Downloaded. In WATI, open Chatbots and import this file." });
  }, [flow, errorCount]);

  const handleImport = useCallback(
    async (file: File) => {
      try {
        const imported = fromWatiFlow(JSON.parse(await file.text()));
        if (nodes.length > 0 && !window.confirm("Replace the current flow with the imported one?")) return;
        setFlowName(imported.name);
        setNodes(imported.nodes);
        setEdges(imported.edges);
        setExtra(imported.extra);
        setImportNotes([]);
        setNotice({ kind: "ok", text: `Imported “${imported.name}” — ${imported.nodes.length} steps.` });
        setFitRequest((k) => k + 1);
      } catch (err) {
        setNotice({
          kind: "error",
          text: err instanceof SyntaxError ? "That file isn't valid JSON." : (err as Error).message,
        });
      }
    },
    [nodes.length, setNodes, setEdges],
  );

  const applyPdfPages = useCallback(
    (pages: DiagramPage[], fileName: string) => {
      const name = flowName.trim() || fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ");
      const { flow: built, notes } = buildFlowFromPages(pages, name);
      setFlowName(name);
      setNodes(built.nodes);
      setEdges(built.edges);
      setExtra({});
      setImportNotes(notes);
      setPdfPages(null);
      const pageList = pages.map((p) => p.pageNumber).join(", ");
      setNotice({
        kind: "ok",
        text: `Built ${built.nodes.length} steps from page ${pageList}. Check the notes and warnings on the right, then download.`,
      });
      setFitRequest((k) => k + 1);
    },
    [flowName, setNodes, setEdges],
  );

  const pdfFileName = useRef("");
  const handlePdf = useCallback(
    async (file: File) => {
      if (nodes.length > 0 && !window.confirm("Replace the current flow with the one from this PDF?")) return;
      setPdfBusy(true);
      setNotice(null);
      try {
        const pages = await readDiagramPdf(file);
        pdfFileName.current = file.name;
        const usable = pages.filter((p) => !p.crossedOut);
        // One page that isn't crossed out: no need to ask.
        if (usable.length === 1) applyPdfPages(usable, file.name);
        else setPdfPages(pages);
      } catch (err) {
        setNotice({ kind: "error", text: `Couldn't read that PDF: ${(err as Error).message}` });
      } finally {
        setPdfBusy(false);
      }
    },
    [nodes.length, applyPdfPages],
  );

  const handleNew = useCallback(() => {
    if (nodes.length > 0 && !window.confirm("Start a new flow? The current one will be cleared.")) return;
    setFlowName("");
    setNodes([]);
    setEdges([]);
    setExtra({});
    setImportNotes([]);
    setNotice(null);
  }, [nodes.length, setNodes, setEdges]);

  const focusNode = useCallback(
    (nodeId: string) => {
      setNodes((current) => current.map((n) => ({ ...n, selected: n.id === nodeId })));
      fitView({ nodes: [{ id: nodeId }], padding: 1, duration: 300, maxZoom: 1.2 });
    },
    [setNodes, fitView],
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex select-none flex-wrap items-center gap-2 border-b border-black/10 px-4 py-2 dark:border-white/15">
        <h1 className="mr-2 text-sm font-semibold">WATI Flow Builder</h1>
        <input
          value={flowName}
          onChange={(e) => setFlowName(e.target.value)}
          placeholder="Flow name"
          className="w-48 rounded-md border border-black/15 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-white/20"
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ToolbarButton onClick={handleNew}>New</ToolbarButton>
          <button
            type="button"
            onClick={() => pdfRef.current?.click()}
            disabled={pdfBusy}
            className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pdfBusy ? "Reading PDF…" : "Import Canva PDF"}
          </button>
          <input
            ref={pdfRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handlePdf(file);
              e.target.value = "";
            }}
          />
          <ToolbarButton onClick={() => importRef.current?.click()}>Open WATI JSON</ToolbarButton>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={handleExport}
            disabled={nodes.length === 0}
            className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            Download WATI JSON
          </button>
        </div>
      </header>

      {notice && (
        <div
          className={`flex items-center justify-between px-4 py-1.5 text-sm ${
            notice.kind === "ok"
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "bg-red-500/10 text-red-600 dark:text-red-400"
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" className="text-xs opacity-70 hover:opacity-100" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex shrink-0 select-none gap-1.5 overflow-x-auto border-b border-black/10 p-2 lg:w-52 lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-r dark:border-white/15">
          <p className="hidden px-1 pb-1 text-xs text-black/50 lg:block dark:text-white/50">
            <span className="font-medium">Add a step.</span> If a step is selected, the new one is connected
            after it.
          </p>
          {ALL_NODE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => addNode(type)}
              title={NODE_TYPE_DESCRIPTIONS[type]}
              className="flex shrink-0 items-center gap-2 rounded-md border border-black/10 px-2 py-1.5 text-left text-xs hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
            >
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TYPE_COLORS[type]}`} />
              <span className="whitespace-nowrap">{NODE_TYPE_LABELS[type]}</span>
            </button>
          ))}
          <Link
            href="/from-diagram"
            className="hidden px-1 pt-3 text-[11px] text-black/40 underline lg:block dark:text-white/40"
          >
            Optional: generate from a PDF diagram (needs an Anthropic API key)
          </Link>
        </aside>

        <div ref={canvasRef} className="relative min-h-[50vh] flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            colorMode="system"
            minZoom={0.05}
            fitView
            deleteKeyCode={["Delete", "Backspace"]}
            defaultEdgeOptions={{ type: "smoothstep" }}
          >
            <Background gap={20} />
            <Controls />
            <MiniMap pannable zoomable className="hidden sm:block" />
          </ReactFlow>
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="max-w-sm rounded-lg border border-dashed border-black/20 bg-white/80 p-5 text-center text-sm text-black/60 dark:border-white/25 dark:bg-black/60 dark:text-white/60">
                Click <strong>Import Canva PDF</strong> to build the flow from your diagram, add steps from the
                list, or open an existing WATI export. Your work is saved in this browser automatically.
              </div>
            </div>
          )}
        </div>

        <aside className="max-h-[45vh] shrink-0 overflow-y-auto border-t border-black/10 p-4 lg:max-h-none lg:w-80 lg:border-l lg:border-t-0 dark:border-white/15">
          {selected && selectedCount === 1 ? (
            <Inspector
              key={selected.id}
              node={selected}
              onChange={(fields) => updateFields(selected.id, fields)}
              onMakeStart={() => makeStart(selected.id)}
              onDelete={() => deleteNode(selected.id)}
              onDuplicate={() => duplicateNode(selected.id)}
              onAddFallback={() => addFallback(selected.id)}
              onClearNote={() =>
                setNodes((current) =>
                  current.map((n) => {
                    if (n.id !== selected.id) return n;
                    const data = { ...n.data };
                    delete data.note;
                    return { ...n, data };
                  }),
                )
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Checks</h2>
              {importNotes.length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">From the PDF</span>
                    <button
                      type="button"
                      className="text-[11px] opacity-60 hover:opacity-100"
                      onClick={() => setImportNotes([])}
                    >
                      Dismiss
                    </button>
                  </div>
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-xs">
                    {importNotes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
              {nodes.length > 0 && issues.length === 0 && (
                <p className="rounded-md bg-emerald-500/10 p-2.5 text-sm text-emerald-700 dark:text-emerald-300">
                  No problems found — ready to download.
                </p>
              )}
              {issues.length > 0 && (
                <p className="text-xs text-black/50 dark:text-white/50">
                  {errorCount} problem(s), {warningCount} warning(s). Click one to jump to that step.
                </p>
              )}
              <ul className="flex flex-col gap-1.5">
                {issues.map((issue, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      disabled={!issue.nodeId}
                      onClick={() => issue.nodeId && focusNode(issue.nodeId)}
                      className={`w-full rounded-md px-2.5 py-1.5 text-left text-xs ${
                        issue.level === "error"
                          ? "bg-red-500/10 text-red-700 dark:text-red-300"
                          : "bg-amber-500/10 text-amber-800 dark:text-amber-200"
                      }`}
                    >
                      {issue.message}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="pt-2 text-[11px] text-black/40 dark:text-white/40">
                Select a step to edit it. Steps marked “No match” handle customers who type instead of tapping an
                option.
              </p>
            </div>
          )}
        </aside>
      </div>

      {pdfPages && (
        <PagePicker
          pages={pdfPages}
          onCancel={() => setPdfPages(null)}
          onConfirm={(chosen) => applyPdfPages(chosen, pdfFileName.current)}
        />
      )}
    </div>
  );
}

function PagePicker({
  pages,
  onCancel,
  onConfirm,
}: {
  pages: DiagramPage[];
  onCancel: () => void;
  onConfirm: (pages: DiagramPage[]) => void;
}) {
  const [chosen, setChosen] = useState<Set<number>>(
    () => new Set(pages.filter((p) => !p.crossedOut).map((p) => p.pageNumber)),
  );
  const toggle = (n: number) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-lg bg-white p-5 text-black shadow-xl dark:bg-neutral-900 dark:text-white">
        <div>
          <h2 className="text-lg font-semibold">Which pages should be built?</h2>
          <p className="text-sm text-black/60 dark:text-white/60">
            Crossed-out pages are skipped automatically. Each chosen page is added to the flow.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {pages.map((p) => (
            <label
              key={p.pageNumber}
              className={`flex cursor-pointer flex-col gap-1.5 rounded-md border p-2 ${
                chosen.has(p.pageNumber) ? "border-blue-500 ring-2 ring-blue-500/30" : "border-black/15 dark:border-white/20"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumbnail} alt={`Page ${p.pageNumber}`} className="w-full rounded border border-black/10" />
              <span className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={chosen.has(p.pageNumber)} onChange={() => toggle(p.pageNumber)} />
                Page {p.pageNumber}
                {p.crossedOut && <span className="text-xs text-red-600 dark:text-red-400">crossed out</span>}
              </span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <ToolbarButton onClick={onCancel}>Cancel</ToolbarButton>
          <button
            type="button"
            disabled={chosen.size === 0}
            onClick={() => onConfirm(pages.filter((p) => chosen.has(p.pageNumber)))}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Build flow
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
    >
      {children}
    </button>
  );
}

export function FlowEditor() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}
