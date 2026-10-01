"use client";

import { useState, type ReactNode } from "react";
import type { EditorNode } from "@/lib/wati/convert";
import { htmlToText, newItemId, textToHtml } from "@/lib/wati/nodes";
import {
  MAX_BUTTON_TEXT,
  MAX_BUTTONS,
  MAX_LIST_BUTTON_TEXT,
  MAX_LIST_ROW_DESCRIPTION,
  MAX_LIST_ROW_TITLE,
  MAX_LIST_ROWS,
  NODE_TYPE_DESCRIPTIONS,
  NODE_TYPE_LABELS,
  type AttributeVariable,
  type ButtonItem,
  type FlowCondition,
  type FlowReply,
  type ListSection,
  type WatiNodeType,
} from "@/lib/wati/types";

type Fields = Record<string, unknown>;

interface InspectorProps {
  node: EditorNode;
  onChange: (fields: Fields) => void;
  onMakeStart: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAddFallback: () => void;
}

const inputClass =
  "w-full rounded-md border border-black/15 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-white/20";

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-black/50 dark:text-white/50">{hint}</span>}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  const over = maxLength !== undefined && value.length > maxLength;
  return (
    <div className="relative">
      <input
        className={`${inputClass} ${over ? "border-red-500" : ""} ${maxLength ? "pr-12" : ""}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {maxLength !== undefined && (
        <span
          className={`absolute right-2 top-1/2 -translate-y-1/2 text-[10px] ${
            over ? "text-red-500" : "text-black/40 dark:text-white/40"
          }`}
        >
          {value.length}/{maxLength}
        </span>
      )}
    </div>
  );
}

/** A comma-separated list, committed on blur so commas can be typed. */
function CommaListInput({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className={inputClass}
      value={draft ?? values.join(", ")}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        onChange(
          draft
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
        setDraft(null);
      }}
    />
  );
}

/** Edits WATI's "<p>…</p>" rich text as plain text. */
function RichText({
  html,
  onChange,
  placeholder,
  rows = 4,
}: {
  html: string;
  onChange: (html: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      className={inputClass}
      rows={rows}
      value={htmlToText(html)}
      placeholder={placeholder}
      onChange={(e) => onChange(textToHtml(e.target.value))}
    />
  );
}

function SmallButton({
  onClick,
  children,
  danger,
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-40 ${
        danger
          ? "border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400"
          : "border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

export function Inspector({ node, onChange, onMakeStart, onDelete, onDuplicate, onAddFallback }: InspectorProps) {
  const type = node.data.flowNodeType;
  const f = node.data.fields;
  const set = (patch: Fields) => onChange({ ...f, ...patch });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">{NODE_TYPE_LABELS[type as WatiNodeType] ?? type}</h2>
        <p className="text-xs text-black/50 dark:text-white/50">
          {NODE_TYPE_DESCRIPTIONS[type as WatiNodeType] ?? "Imported step type — its settings are kept as-is."}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {node.data.isStartNode ? (
          <span className="rounded-md bg-blue-500/15 px-2 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
            Start step
          </span>
        ) : (
          <SmallButton onClick={onMakeStart}>Make start</SmallButton>
        )}
        <SmallButton onClick={onDuplicate}>Duplicate</SmallButton>
        <SmallButton onClick={onDelete} danger>
          Delete
        </SmallButton>
      </div>

      {type === "Message" && <MessageFields f={f} set={set} />}
      {type === "Question" && <QuestionFields f={f} set={set} />}
      {type === "InteractiveButtons" && <ButtonsFields f={f} set={set} onAddFallback={onAddFallback} />}
      {type === "InteractiveList" && <ListFields f={f} set={set} onAddFallback={onAddFallback} />}
      {type === "Condition" && <ConditionFields f={f} set={set} />}
      {type === "UpdateAttribute" && <AttributeFields f={f} set={set} />}
      {type === "InteractiveWhatsAppFlow" && <WhatsAppFlowFields f={f} set={set} />}
      {type === "AssignTeam" && <AssignTeamFields f={f} set={set} />}
      {type === "AssignAgent" && (
        <Field label="Agent ID" hint="Find this in WATI. Can be left blank and set after importing.">
          <TextInput value={String(f.agentId ?? "")} onChange={(v) => set({ agentId: v })} />
        </Field>
      )}
      {type === "UpdateChatTopicName" && <TopicFields f={f} set={set} />}
      {type === "UpdateChatStatus" && (
        <Field label="Status" hint="“TicketClosing” closes the chat.">
          <input
            className={inputClass}
            list="wati-chat-statuses"
            value={String(f.status ?? "")}
            onChange={(e) => set({ status: e.target.value })}
          />
          <datalist id="wati-chat-statuses">
            <option value="TicketClosing" />
          </datalist>
        </Field>
      )}

      <p className="text-[11px] text-black/40 dark:text-white/40">
        Drag from a dot on the right of a step to the left side of another step to connect them. Select a
        line and press Delete to remove it.
      </p>
    </div>
  );
}

interface FieldsProps {
  f: Fields;
  set: (patch: Fields) => void;
}

function MessageFields({ f, set }: FieldsProps) {
  const replies = (f.flowReplies as FlowReply[] | undefined) ?? [];
  const update = (i: number, patch: Partial<FlowReply>) =>
    set({ flowReplies: replies.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <div className="flex flex-col gap-3">
      {replies.map((r, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-md border border-black/10 p-2.5 dark:border-white/15">
          <div className="flex items-center justify-between">
            <select
              className="rounded border border-black/15 bg-transparent px-1.5 py-0.5 text-xs dark:border-white/20"
              value={r.flowReplyType}
              onChange={(e) => update(i, { flowReplyType: e.target.value })}
            >
              <option value="Text">Text</option>
              <option value="Image">Image</option>
              {!["Text", "Image"].includes(r.flowReplyType) && (
                <option value={r.flowReplyType}>{r.flowReplyType}</option>
              )}
            </select>
            {replies.length > 1 && (
              <SmallButton danger onClick={() => set({ flowReplies: replies.filter((_, j) => j !== i) })}>
                Remove
              </SmallButton>
            )}
          </div>
          {r.flowReplyType !== "Text" && (
            <Field label="Media URL" hint="A public link to the image.">
              <TextInput value={r.data} onChange={(v) => update(i, { data: v })} placeholder="https://…" />
            </Field>
          )}
          <Field label={r.flowReplyType === "Text" ? "Message text" : "Caption"}>
            <RichText html={r.caption} onChange={(caption) => update(i, { caption })} />
          </Field>
        </div>
      ))}
      <SmallButton
        onClick={() =>
          set({ flowReplies: [...replies, { flowReplyType: "Text", data: "", caption: "", mimeType: "" }] })
        }
      >
        + Add another message
      </SmallButton>
    </div>
  );
}

function QuestionFields({ f, set }: FieldsProps) {
  const replies = (f.flowReplies as FlowReply[] | undefined) ?? [];
  const first = replies[0] ?? { flowReplyType: "Text", data: "", caption: "", mimeType: "" };
  const validation = (f.answerValidation as Record<string, unknown> | undefined) ?? {};
  const setValidation = (patch: Record<string, unknown>) =>
    set({ answerValidation: { ...validation, ...patch } });

  return (
    <div className="flex flex-col gap-3">
      <Field label="Question">
        <RichText
          html={first.data}
          onChange={(data) => set({ flowReplies: [{ ...first, data }, ...replies.slice(1)] })}
        />
      </Field>
      <Field label="Save answer to variable" hint="e.g. customer_name — leave blank to not save it.">
        <TextInput value={String(f.userInputVariable ?? "")} onChange={(v) => set({ userInputVariable: v })} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={f.isMediaAccepted === true}
          onChange={(e) => set({ isMediaAccepted: e.target.checked })}
        />
        Accept images / files as an answer
      </label>
      {String(validation.type ?? "None") !== "None" && (
        <p className="text-xs text-black/50 dark:text-white/50">
          Answer validation: <code>{String(validation.type)}</code> (kept from the imported file).
        </p>
      )}
      <Field label="Retry message" hint="Sent if the answer is invalid.">
        <TextInput value={String(validation.fallback ?? "")} onChange={(v) => setValidation({ fallback: v })} />
      </Field>
    </div>
  );
}

function ButtonsFields({ f, set, onAddFallback }: FieldsProps & { onAddFallback: () => void }) {
  const items = (f.interactiveButtonsItems as ButtonItem[] | undefined) ?? [];
  const header = (f.interactiveButtonsHeader as Record<string, unknown> | undefined) ?? {};

  return (
    <div className="flex flex-col gap-3">
      <Field label="Header (optional)">
        <TextInput
          value={String(header.text ?? "")}
          onChange={(v) => set({ interactiveButtonsHeader: { type: "Text", media: null, ...header, text: v } })}
        />
      </Field>
      <Field label="Message text">
        <RichText
          html={String(f.interactiveButtonsBody ?? "")}
          onChange={(v) => set({ interactiveButtonsBody: v })}
        />
      </Field>
      <Field label="Footer (optional)">
        <TextInput
          value={String(f.interactiveButtonsFooter ?? "")}
          onChange={(v) => set({ interactiveButtonsFooter: v })}
        />
      </Field>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium">Buttons (max {MAX_BUTTONS})</span>
        {items.map((b, i) => (
          <div key={b.id} className="flex items-center gap-2">
            <div className="flex-1">
              <TextInput
                value={b.buttonText}
                maxLength={MAX_BUTTON_TEXT}
                onChange={(v) =>
                  set({ interactiveButtonsItems: items.map((x, j) => (j === i ? { ...x, buttonText: v } : x)) })
                }
              />
            </div>
            <SmallButton
              danger
              onClick={() => set({ interactiveButtonsItems: items.filter((_, j) => j !== i) })}
            >
              ✕
            </SmallButton>
          </div>
        ))}
        <SmallButton
          disabled={items.length >= MAX_BUTTONS}
          onClick={() =>
            set({
              interactiveButtonsItems: [
                ...items,
                { id: newItemId(), buttonText: `Option ${items.length + 1}`, nodeResultId: "" },
              ],
            })
          }
        >
          + Add button
        </SmallButton>
        {items.length >= MAX_BUTTONS && (
          <span className="text-[11px] text-black/50 dark:text-white/50">
            Need more than {MAX_BUTTONS}? Use a List step instead.
          </span>
        )}
      </div>
      <Field label="Save chosen button to variable (optional)">
        <TextInput
          value={String(f.interactiveButtonsUserInputVariable ?? "")}
          onChange={(v) => set({ interactiveButtonsUserInputVariable: v })}
        />
      </Field>
      <FallbackHelp onAddFallback={onAddFallback} />
    </div>
  );
}

function ListFields({ f, set, onAddFallback }: FieldsProps & { onAddFallback: () => void }) {
  const sections = (f.interactiveListSections as ListSection[] | undefined) ?? [];
  const header = (f.interactiveListHeader as Record<string, unknown> | undefined) ?? {};
  const totalRows = sections.reduce((n, s) => n + s.rows.length, 0);
  const setSections = (next: ListSection[]) => set({ interactiveListSections: next });
  const updateSection = (si: number, patch: Partial<ListSection>) =>
    setSections(sections.map((s, j) => (j === si ? { ...s, ...patch } : s)));

  return (
    <div className="flex flex-col gap-3">
      <Field label="Header (optional)">
        <TextInput
          value={String(header.text ?? "")}
          onChange={(v) => set({ interactiveListHeader: { type: "Text", ...header, text: v } })}
        />
      </Field>
      <Field label="Message text">
        <RichText html={String(f.interactiveListBody ?? "")} onChange={(v) => set({ interactiveListBody: v })} />
      </Field>
      <Field label="Footer (optional)">
        <TextInput value={String(f.interactiveListFooter ?? "")} onChange={(v) => set({ interactiveListFooter: v })} />
      </Field>
      <Field label="Menu button text">
        <TextInput
          value={String(f.interactiveListButtonText ?? "")}
          maxLength={MAX_LIST_BUTTON_TEXT}
          onChange={(v) => set({ interactiveListButtonText: v })}
        />
      </Field>

      <span className="text-xs font-medium">
        Options ({totalRows}/{MAX_LIST_ROWS})
      </span>
      {sections.map((s, si) => (
        <div key={s.id} className="flex flex-col gap-2 rounded-md border border-black/10 p-2.5 dark:border-white/15">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <TextInput
                value={s.title}
                placeholder="Section title (optional)"
                onChange={(v) => updateSection(si, { title: v })}
              />
            </div>
            {sections.length > 1 && (
              <SmallButton danger onClick={() => setSections(sections.filter((_, j) => j !== si))}>
                ✕
              </SmallButton>
            )}
          </div>
          {s.rows.map((r, ri) => (
            <div key={r.id} className="flex flex-col gap-1 border-l-2 border-black/10 pl-2 dark:border-white/15">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <TextInput
                    value={r.title}
                    maxLength={MAX_LIST_ROW_TITLE}
                    onChange={(v) =>
                      updateSection(si, { rows: s.rows.map((x, j) => (j === ri ? { ...x, title: v } : x)) })
                    }
                  />
                </div>
                <SmallButton danger onClick={() => updateSection(si, { rows: s.rows.filter((_, j) => j !== ri) })}>
                  ✕
                </SmallButton>
              </div>
              <TextInput
                value={r.description ?? ""}
                placeholder="Description (optional)"
                maxLength={MAX_LIST_ROW_DESCRIPTION}
                onChange={(v) =>
                  updateSection(si, { rows: s.rows.map((x, j) => (j === ri ? { ...x, description: v } : x)) })
                }
              />
            </div>
          ))}
          <SmallButton
            disabled={totalRows >= MAX_LIST_ROWS}
            onClick={() =>
              updateSection(si, {
                rows: [...s.rows, { id: newItemId(), title: `Option ${totalRows + 1}`, description: "", nodeResultId: "" }],
              })
            }
          >
            + Add option
          </SmallButton>
        </div>
      ))}
      <SmallButton onClick={() => setSections([...sections, { id: newItemId(), title: "", rows: [] }])}>
        + Add section
      </SmallButton>
      <Field label="Save chosen option to variable (optional)">
        <TextInput
          value={String(f.interactiveListUserInputVariable ?? "")}
          onChange={(v) => set({ interactiveListUserInputVariable: v })}
        />
      </Field>
      <FallbackHelp onAddFallback={onAddFallback} />
    </div>
  );
}

function FallbackHelp({ onAddFallback }: { onAddFallback: () => void }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-black/5 p-2.5 text-xs dark:bg-white/5">
      <span>
        <strong>No match</strong> is used when the customer types something instead of choosing an option.
      </span>
      <SmallButton onClick={onAddFallback}>Add “please choose an option” reply</SmallButton>
    </div>
  );
}

function ConditionFields({ f, set }: FieldsProps) {
  const conditions = (f.flowNodeConditions as FlowCondition[] | undefined) ?? [];
  const c = conditions[0] ?? { id: newItemId(), flowConditionType: "Equal", variable: "", value: "" };
  const update = (patch: Partial<FlowCondition>) =>
    set({ flowNodeConditions: [{ ...c, ...patch }, ...conditions.slice(1)] });

  return (
    <div className="flex flex-col gap-3">
      <Field label="Variable" hint="Use the {{variable_name}} format.">
        <TextInput value={c.variable} placeholder="{{customer_name}}" onChange={(v) => update({ variable: v })} />
      </Field>
      <Field label="Check">
        <select
          className={inputClass}
          value={c.flowConditionType}
          onChange={(e) => update({ flowConditionType: e.target.value })}
        >
          <option value="Equal">is equal to</option>
          <option value="KeywordContains">contains</option>
          {!["Equal", "KeywordContains"].includes(c.flowConditionType) && (
            <option value={c.flowConditionType}>{c.flowConditionType}</option>
          )}
        </select>
      </Field>
      <Field
        label="Value"
        hint={
          c.flowConditionType === "KeywordContains"
            ? "Leave empty to check “does this variable already have a value?”"
            : undefined
        }
      >
        <TextInput value={c.value} onChange={(v) => update({ value: v })} />
      </Field>
    </div>
  );
}

function AttributeFields({ f, set }: FieldsProps) {
  const attrs = (f.attributeVariables as AttributeVariable[] | undefined) ?? [];
  const update = (i: number, patch: Partial<AttributeVariable>) =>
    set({ attributeVariables: attrs.map((a, j) => (j === i ? { ...a, ...patch } : a)) });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-black/50 dark:text-white/50">
        Value can be <code>@variable_name</code> (the latest answer saved to that variable),{" "}
        <code>{"{{variable}}"}</code>, or plain text.
      </p>
      {attrs.map((a, i) => (
        <div key={i} className="flex flex-col gap-1.5 rounded-md border border-black/10 p-2.5 dark:border-white/15">
          <TextInput value={a.name} placeholder="Attribute name" onChange={(v) => update(i, { name: v })} />
          <TextInput value={a.value} placeholder="Value" onChange={(v) => update(i, { value: v })} />
          {attrs.length > 1 && (
            <SmallButton danger onClick={() => set({ attributeVariables: attrs.filter((_, j) => j !== i) })}>
              Remove
            </SmallButton>
          )}
        </div>
      ))}
      <SmallButton
        onClick={() =>
          set({ attributeVariables: [...attrs, { type: "ContactCustomParameter", name: "", value: "" }] })
        }
      >
        + Add attribute
      </SmallButton>
    </div>
  );
}

function WhatsAppFlowFields({ f, set }: FieldsProps) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="WhatsApp Flow ID" hint="The ID of a Flow already published in your WATI account.">
        <TextInput value={String(f.whatsAppFlowId ?? "")} onChange={(v) => set({ whatsAppFlowId: v })} />
      </Field>
      <Field label="Message text">
        <RichText
          html={String(f.interactiveWhatsAppFlowBody ?? "")}
          onChange={(v) => set({ interactiveWhatsAppFlowBody: v })}
        />
      </Field>
      <Field label="Button text">
        <TextInput
          value={String(f.interactiveWhatsAppFlowButton ?? "")}
          onChange={(v) => set({ interactiveWhatsAppFlowButton: v })}
        />
      </Field>
      <Field label="Footer (optional)">
        <TextInput
          value={String(f.interactiveWhatsAppFlowFooter ?? "")}
          onChange={(v) => set({ interactiveWhatsAppFlowFooter: v })}
        />
      </Field>
      <Field label="Retry message">
        <TextInput value={String(f.fallbackMessage ?? "")} onChange={(v) => set({ fallbackMessage: v })} />
      </Field>
    </div>
  );
}

function AssignTeamFields({ f, set }: FieldsProps) {
  const ids = (f.teamIds as string[] | undefined) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <Field label="Team ID(s)" hint="Separate several with commas. Can be left blank and set in WATI after importing.">
        <CommaListInput values={ids} onChange={(v) => set({ teamIds: v })} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={f.isRoundRobinAssign === true}
          onChange={(e) => set({ isRoundRobinAssign: e.target.checked })}
        />
        Round-robin between team members
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={f.skipOfflineUsers === true}
          onChange={(e) => set({ skipOfflineUsers: e.target.checked })}
        />
        Skip offline users
      </label>
    </div>
  );
}

function TopicFields({ f, set }: FieldsProps) {
  const tags = (f.tagList as string[] | undefined) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <Field label="Topic name">
        <TextInput value={String(f.topicName ?? "")} onChange={(v) => set({ topicName: v })} />
      </Field>
      <Field label="Tags" hint="Separate with commas.">
        <CommaListInput values={tags} onChange={(v) => set({ tagList: v })} />
      </Field>
    </div>
  );
}
