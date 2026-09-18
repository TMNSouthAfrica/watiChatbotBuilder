"use client";

import { useCallback, useRef, useState } from "react";
import { rasterizePdf, isPdf, isImage, fileToDataUrl } from "@/lib/pdf-to-images";

interface PreparedImage {
  label: string;
  dataUrl: string;
}

function dataUrlToParts(dataUrl: string): { mediaType: string; data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]*)$/);
  if (!match) throw new Error("Unexpected image data format");
  return { mediaType: match[1], data: match[2] };
}

type Status = "idle" | "preparing" | "generating" | "done" | "error";

export default function Home() {
  const [flowName, setFlowName] = useState("");
  const [notes, setNotes] = useState("");
  const [diagramImages, setDiagramImages] = useState<PreparedImage[]>([]);
  const [existingJsonText, setExistingJsonText] = useState<string>("");
  const [existingJsonFileName, setExistingJsonFileName] = useState<string>("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>("");
  const [resultJson, setResultJson] = useState<string>("");
  const [resultSummary, setResultSummary] = useState<string>("");

  const diagramInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const handleDiagramFile = useCallback(async (file: File) => {
    setError("");
    setStatus("preparing");
    try {
      const images: PreparedImage[] = [];
      if (isPdf(file)) {
        const pages = await rasterizePdf(file, { targetWidth: 1600, maxPages: 4 });
        for (const p of pages) {
          images.push({ label: `${file.name} — page ${p.pageNumber}`, dataUrl: p.dataUrl });
        }
      } else if (isImage(file)) {
        const dataUrl = await fileToDataUrl(file);
        images.push({ label: file.name, dataUrl });
      } else {
        throw new Error("Please upload a PDF or an image file (PNG/JPG/WEBP).");
      }
      setDiagramImages(images);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read diagram file");
    } finally {
      setStatus("idle");
    }
  }, []);

  const handleJsonFile = useCallback(async (file: File) => {
    const text = await file.text();
    setExistingJsonText(text);
    setExistingJsonFileName(file.name);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file) void handleDiagramFile(file);
    },
    [handleDiagramFile],
  );

  const canSubmit = diagramImages.length > 0 && status !== "generating" && status !== "preparing";

  const handleSubmit = useCallback(async () => {
    setStatus("generating");
    setError("");
    setResultJson("");
    setResultSummary("");
    try {
      const images = diagramImages.map((img) => dataUrlToParts(img.dataUrl));
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flowName: flowName || undefined,
          images,
          existingJson: existingJsonText || undefined,
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      setResultJson(data.json);
      setResultSummary(data.summary || "");
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    }
  }, [diagramImages, flowName, existingJsonText, notes]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([resultJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(flowName || "wati-flow").replace(/[^a-z0-9-_]+/gi, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [resultJson, flowName]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">WATI Chatbot Flow Builder</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Upload a flow diagram (PDF or image) and get back a ready-to-import WATI chatbot flow
          JSON file. Optionally attach an existing flow export to update it instead of building
          from scratch.
        </p>
      </header>

      <section className="flex flex-col gap-4 rounded-lg border border-black/10 p-6 dark:border-white/15">
        <div>
          <label className="mb-1 block text-sm font-medium">Flow name</label>
          <input
            type="text"
            value={flowName}
            onChange={(e) => setFlowName(e.target.value)}
            placeholder="e.g. Main Chatbot Build"
            className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Diagram (PDF or image)</label>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => diagramInputRef.current?.click()}
            className="cursor-pointer rounded-md border border-dashed border-black/20 p-6 text-center text-sm text-black/60 hover:border-black/40 dark:border-white/25 dark:text-white/60 dark:hover:border-white/50"
          >
            {status === "preparing"
              ? "Reading file…"
              : diagramImages.length > 0
                ? `${diagramImages.length} page(s) ready — click to replace`
                : "Drop a PDF or image here, or click to browse"}
            <input
              ref={diagramInputRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleDiagramFile(file);
              }}
            />
          </div>
          {diagramImages.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3">
              {diagramImages.map((img, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={img.dataUrl}
                  alt={img.label}
                  title={img.label}
                  className="h-28 w-auto rounded border border-black/10 object-contain dark:border-white/15"
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            Existing WATI flow JSON <span className="font-normal text-black/50 dark:text-white/50">(optional — to update instead of building from scratch)</span>
          </label>
          <div
            onClick={() => jsonInputRef.current?.click()}
            className="cursor-pointer rounded-md border border-dashed border-black/20 p-4 text-center text-sm text-black/60 hover:border-black/40 dark:border-white/25 dark:text-white/60 dark:hover:border-white/50"
          >
            {existingJsonFileName || "Click to attach a .json export"}
            <input
              ref={jsonInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleJsonFile(file);
              }}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            Notes for the model <span className="font-normal text-black/50 dark:text-white/50">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Anything the diagram doesn't capture — e.g. real team/agent IDs, wording preferences, edge cases."
            className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
        >
          {status === "generating" ? "Generating flow… (this can take a minute)" : "Generate WATI flow JSON"}
        </button>

        {error && (
          <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </section>

      {status === "done" && (
        <section className="flex flex-col gap-4 rounded-lg border border-black/10 p-6 dark:border-white/15">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Result</h2>
            <button
              onClick={handleDownload}
              className="rounded-md border border-black/20 px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:border-white/25 dark:hover:bg-white/10"
            >
              Download JSON
            </button>
          </div>
          {resultSummary && (
            <div className="whitespace-pre-wrap rounded-md bg-black/5 p-4 text-sm dark:bg-white/5">
              {resultSummary}
            </div>
          )}
          <pre className="max-h-96 overflow-auto rounded-md bg-black/90 p-4 text-xs text-green-300">
            {resultJson}
          </pre>
        </section>
      )}
    </div>
  );
}
