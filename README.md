# WATI Chatbot Flow Builder

Turn a Canva flow diagram (exported as PDF) into a WATI chatbot flow JSON
file, ready to import into WATI's Chatbot builder. No AI and no API key are
involved: the PDF's shapes, colours, text and lines are read directly and
converted with fixed rules, so the same PDF always gives the same result.

## From a Canva PDF

1. In Canva, download the diagram as **PDF** (standard, not flattened).
2. Click **Import Canva PDF**. Pages crossed out with a big red X are skipped;
   if several pages are left you're asked which to build.
3. The flow opens in the editor. Yellow notes on steps carry anything the
   diagram says that WATI can't hold (team members, "attach this document",
   sticky notes). The Checks panel lists what still needs a decision —
   e.g. button text over WhatsApp's limits.
4. Fix those, then **Download WATI JSON** and import it into WATI.

The converter expects the diagram style the team uses:

| In the diagram | Becomes |
| --- | --- |
| Teal or pink outlined box | Message |
| …with white pills inside | Buttons (up to 3) or List (4+) |
| …with a grey "Save Attribute" tag beside it | Saves the answer/choice to that variable (a box without pills becomes a Question) |
| Orange diamond with two labelled exits (`variable = value`) | Condition |
| Orange diamond with one exit | Ignored (just a branch label) |
| Green block with nothing leading in | Start of the flow |
| Green block at the end ("Hand over to …") | Assign Team (team members kept as a note) |
| Grey line with arrowhead | Connection |
| Red / purple / blue sticky, orange "Capture Tag" | Note on the nearest step |

Every menu also gets WATI's usual "Please select one of the options below"
reply for customers who type instead of tapping.

## Building or editing flows by hand

1. Add steps from the left-hand list: Message, Question, Buttons, List,
   Condition, Update Attribute, WhatsApp Flow, Assign Team / Agent, Set Topic,
   Set Chat Status. If a step is selected, the new one is placed after it and
   connected automatically.
2. Click a step to edit its text, buttons, options and variables. Drag from a
   dot on the right of a step to another step to connect them; each button or
   list option has its own dot, plus a "No match" dot for customers who type
   instead of tapping.
3. The Checks panel lists anything WATI or WhatsApp would reject (e.g. more
   than 3 buttons, button text over 20 characters, no start step) and steps
   that aren't connected.
4. Click **Download WATI JSON** and import the file into WATI.

To change an existing chatbot, export it from WATI and use **Open WATI JSON**.
Fields the editor doesn't show are kept, so opening a file and downloading it
again without changes gives back the same file.

Work is saved in the browser automatically (localStorage).

### Optional: generate from a diagram

`/from-diagram` can turn an uploaded PDF or image of a flow diagram into WATI
JSON using the Claude API. This is the only part that needs an
`ANTHROPIC_API_KEY`; the editor works without it.

## Local development

```bash
npm install
npm run dev
# Only for /from-diagram: cp .env.example .env.local and fill in ANTHROPIC_API_KEY
```

Open [http://localhost:3000](http://localhost:3000).

## Deploying on Vercel

1. Import this GitHub repository into a new Vercel project.
2. Deploy. No configuration is required for the editor.
3. Only if you use `/from-diagram`: in **Settings → Environment Variables**,
   add `ANTHROPIC_API_KEY` and redeploy.

Note: flow generation can take a while for large/complex diagrams. The API
route is configured for a 300s max duration (`src/app/api/generate/route.ts`),
which requires a Vercel Pro (or higher) plan — on the Hobby plan, function
duration is capped at 60s regardless of that setting.

## Project structure

- `src/app/page.tsx` — the flow editor (`src/components/flow-editor/`).
- `src/lib/wati/convert.ts` — editor graph ⇄ WATI JSON conversion and the
  Checks panel's validation.
- `src/lib/wati/nodes.ts` — per-step defaults, outputs and text helpers.
- `src/lib/wati/types.ts` — WATI flow types and WhatsApp limits.
- `src/lib/wati-schema.ts` — reference notes on WATI's flow JSON format.
- `src/lib/pdf-diagram/extract.ts` — reads shapes, text and images from a PDF
  page (pdf.js, in the browser).
- `src/lib/pdf-diagram/parse.ts` — the diagram rules above; colours live in
  `COLORS` at the top of the file.
- `src/lib/pdf-diagram/import.ts` — page selection and the automatic
  "please select" replies.
- `src/app/from-diagram/page.tsx`, `src/app/api/generate/route.ts` — the
  optional diagram-to-JSON generator (Claude API).

## Limitations

- Real WATI Team IDs, Agent IDs and WhatsApp Flow IDs come from your WATI
  account. Enter them in the step, or leave them blank and fill them in
  WATI after importing.
- The PDF converter relies on the diagram style above. A diagram drawn
  differently (other colours, lines that don't touch the boxes) will need more
  fixing in the editor, or a change to `COLORS`.
- The format was worked out from a real WATI export; WATI hasn't published
  it. If WATI rejects a file, keep a copy of it so the editor can be fixed.
