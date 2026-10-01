// Shapes for WATI's Chatbot Flow-Builder export/import format, and for the
// editor's own per-node data. See src/lib/wati-schema.ts for the reference
// notes these are derived from.

export type WatiNodeType =
  | "Message"
  | "Question"
  | "InteractiveButtons"
  | "InteractiveList"
  | "Condition"
  | "UpdateAttribute"
  | "InteractiveWhatsAppFlow"
  | "AssignTeam"
  | "AssignAgent"
  | "UpdateChatTopicName"
  | "UpdateChatStatus";

export interface WatiPosition {
  posX: string;
  posY: string;
}

/** A node as it appears in a WATI export. Type-specific fields vary. */
export interface WatiFlowNode {
  id: string;
  flowNodeType: string;
  flowNodePosition: WatiPosition;
  isStartNode: boolean;
  [field: string]: unknown;
}

export interface WatiFlowEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  [field: string]: unknown;
}

export interface WatiFlow {
  id: string | null;
  tenantId?: string | null;
  name: string;
  created: string | null;
  flowNodes: WatiFlowNode[];
  flowEdges: WatiFlowEdge[];
  lastUpdated: string | null;
  isDeleted: boolean;
  transform: unknown;
  isPro: boolean;
  flowVersion?: unknown;
  fallback?: unknown;
  channelTypes?: unknown;
  [field: string]: unknown;
}

export interface FlowReply {
  flowReplyType: string;
  data: string;
  caption: string;
  mimeType: string;
  [field: string]: unknown;
}

export interface ButtonItem {
  id: string;
  buttonText: string;
  nodeResultId?: string;
  [field: string]: unknown;
}

export interface ListRow {
  id: string;
  title: string;
  description: string;
  nodeResultId?: string;
  [field: string]: unknown;
}

export interface ListSection {
  id: string;
  title: string;
  rows: ListRow[];
  [field: string]: unknown;
}

export interface FlowCondition {
  id: string;
  flowConditionType: string;
  variable: string;
  value: string;
  [field: string]: unknown;
}

export interface AttributeVariable {
  type: string;
  name: string;
  value: string;
  [field: string]: unknown;
}

/**
 * Editor-side node data: the WATI node minus id/type/position/isStartNode
 * (which live on the React Flow node) and minus the routing fields
 * (nodeResultId, conditionResult, …), which are derived from edges on export.
 * Unknown fields from imported files are kept as-is so nothing is lost.
 */
export interface WatiNodeData {
  flowNodeType: string;
  isStartNode: boolean;
  fields: Record<string, unknown>;
  [key: string]: unknown;
}

/** Nodes that end the flow — nothing may flow out of them. */
export const TERMINAL_TYPES: ReadonlySet<string> = new Set([
  "AssignTeam",
  "AssignAgent",
  "UpdateChatStatus",
]);

export const NODE_TYPE_LABELS: Record<WatiNodeType, string> = {
  Message: "Message",
  Question: "Question",
  InteractiveButtons: "Buttons",
  InteractiveList: "List",
  Condition: "Condition",
  UpdateAttribute: "Update Attribute",
  InteractiveWhatsAppFlow: "WhatsApp Flow",
  AssignTeam: "Assign Team",
  AssignAgent: "Assign Agent",
  UpdateChatTopicName: "Set Topic",
  UpdateChatStatus: "Set Chat Status",
};

/** Step types WATI supports that the editor opens and keeps, but can't add. */
export const OTHER_TYPE_LABELS: Record<string, string> = {
  Webhook: "Webhook",
  TimeDelay: "Time Delay",
  InvokeFlow: "Go to Flow",
  MessageTemplate: "Template Message",
};

export const NODE_TYPE_DESCRIPTIONS: Record<WatiNodeType, string> = {
  Message: "Send text or an image, then continue",
  Question: "Ask a free-text question and save the reply",
  InteractiveButtons: "Up to 3 reply buttons",
  InteractiveList: "A menu of up to 10 options",
  Condition: "Branch on a variable (yes / no)",
  UpdateAttribute: "Save values to contact attributes",
  InteractiveWhatsAppFlow: "Open a WhatsApp Flow form",
  AssignTeam: "Hand the chat to a team (ends flow)",
  AssignAgent: "Hand the chat to an agent (ends flow)",
  UpdateChatTopicName: "Set the chat topic / tags",
  UpdateChatStatus: "Change chat status (ends flow)",
};

export const ALL_NODE_TYPES = Object.keys(NODE_TYPE_LABELS) as WatiNodeType[];

// WhatsApp API limits.
export const MAX_BUTTONS = 3;
export const MAX_BUTTON_TEXT = 20;
export const MAX_LIST_ROWS = 10;
export const MAX_LIST_ROW_TITLE = 24;
export const MAX_LIST_ROW_DESCRIPTION = 72;
export const MAX_LIST_BUTTON_TEXT = 20;
