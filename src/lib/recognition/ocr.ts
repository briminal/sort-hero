import { createWorker } from "tesseract.js";

/** Extracts text from an image (data URL, Blob, or File) via Tesseract. */
export async function extractText(image: string | Blob): Promise<string> {
  const worker = await createWorker("eng");
  try {
    const {
      data: { text },
    } = await worker.recognize(image);
    return text;
  } finally {
    await worker.terminate();
  }
}

/** Card names are printed as the top line of text on a physical card --
 * take the first non-trivial OCR line as the search query. */
export function pickLikelyCardName(ocrText: string): string {
  const line = ocrText
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length >= 2);

  return line ?? ocrText.trim();
}
