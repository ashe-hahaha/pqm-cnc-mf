"use client";

/**
 * Browser-only PDF helpers. pdf.js must not be imported at module top-level —
 * Next SSR has no DOMMatrix and will 500 the whole /dashboard page.
 */

export type PdfPageRaster = {
  page: number;
  dataUrl: string;
  width: number;
  height: number;
};

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PDFDocumentProxy = Awaited<
  ReturnType<PdfjsModule["getDocument"]>["promise"]
>;

let pdfjsModule: PdfjsModule | null = null;
let workerReady = false;
const docCache = new Map<string, Promise<PDFDocumentProxy>>();

async function loadPdfjs(): Promise<PdfjsModule> {
  if (typeof window === "undefined") {
    throw new Error("PDF conversion runs in the browser only");
  }
  if (!pdfjsModule) {
    pdfjsModule = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  if (!workerReady) {
    pdfjsModule.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    workerReady = true;
  }
  return pdfjsModule;
}

export async function loadPdfDocument(url: string): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  let pending = docCache.get(url);
  if (!pending) {
    pending = pdfjs.getDocument({ url, withCredentials: false }).promise.catch(
      (err: unknown) => {
        docCache.delete(url);
        throw err;
      },
    );
    docCache.set(url, pending);
  }
  return pending;
}

/** Render one PDF page into a canvas; returns image data URL + intrinsic size. */
export async function renderPdfPageToDataUrl(
  doc: PDFDocumentProxy,
  pageNumber: number,
  maxWidth = 1400,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, maxWidth / base.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  // White paper behind drawings (many PDFs are transparent).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.85),
    width: canvas.width,
    height: canvas.height,
  };
}

/**
 * Break PDF into page images. Invokes onPage as each page finishes so tabs
 * can appear immediately.
 */
export async function pdfToPageImages(
  url: string,
  onProgress?: (done: number, total: number) => void,
  onPage?: (page: PdfPageRaster, done: number, total: number) => void,
): Promise<PdfPageRaster[]> {
  const doc = await loadPdfDocument(url);
  const total = doc.numPages;
  const pages: PdfPageRaster[] = [];
  for (let page = 1; page <= total; page++) {
    const raster = await renderPdfPageToDataUrl(doc, page);
    const item = { page, ...raster };
    pages.push(item);
    onPage?.(item, page, total);
    onProgress?.(page, total);
  }
  return pages;
}
