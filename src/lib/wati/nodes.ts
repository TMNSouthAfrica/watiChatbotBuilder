// Per-node-type defaults, output handles and display helpers. Everything here
// is deterministic — no AI involved.

import {
  TERMINAL_TYPES,
  type AttributeVariable,
  type ButtonItem,
  type FlowCondition,
  type FlowReply,
  type ListSection,
  type WatiNodeType,
} from "./types";

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function randomId(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALNUM[Math.floor(Math.random() * ALNUM.length)];
  return out;
}

const TYPE_SLUGS: Record<WatiNodeType, string> = {
  Message: "message",
  Question: "question",
  InteractiveButtons: "buttons",
  InteractiveList: "list",
  Condition: "condition",
  UpdateAttribute: "updateAttribute",
  InteractiveWhatsAppFlow: "interactiveWhatsAppFlow",
  AssignTeam: "assignTeam",
  AssignAgent: "assignAgent",
  UpdateChatTopicName: "updateChatTopicName",
  UpdateChatStatus: "updateChatStatus",
};

/**
 * Node ids follow WATI's own "main_<type>-<5 letters>" convention, e.g.
 * "main_buttons-LSJdF". (The flow name argument is kept for callers but WATI
 * always uses "main".)
 */
export function newNodeId(type: WatiNodeType, _flowName: string, taken: Set<string>): string {
  let id: string;
  do {
    id = `main_${TYPE_SLUGS[type]}-${randomId(5)}`;
  } while (taken.has(id));
  return id;
}

export function newItemId(): string {
  return randomId(7);
}

/** Default WATI fields for a freshly added node of the given type. */
export function defaultFields(type: WatiNodeType): Record<string, unknown> {
  switch (type) {
    case "Message":
      return {
        flowReplies: [
          { flowReplyType: "Text", data: "", caption: "", mimeType: "" } satisfies FlowReply,
        ],
      };
    case "Question":
      return {
        flowReplies: [
          { flowReplyType: "Text", data: "", caption: "", mimeType: "" } satisfies FlowReply,
        ],
        userInputVariable: "",
        answerValidation: {
          type: "None",
          minValue: "",
          maxValue: "",
          regex: "",
          fallback: "",
          failsCount: "3",
        },
        isMediaAccepted: false,
        expectedAnswers: null,
      };
    case "InteractiveButtons":
      return {
        interactiveButtonsHeader: { type: "Text", text: "", media: null },
        interactiveButtonsBody: "",
        interactiveButtonsFooter: "",
        interactiveButtonsItems: [
          { id: newItemId(), buttonText: "Yes", nodeResultId: "" },
          { id: newItemId(), buttonText: "No", nodeResultId: "" },
        ] satisfies ButtonItem[],
        interactiveButtonsUserInputVariable: "",
        interactiveButtonsDefaultNodeResultId: "",
      };
    case "InteractiveList":
      return {
        interactiveListHeader: { type: "Text", text: "" },
        interactiveListBody: "",
        interactiveListFooter: "",
        interactiveListButtonText: "View Options",
        interactiveListSections: [
          {
            id: newItemId(),
            title: "",
            rows: [
              { id: newItemId(), title: "Option 1", description: "", nodeResultId: "" },
              { id: newItemId(), title: "Option 2", description: "", nodeResultId: "" },
            ],
          },
        ] satisfies ListSection[],
        interactiveListUserInputVariable: "",
        interactiveListDefaultNodeResultId: "",
      };
    case "Condition":
      return {
        flowNodeConditions: [
          { id: newItemId(), flowConditionType: "Equal", variable: "", value: "" },
        ] satisfies FlowCondition[],
        conditionResult: { yResultNodeId: "", nResultNodeId: "" },
        conditionOperator: "None",
      };
    case "UpdateAttribute":
      return {
        attributeVariables: [
          { type: "ContactCustomParameter", name: "", value: "" },
        ] satisfies AttributeVariable[],
      };
    case "InteractiveWhatsAppFlow":
      return {
        interactiveWhatsAppFlowHeader: { type: "Text", text: "", media: null },
        interactiveWhatsAppFlowBody: "",
        interactiveWhatsAppFlowButton: "Fill In",
        interactiveWhatsAppFlowFooter: "",
        whatsAppFlowId: "",
        isFallbackEnabled: true,
        fallbackMessage: "",
        fallbackMaxRetryCount: 3,
        userInputVariable: null,
      };
    case "AssignTeam":
      return {
        teamIds: [],
        isRoundRobinAssign: false,
        isContactOwnerAssign: false,
        skipOfflineUsers: false,
        assignDuringNonWorkingHours: false,
        assignToAdmin: false,
        reassignmentRule: null,
        loadBasedMaxOpenChats: null,
        noResponseMinutes: null,
      };
    case "AssignAgent":
      return { agentId: "", kbotBotActionId: null };
    case "UpdateChatTopicName":
      return { topicName: "", tagList: [] };
    case "UpdateChatStatus":
      return { status: "TicketClosing" };
  }
}

