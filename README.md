# WATI Chatbot Flow Builder

Upload a chatbot flow diagram (PDF or image) and get back a ready-to-import
**WATI** chatbot flow JSON file. Optionally attach an existing WATI flow
export and the tool will update it to match the diagram instead of building
from scratch — carrying forward everything that already matches and calling
out anything it changed.

## How it works

1. The diagram is uploaded in the browser. PDF pages are rasterized to PNG
   images client-side (no server-side PDF tooling required).
2. The images (plus an optional existing flow JSON and free-text notes) are
   sent to `/api/generate`, which calls the Claude API with a system prompt
   grounded in WATI's actual flow-JSON schema (node types, edge format, etc. —
   see `src/lib/wati-schema.ts`).
3. The model returns the full flow JSON plus a plain-English summary
   (assumptions made, placeholders left for you to fill in — e.g. WATI team
   IDs, agent IDs, WhatsApp Flow IDs — and what changed if updating an
   existing flow).
4. Download the JSON and import it into WATI's Chatbot flow builder.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in ANTHROPIC_API_KEY
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploying on Vercel

1. Import this GitHub repository into a new Vercel project.
2. In the project's **Settings → Environment Variables**, add
   `ANTHROPIC_API_KEY` with your Anthropic API key.
3. Deploy. No other configuration is required.

Note: flow generation can take a while for large/complex diagrams. The API
route is configured for a 300s max duration (`src/app/api/generate/route.ts`),
which requires a Vercel Pro (or higher) plan — on the Hobby plan, function
duration is capped at 60s regardless of that setting.

## Project structure

- `src/app/page.tsx` — upload UI and result view.
- `src/app/api/generate/route.ts` — server route that calls the Claude API.
- `src/lib/wati-schema.ts` — reference documentation for WATI's flow JSON
  format, used to ground the model's output so it's actually importable.
- `src/lib/pdf-to-images.ts` — client-side PDF-to-PNG rasterization
  (`pdfjs-dist`).

## Limitations

- Real WATI Team IDs, Agent IDs, and WhatsApp Flow IDs can't be invented —
  the model leaves those fields blank and calls them out in its summary.
  Fill them in via WATI's UI, or paste them into the "notes" field before
  generating.
- Up to 4 diagram pages/images per request.
