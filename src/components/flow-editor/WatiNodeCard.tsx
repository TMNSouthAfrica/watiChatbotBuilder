"use client";

import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { useEffect } from "react";
import type { EditorNode } from "@/lib/wati/convert";
import { nodePreview, outputsFor } from "@/lib/wati/nodes";
import { NODE_TYPE_LABELS, TERMINAL_TYPES, type WatiNodeType } from "@/lib/wati/types";

export const TYPE_COLORS: Record<string, string> = {
  Message: "bg-emerald-600",
  Question: "bg-sky-600",
  InteractiveButtons: "bg-violet-600",
  InteractiveList: "bg-fuchsia-600",
  Condition: "bg-amber-600",
  UpdateAttribute: "bg-slate-600",
  InteractiveWhatsAppFlow: "bg-teal-600",
  AssignTeam: "bg-rose-600",
  AssignAgent: "bg-rose-600",
  UpdateChatTopicName: "bg-slate-600",
  UpdateChatStatus: "bg-rose-700",
};

export function WatiNodeCard({ id, data, selected }: NodeProps<EditorNode>) {
  const type = data.flowNodeType;
  const outputs = outputsFor(id, type, data.fields);
  const preview = nodePreview(type, data.fields);
  const updateNodeInternals = useUpdateNodeInternals();
  const handleKey = outputs.map((o) => o.id ?? "").join("|");

  // Buttons/rows can be added or removed; React Flow must re-measure handles.
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, handleKey, updateNodeInternals]);

  return (
    <div
      className={`w-60 rounded-lg border bg-white text-black shadow-sm dark:bg-neutral-900 dark:text-white ${
        selected ? "border-blue-500 ring-2 ring-blue-500/40" : "border-black/15 dark:border-white/20"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-neutral-500" />
      <div
        className={`flex items-center justify-between rounded-t-lg px-3 py-1.5 text-xs font-semibold text-white ${
          TYPE_COLORS[type] ?? "bg-neutral-600"
        }`}
      >
        <span>{NODE_TYPE_LABELS[type as WatiNodeType] ?? type}</span>
        {data.isStartNode && (
          <span className="rounded bg-white/25 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Start</span>
        )}
      </div>
      <div className="line-clamp-3 min-h-8 whitespace-pre-line px-3 py-2 text-xs text-black/70 dark:text-white/70">
        {preview || <span className="italic opacity-60">Click to edit</span>}
      </div>

      {outputs.length === 1 && outputs[0].id === null ? (
        <Handle type="source" position={Position.Right} className="!h-3 !w-3 !bg-neutral-500" />
      ) : (
        outputs.length > 0 && (
          <div className="border-t border-black/10 dark:border-white/10">
            {outputs.map((out) => (
              <div
                key={out.id}
                className="relative border-b border-black/5 px-3 py-1 text-right text-[11px] last:border-b-0 dark:border-white/5"
              >
                <span className={out.label === "No match" ? "italic opacity-60" : ""}>{out.label}</span>
                <Handle
                  type="source"
                  id={out.id ?? undefined}
                  position={Position.Right}
                  className="!h-3 !w-3 !bg-neutral-500"
                />
              </div>
            ))}
          </div>
        )
      )}

      {TERMINAL_TYPES.has(type) && (
        <div className="border-t border-black/10 px-3 py-1 text-[10px] uppercase tracking-wide text-black/40 dark:border-white/10 dark:text-white/40">
          Ends the flow
        </div>
      )}
    </div>
  );
}
