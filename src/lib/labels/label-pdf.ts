export type LabelLine = {
  cardName: string;
  setCode: string | null;
  collectorNumber: string | null;
  condition: string;
  printing: string;
  priceCents: number | null;
  sku: string;
};

const LABEL_WIDTH_IN = 1.5;
const LABEL_HEIGHT_IN = 0.5;

function roundPrice(cents: number | null, incrementCents: number | null): number | null {
  if (cents === null) return null;
  if (!incrementCents) return cents;
  return Math.round(cents / incrementCents) * incrementCents;
}

function dollars(cents: number | null): string {
  return cents === null ? "" : `$${(cents / 100).toFixed(2)}`;
}

/** Renders a Code128 barcode to a PNG data URL via an offscreen canvas --
 * jsbarcode draws directly onto a canvas, no server round-trip needed. */
async function barcodeDataUrl(value: string): Promise<string> {
  const JsBarcode = (await import("jsbarcode")).default;
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, value, { format: "CODE128", displayValue: false, height: 40, margin: 0 });
  return canvas.toDataURL("image/png");
}

/** Builds a labels PDF sized for 1.5"x0.5" stock -- one page per card in
 * "Labels" mode, or a name/price page followed by a barcode page per card
 * in "Labels + Barcodes" mode, matching SortSwift's label pair layout. */
export async function buildLabelsPdf(
  lines: LabelLine[],
  options: { withBarcodes: boolean; roundingIncrementCents: number | null },
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "in", format: [LABEL_WIDTH_IN, LABEL_HEIGHT_IN] });

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i > 0) doc.addPage([LABEL_WIDTH_IN, LABEL_HEIGHT_IN]);

    const priceCents = roundPrice(line.priceCents, options.roundingIncrementCents);
    const subtitle = [line.setCode, line.collectorNumber].filter(Boolean).join(" ");
    const conditionLine = `${subtitle ? subtitle + " " : ""}${line.condition} - ${line.printing === "foil" ? "Foil" : "Normal"}`;

    doc.setFontSize(7);
    doc.text(line.cardName, 0.05, 0.15, { maxWidth: LABEL_WIDTH_IN - 0.1 });
    doc.setFontSize(6);
    doc.text(conditionLine, 0.05, 0.28, { maxWidth: LABEL_WIDTH_IN - 0.1 });
    doc.setFontSize(8);
    doc.text(dollars(priceCents), LABEL_WIDTH_IN - 0.05, 0.28, { align: "right" });

    if (options.withBarcodes) {
      doc.addPage([LABEL_WIDTH_IN, LABEL_HEIGHT_IN]);
      const barcode = await barcodeDataUrl(line.sku);
      doc.addImage(barcode, "PNG", 0.1, 0.05, LABEL_WIDTH_IN - 0.2, 0.3);
      doc.setFontSize(6);
      doc.text(`${conditionLine} · ${new Date().toLocaleDateString()}`, LABEL_WIDTH_IN / 2, 0.45, { align: "center" });
    }
  }

  return doc.output("blob");
}
