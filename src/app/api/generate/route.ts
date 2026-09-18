import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { WATI_SCHEMA_GUIDE } from "@/lib/wati-schema";

export const runtime = "nodejs";
// Generation can take a while for large flows — needs a Pro/Enterprise Vercel
// plan for the full 300s; Hobby is capped at 60s regardless of this value.
export const maxDuration = 300;

const MODEL = "claude-opus-5";
const MAX_IMAGES = 4;

interface GenerateRequestBody {
  flowName?: string;
  images: { mediaType: string; data: string }[];
  existingJson?: string;
  notes?: string;
}

const SYSTEM_PROMPT = `You are an expert WATI (WhatsApp Business API platform) chatbot flow builder.
You will be given one or more images of a hand-drawn or Canva-style flow diagram for a WhatsApp
chatbot, and optionally an existing WATI flow JSON export to update rather than replace.

${WATI_SCHEMA_GUIDE}

## Your task

1. Read every screen/box/arrow/annotation in the image(s) carefully — including sticky notes,
   colored callouts, checkmarks, and handwritten corrections. These often mark specific requested
   changes (e.g. "add a button", "skip this step", "update this text") that must be reflected in
   the output, not just the boxes that look like the main flow.
2. If an existing flow JSON was provided, treat the diagram as the source of truth for what the
   flow SHOULD be, and the existing JSON as the current implementation. Preserve everything that
   already matches, and only change what the diagram actually requires — don't rewrite unrelated
   parts, node ids, or positions gratuitously.
3. If no existing JSON was provided, build the complete flow from scratch.
4. Never invent real-world identifiers you cannot know: WhatsApp Flow IDs, WATI team IDs, or WATI
   agent IDs. Leave those fields blank/empty (as the schema examples show) and call out in your
   summary exactly which ones need to be filled in and by what (e.g. "AssignTeam node X needs the
   real Team ID for the Dispensary Team").
5. Any diagram text that is illegible, cut off, or ambiguous: make the most reasonable choice and
   flag it explicitly in the summary rather than silently guessing.

## Output format — follow exactly

First, output the complete flow as a single fenced code block:

\`\`\`json
{ ... the full WATI flow JSON object ... }
\`\`\`

Then, after the code block, write a "## Summary" section in markdown covering:
- What the flow does, top to bottom (brief).
- Every placeholder left blank (team IDs, agent IDs, WhatsApp Flow IDs) and what it's for.
- Any assumptions you made about unclear/illegible parts of the diagram.
- If updating an existing flow: a short list of what changed and why, tied to specific
  diagram annotations.

The JSON code block must contain ONLY valid JSON — no comments, no trailing commas, no
placeholder ellipses. It must be the complete, importable flow.`;

function extractJsonBlock(text: string): { json: string; summary: string } {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const jsonText = fenceMatch[1].trim();
    const summary = text.slice(fenceMatch.index! + fenceMatch[0].length).trim();
    return { json: jsonText, summary };
  }
  // Fallback: assume the whole response is JSON with no fencing.
  return { json: text.trim(), summary: "" };
}

export async function POST(req: NextRequest) {
  let body: GenerateRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const { flowName, images, existingJson, notes } = body;

  if (!images || images.length === 0) {
    return NextResponse.json(
      { ok: false, error: "At least one diagram image is required" },
      { status: 400 },
    );
  }
  if (images.length > MAX_IMAGES) {
    return NextResponse.json(
      { ok: false, error: `At most ${MAX_IMAGES} images are supported per request` },
      { status: 400 },
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "ANTHROPIC_API_KEY is not configured on the server. Add it in the Vercel project's Environment Variables.",
      },
      { status: 500 },
    );
  }

  const client = new Anthropic({ apiKey });

  const userContent: Anthropic.MessageParam["content"] = [];

  userContent.push({
    type: "text",
    text: `Flow name: ${flowName?.trim() || "Untitled Flow"}\n\nDiagram page(s) follow.`,
  });
  for (const image of images) {
    userContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType as
          | "image/png"
          | "image/jpeg"
          | "image/webp"
          | "image/gif",
        data: image.data,
      },
    });
  }

  if (existingJson?.trim()) {
    userContent.push({
      type: "text",
      text: `Here is the existing WATI flow JSON to update:\n\n\`\`\`json\n${existingJson.trim()}\n\`\`\``,
    });
  }

  if (notes?.trim()) {
    userContent.push({
      type: "text",
      text: `Additional instructions from the user:\n${notes.trim()}`,
    });
  }

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    const response = await stream.finalMessage();

    if (response.stop_reason === "refusal") {
      return NextResponse.json(
        { ok: false, error: "The model declined to generate this flow.", stopDetails: response.stop_details },
        { status: 422 },
      );
    }

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock) {
      return NextResponse.json(
        { ok: false, error: "No text content returned by the model." },
        { status: 502 },
      );
    }

    const { json: jsonText, summary } = extractJsonBlock(textBlock.text);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          error: `Model output was not valid JSON: ${(err as Error).message}`,
          raw: textBlock.text,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      json: JSON.stringify(parsed, null, 2),
      summary,
      stopReason: response.stop_reason,
      usage: response.usage,
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json(
        { ok: false, error: `Claude API error (${err.status}): ${err.message}` },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown server error" },
      { status: 500 },
    );
  }
}
