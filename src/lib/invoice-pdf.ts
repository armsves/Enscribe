import "server-only";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type InvoicePdfInput = {
  ens: string;
  payUrl: string;
  invoiceNumber: string;
  clientName: string;
  freelancerName: string;
  description: string;
  amountFormatted: string;
  originSymbol: string;
  originChain: string;
  depositAddress: string;
  createdAt: string;
};

export async function buildInvoicePdf(
  input: InvoicePdfInput,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.07, 0.09, 0.12);
  const muted = rgb(0.35, 0.4, 0.45);
  const accent = rgb(0.2, 0.55, 0.48);

  let y = 740;
  const left = 48;

  const draw = (
    text: string,
    opts: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      x?: number;
    } = {},
  ) => {
    page.drawText(text, {
      x: opts.x ?? left,
      y,
      size: opts.size ?? 11,
      font: opts.bold ? bold : font,
      color: opts.color ?? ink,
    });
  };

  draw("ENSCRIBE", { size: 22, bold: true, color: accent });
  y -= 18;
  draw("ENS-named invoice", { size: 10, color: muted });
  y -= 36;

  draw(input.invoiceNumber || "Invoice", { size: 18, bold: true });
  y -= 22;
  draw(`Date: ${input.createdAt.slice(0, 10)}`, { size: 10, color: muted });
  y -= 28;

  draw("From", { size: 9, color: muted, bold: true });
  y -= 14;
  draw(input.freelancerName || "Freelancer", { size: 12 });
  y -= 24;

  draw("Bill to", { size: 9, color: muted, bold: true });
  y -= 14;
  draw(input.clientName || "Client", { size: 12 });
  y -= 28;

  if (input.description) {
    draw("Description", { size: 9, color: muted, bold: true });
    y -= 14;
    const lines = wrapText(input.description, 78);
    for (const line of lines) {
      draw(line, { size: 11 });
      y -= 14;
    }
    y -= 14;
  }

  draw("Amount due", { size: 9, color: muted, bold: true });
  y -= 16;
  draw(`${input.amountFormatted} ${input.originSymbol}`, {
    size: 20,
    bold: true,
    color: accent,
  });
  y -= 16;
  draw(`Pay on ${input.originChain}`, { size: 10, color: muted });
  y -= 32;

  page.drawRectangle({
    x: left - 8,
    y: y - 78,
    width: 524,
    height: 96,
    color: rgb(0.93, 0.96, 0.95),
    borderColor: accent,
    borderWidth: 1,
  });

  const boxTop = y - 12;
  y = boxTop;
  draw("Pay via ENS (Sepolia)", { size: 10, bold: true, color: accent });
  y -= 16;
  draw(input.ens, { size: 11, bold: true });
  y -= 16;
  draw("Open this Enscribe pay link (resolves ENS for you):", {
    size: 9,
    color: muted,
  });
  y -= 14;
  const urlLines = wrapText(input.payUrl, 72);
  for (const line of urlLines) {
    draw(line, { size: 9 });
    y -= 12;
  }

  y = boxTop - 110;
  draw("Deposit address (auto-filled on pay page)", {
    size: 9,
    color: muted,
    bold: true,
  });
  y -= 14;
  const addrLines = wrapText(input.depositAddress, 70);
  for (const line of addrLines) {
    draw(line, { size: 9 });
    y -= 12;
  }

  y = 72;
  draw(
    "Client: connect MetaMask on the pay page — Enscribe resolves Sepolia ENS to the deposit address.",
    { size: 8, color: muted },
  );
  y -= 12;
  draw(
    "Freelancer Solana settlement stays private and is never written to ENS.",
    { size: 8, color: muted },
  );

  return doc.save();
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}