export interface OutputHandle {
  /** React Flow handle id; null for the single unnamed output. */
  id: string | null;
  label: string;
}

/** The handle id WATI uses for a Buttons/List node's "no match" fallback. */
export function defaultHandleId(nodeId: string): string {
  return `${nodeId}-default`;
}

/** Output handles a node exposes, in display order. */
export function outputsFor(
  nodeId: string,
  type: string,
  fields: Record<string, unknown>,
): OutputHandle[] {
  if (TERMINAL_TYPES.has(type)) return [];
  switch (type) {
    case "Condition":
      return [
        { id: "true", label: "True" },
        { id: "false", label: "False" },
      ];
    case "InteractiveButtons": {
      const items = (fields.interactiveButtonsItems as ButtonItem[] | undefined) ?? [];
      return [
        ...items.map((b) => ({ id: b.id, label: b.buttonText || "(empty button)" })),
        { id: defaultHandleId(nodeId), label: "No match" },
      ];
    }
    case "InteractiveList": {
      const sections = (fields.interactiveListSections as ListSection[] | undefined) ?? [];
      return [
        ...sections.flatMap((s) =>
          s.rows.map((r) => ({ id: r.id, label: r.title || "(empty row)" })),
        ),
        { id: defaultHandleId(nodeId), label: "No match" },
      ];
    }
    default:
      return [{ id: null, label: "" }];
  }
}

// ---- Rich text ----------------------------------------------------------
// WATI stores message text as simple HTML ("<p>…</p>"). The editor shows it
// as plain text; text is only re-encoded when the user edits it, so imported
// formatting survives untouched otherwise.

export function htmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<p[^>]*>\s*<br\s*\/?>\s*<\/p>/gi, "<p></p>")
    .replace(/<br\s*\/?>\s*\n?/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Same shape WATI writes: one <p> per line, "<p><br></p>" for a blank line. */
export function textToHtml(text: string): string {
  if (!text) return "";
  return text
    .split("\n")
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : "<p><br></p>"))
    .join("\n");
}

/** A one-line summary of a node's content, for the canvas card. */
export function nodePreview(type: string, fields: Record<string, unknown>): string {
  const replies = (fields.flowReplies as FlowReply[] | undefined) ?? [];
  switch (type) {
    case "Message":
      return replies
        .map((r) =>
          r.flowReplyType === "Text"
            ? htmlToText(r.data || r.caption)
            : `[${r.flowReplyType}]${r.caption ? ` ${htmlToText(r.caption)}` : ""}`,
        )
        .join(" · ");
    case "Question":
      return htmlToText(replies[0]?.data ?? "");
    case "InteractiveButtons":
      return htmlToText(String(fields.interactiveButtonsBody ?? ""));
    case "InteractiveList":
      return htmlToText(String(fields.interactiveListBody ?? ""));
    case "Condition": {
      const c = (fields.flowNodeConditions as FlowCondition[] | undefined)?.[0];
      if (!c) return "";
      return c.flowConditionType === "KeywordContains" && !c.value
        ? `${c.variable} has a value?`
        : `${c.variable} ${c.flowConditionType === "Equal" ? "=" : "contains"} "${c.value}"`;
    }
    case "UpdateAttribute":
      return ((fields.attributeVariables as AttributeVariable[] | undefined) ?? [])
        .map((a) => `${a.name} ← ${a.value}`)
        .join(", ");
    case "InteractiveWhatsAppFlow":
      return htmlToText(String(fields.interactiveWhatsAppFlowBody ?? ""));
    case "AssignTeam": {
      const ids = (fields.teamIds as string[] | undefined) ?? [];
      return ids.length ? `Team ${ids.join(", ")}` : "Team ID not set";
    }
    case "AssignAgent":
      return fields.agentId ? `Agent ${String(fields.agentId)}` : "Agent ID not set";
    case "UpdateChatTopicName":
      return String(fields.topicName ?? "");
    case "UpdateChatStatus":
      return String(fields.status ?? "");
    case "Webhook":
      return `${String(fields.methodType ?? "").toUpperCase()} ${String(fields.url ?? "")}`.trim();
    case "TimeDelay":
      return `Wait ${String(fields.delaySeconds ?? 0)} s`;
    default:
      return "";
  }
}
