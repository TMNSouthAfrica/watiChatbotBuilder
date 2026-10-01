// Reference schema for WATI's native Chatbot Flow-Builder export/import format.
// Checked against several real exported flows. This is fed to Claude as grounding so generated flows are
// actually importable into WATI, not a guessed/invented shape.

export const WATI_SCHEMA_GUIDE = `
# WATI Chatbot Flow JSON — reference schema

A WATI flow export is a single JSON object:

{
  "id": null,
  "tenantId": null,
  "name": "<flow name>",
  "created": null,
  "flowNodes": [ ...FlowNode ],
  "flowEdges": [ ...FlowEdge ],
  "lastUpdated": null,
  "isDeleted": false,
  "transform": {"posX": "0", "posY": "0", "zoom": "0.5"},
  "isPro": true,
  "channelTypes": ["WA"]
}

Every node has: "id" (string, unique, always "main_<type>-<5 letters>", where <type> is one of
message, question, buttons, list, condition, updateAttribute, interactiveWhatsAppFlow, assignTeam,
assignAgent, updateChatTopicName, updateChatStatus — e.g. "main_message-WjvTc", "main_buttons-LSJdF"), "flowNodeType", "flowNodePosition": {"posX":"<num string>","posY":"<num string>"},
and "isStartNode" (true on exactly ONE node — the entry point).

## Node types

### Message
Sends a message with no reply expected. Moves to exactly one next node via a flowEdge.
{
  "flowReplies": [{"flowReplyType": "Text", "data": "<p>message text</p>", "caption": "", "mimeType": ""}],
For a Text reply the text goes in "data" and "caption" is "". For "Image" / "Video" / "Document"
replies "data" is "" (the file is uploaded in WATI) and "caption" holds the caption — for a
Document, the file name (e.g. "Price-List-2025.pdf"). Multi-line text is one <p> per line joined
with "\n", with "<p><br></p>" for a blank line.
  "id": "...", "flowNodeType": "Message", "flowNodePosition": {...}, "isStartNode": false
}

### Question
Asks a free-text (or media) question and stores the raw reply.
{
  "flowReplies": [{"flowReplyType": "Text", "data": "<p>question text</p>", "caption": "", "mimeType": ""}],
  "userInputVariable": "<variable name to store the raw reply, or empty to not store>",
  "answerValidation": {"type": "None", "minValue": "", "maxValue": "", "regex": "", "fallback": "<retry message>", "failsCount": "3"},
  "isMediaAccepted": false,
  "expectedAnswers": null,
  "id": "...", "flowNodeType": "Question", "flowNodePosition": {...}, "isStartNode": false
}

### InteractiveButtons (max 3 buttons — WhatsApp API limit)
{
  "interactiveButtonsHeader": {"type": "Text", "text": "", "media": null},
  "interactiveButtonsBody": "<p>question text</p>",
  "interactiveButtonsFooter": "",
  "interactiveButtonsItems": [
    {"id": "<7 char alnum>", "buttonText": "<label, max ~20 chars>", "nodeResultId": "<target node id for this choice>"}
  ],
  "interactiveButtonsUserInputVariable": "<optional variable to store the chosen label>",
  "interactiveButtonsDefaultNodeResultId": "<fallback node id if reply doesn't match any button — usually a 'please pick an option' Message that loops back to this same node>",
  "id": "...", "flowNodeType": "InteractiveButtons", "flowNodePosition": {...}, "isStartNode": false
}

### InteractiveList (use when more than 3 options are needed)
{
  "interactiveListHeader": {"type": "Text", "text": ""},
  "interactiveListBody": "<p>question text</p>",
  "interactiveListFooter": "",
  "interactiveListButtonText": "View Options",
  "interactiveListSections": [
    {"id": "<7 char alnum>", "title": "", "rows": [
      {"id": "<7 char alnum>", "title": "<row label>", "description": "<optional subtext>", "nodeResultId": "<target node id>"}
    ]}
  ],
  "interactiveListUserInputVariable": "<optional variable to store the chosen row title>",
  "interactiveListDefaultNodeResultId": "<fallback node id>",
  "id": "...", "flowNodeType": "InteractiveList", "flowNodePosition": {...}, "isStartNode": false
}

### Condition (simple if/else branch — exactly one condition, no AND/OR chaining observed)
{
  "flowNodeConditions": [{"id": "<7 char alnum>", "flowConditionType": "Equal" | "KeywordContains", "variable": "{{variable_name}}", "value": "<string to compare>"}],
  "conditionResult": {"yResultNodeId": "<node id if true>", "nResultNodeId": "<node id if false>"},
  "conditionOperator": "None",
  "id": "...", "flowNodeType": "Condition", "flowNodePosition": {...}, "isStartNode": false
}
Use "Equal" for exact matches (e.g. checking a flag variable == "Yes") and "KeywordContains"
(with value "") as an "is this variable empty?" check — false means empty/unset, true means it
already has a value. This is the idiom used to skip re-asking for data already on file.

### UpdateAttribute (save one or more contact custom-attribute variables)
{
  "attributeVariables": [
    {"type": "ContactCustomParameter", "name": "<variable_name>", "value": "@<variable_name>" | "{{other_variable}}" | "<literal>"}
  ],
  "id": "...", "flowNodeType": "UpdateAttribute", "flowNodePosition": {...}, "isStartNode": false
}
"@variable_name" pulls the most recent captured reply for that variable (used right after a
Question/Buttons/List node that captured it). Chain multiple UpdateAttribute nodes to save
several fields captured from one WhatsApp Flow form (see InteractiveWhatsAppFlow below).

### InteractiveWhatsAppFlow (native WhatsApp Flow form — multi-field structured input)
{
  "interactiveWhatsAppFlowHeader": {"type": "Text", "text": "", "media": null},
  "interactiveWhatsAppFlowBody": "<p>intro text</p>",
  "interactiveWhatsAppFlowButton": "Fill In",
  "interactiveWhatsAppFlowFooter": "",
  "whatsAppFlowId": "<id of a WhatsApp Flow already published in the WATI account — cannot be invented, leave as a placeholder like \\"REPLACE_WITH_WHATSAPP_FLOW_ID\\" and call it out>",
  "isFallbackEnabled": true,
  "fallbackMessage": "<retry prompt>",
  "fallbackMaxRetryCount": 3,
  "userInputVariable": null,
  "id": "...", "flowNodeType": "InteractiveWhatsAppFlow", "flowNodePosition": {...}, "isStartNode": false
}
Fields collected by the form come back as "{{<flow_name>_screen_0_textinput_0}}" etc (0-indexed,
in field order) — the very next node is normally an UpdateAttribute mapping those into
readable variable names.

### AssignTeam / AssignAgent (hand off to a human)
AssignTeam: {"teamIds": ["<real WATI team id>"] | [], "isRoundRobinAssign": false, "isContactOwnerAssign": false,
  "skipOfflineUsers": false, "assignDuringNonWorkingHours": false, "assignToAdmin": false,
  "reassignmentRule": null, "loadBasedMaxOpenChats": null, "noResponseMinutes": null,
  "id": "...", "flowNodeType": "AssignTeam", "flowNodePosition": {...}, "isStartNode": false}
AssignAgent: {"agentId": "<real WATI agent id>" | "", "kbotBotActionId": null,
  "id": "...", "flowNodeType": "AssignAgent", "flowNodePosition": {...}, "isStartNode": false}
These are terminal nodes (no outgoing edge). Real team/agent IDs must come from the account —
leave "teamIds": [] / "agentId": "" when unknown and call it out rather than inventing an ID.

### UpdateChatTopicName / UpdateChatStatus (bookkeeping, non-terminal / terminal respectively)
UpdateChatTopicName: {"topicName": "<optional>", "tagList": [], "id": "...", "flowNodeType": "UpdateChatTopicName", ...}
UpdateChatStatus: {"status": "TicketClosing" | other WATI status, "id": "...", "flowNodeType": "UpdateChatStatus", ...} (terminal)

## flowEdges — how nodes connect

flowEdges is a flat array separate from the nodes; nodes do NOT nest their outgoing connections
except redundantly via nodeResultId / conditionResult (used by the WATI editor as the source of
truth for buttons/lists/conditions — flowEdges must agree with them).

Simple one-output nodes (Message, Question, UpdateAttribute, InteractiveWhatsAppFlow):
{"id": "reactflow__edge-<sourceId>-<targetId>", "sourceNodeId": "<sourceId>", "targetNodeId": "<targetId>"}

Condition nodes emit two edges using the literal suffixes "__true" / "__false":
{"id": "reactflow__edge-<sourceId>true-<yTargetId>", "sourceNodeId": "<sourceId>__true", "targetNodeId": "<yTargetId>"}
{"id": "reactflow__edge-<sourceId>false-<nTargetId>", "sourceNodeId": "<sourceId>__false", "targetNodeId": "<nTargetId>"}

InteractiveButtons / InteractiveList nodes emit one edge per button/row (suffix = that
item's own "id") PLUS one "default" edge for the no-match fallback, whose suffix is literally
"<sourceId>-default":
{"id": "reactflow__edge-<sourceId><itemId>-<targetId>", "sourceNodeId": "<sourceId>__<itemId>", "targetNodeId": "<targetId>"}
{"id": "reactflow__edge-<sourceId><sourceId>-default-<defaultTargetId>", "sourceNodeId": "<sourceId>__<sourceId>-default", "targetNodeId": "<defaultTargetId>"}
The default-fallback edge almost always points to a small "Please select one of the options
below to proceed." Message node, which then loops back to the SAME buttons/list node (so a bad
reply just re-prompts).

Keep every "nodeResultId" / "yResultNodeId" / "nResultNodeId" value in sync with a matching
flowEdges entry — the two must never disagree.

## General authoring rules
- Every non-terminal node needs exactly one path forward (or, for Condition/Buttons/List,
  one path per branch/option plus a default/fallback).
- Terminal nodes: AssignTeam, AssignAgent, UpdateChatStatus. Nothing flows out of them.
- Reuse a downstream node as a merge point when multiple branches converge on the same next
  step (e.g. several menu options all asking "how can we help", or "Cash"/"Card" both leading
  to the same "delivery or collection?" prompt) — don't duplicate nodes unnecessarily.
- Use Condition nodes with KeywordContains("") to avoid re-asking for data already captured
  earlier in the conversation (check the flag/value variable first).
- Node ids only need to be unique within the file — generate short random alnum suffixes,
  don't reuse the examples above verbatim.
- Output strictly valid JSON. No comments, no trailing commas.
`.trim();
