"use client";

// Rasterizes each page of a PDF into a PNG data URL, entirely in the browser.
// Runs client-side (not in the Vercel serverless function) so the API route
// never needs native PDF-rendering binaries.

const PDFJS_VERSION = "6.3.289";

let workerConfigured = false;

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
    workerConfigured = true;
  }
  return pdfjs;
}

export interface RasterizedPage {
  pageNumber: number;
  dataUrl: string;
}

/** Renders every page of a PDF file to a PNG data URL at the given target width. */
export async function rasterizePdf(
  file: File,
  { targetWidth = 1600, maxPages = 20 }: { targetWidth?: number; maxPages?: number } = {},
): Promise<RasterizedPage[]> {
  const pdfjs = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;

  const pages: RasterizedPage[] = [];
  const pageCount = Math.min(doc.numPages, maxPages);

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = targetWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");

    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    pages.push({ pageNumber, dataUrl: canvas.toDataURL("image/png") });
  }

  return pages;
}

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
