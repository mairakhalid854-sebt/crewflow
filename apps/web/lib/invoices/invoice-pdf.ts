import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';

export interface InvoicePdfItem {
  readonly description: string;
  readonly lineTotalCents: number;
  readonly quantity: number;
  readonly taxable: boolean;
  readonly unitPriceCents: number;
}

export interface InvoicePdfData {
  readonly companyName: string;
  readonly customerName: string;
  readonly discountCents: number;
  readonly dueAt: string;
  readonly invoiceNumber: number;
  readonly items: readonly InvoicePdfItem[];
  readonly jobTitle: string;
  readonly outstandingCents: number;
  readonly paidCents: number;
  readonly status: 'draft' | 'sent' | 'partially_paid' | 'paid' | 'void';
  readonly subtotalCents: number;
  readonly taxCents: number;
  readonly timeZone: string;
  readonly totalCents: number;
  readonly voidReason: string | null;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const FOOTER_HEIGHT = 42;
const NAVY = rgb(17 / 255, 34 / 255, 60 / 255);
const BLUE = rgb(23 / 255, 105 / 255, 244 / 255);
const SLATE = rgb(71 / 255, 85 / 255, 105 / 255);
const LIGHT = rgb(248 / 255, 250 / 255, 252 / 255);
const BORDER = rgb(226 / 255, 232 / 255, 240 / 255);
const GREEN = rgb(6 / 255, 118 / 255, 71 / 255);
const RED = rgb(180 / 255, 35 / 255, 24 / 255);

function pdfText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7e]/g, '?');
}

function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}$${Math.floor(absolute / 100).toLocaleString('en-US')}.${String(
    absolute % 100,
  ).padStart(2, '0')}`;
}

function invoiceLabel(value: number): string {
  return `INV-${String(value).padStart(6, '0')}`;
}

function dateLabel(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone,
  }).format(new Date(value));
}

function splitLongWord(
  word: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const character of word) {
    const candidate = `${piece}${character}`;
    if (piece && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      pieces.push(piece);
      piece = character;
    } else {
      piece = candidate;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

function wrapText(
  value: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of pdfText(value).split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const rawWord of words) {
      const fragments =
        font.widthOfTextAtSize(rawWord, size) > maxWidth
          ? splitLongWord(rawWord, font, size, maxWidth)
          : [rawWord];
      for (const word of fragments) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawRight(
  page: PDFPage,
  value: string,
  right: number,
  y: number,
  font: PDFFont,
  size: number,
  color = NAVY,
) {
  page.drawText(value, {
    color,
    font,
    size,
    x: right - font.widthOfTextAtSize(value, size),
    y,
  });
}

export function invoicePdfFileName(data: InvoicePdfData): string {
  const prefix = data.status === 'paid' ? 'receipt' : 'invoice';
  return `${prefix}-${invoiceLabel(data.invoiceNumber)}.pdf`;
}

export async function createInvoicePdf(
  data: InvoicePdfData,
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(
    `${data.status === 'paid' ? 'Receipt' : 'Invoice'} ${invoiceLabel(data.invoiceNumber)}`,
  );
  document.setAuthor('CrewFlow');
  document.setCreator('CrewFlow');
  document.setSubject(pdfText(data.jobTitle));

  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const pages: PDFPage[] = [page];
  let y = PAGE_HEIGHT - 94;

  const drawPageHeader = () => {
    page.drawRectangle({
      color: NAVY,
      height: 62,
      width: PAGE_WIDTH,
      x: 0,
      y: PAGE_HEIGHT - 62,
    });
    page.drawCircle({ color: BLUE, size: 15, x: MARGIN + 15, y: 761 });
    page.drawText('C', {
      color: rgb(1, 1, 1),
      font: bold,
      size: 14,
      x: MARGIN + 10,
      y: 756,
    });
    page.drawText('CrewFlow', {
      color: rgb(1, 1, 1),
      font: bold,
      size: 15,
      x: MARGIN + 38,
      y: 756,
    });
    drawRight(
      page,
      pages.length === 1
        ? data.status === 'paid'
          ? 'PAID RECEIPT'
          : data.status === 'draft'
            ? 'DRAFT INVOICE'
            : 'INVOICE'
        : 'INVOICE CONTINUED',
      PAGE_WIDTH - MARGIN,
      756,
      bold,
      13,
      rgb(1, 1, 1),
    );
    y = PAGE_HEIGHT - 94;
  };

  const addPage = () => {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    drawPageHeader();
  };

  const ensureSpace = (height: number, repeatItemHeader = false) => {
    if (y - height >= FOOTER_HEIGHT + 16) return;
    addPage();
    if (repeatItemHeader) drawItemHeader();
  };

  const drawItemHeader = () => {
    page.drawRectangle({
      color: NAVY,
      height: 24,
      width: PAGE_WIDTH - 2 * MARGIN,
      x: MARGIN,
      y: y - 18,
    });
    page.drawText('DESCRIPTION', {
      color: rgb(1, 1, 1),
      font: bold,
      size: 8,
      x: MARGIN + 8,
      y: y - 11,
    });
    drawRight(page, 'QTY', 390, y - 11, bold, 8, rgb(1, 1, 1));
    drawRight(page, 'UNIT', 472, y - 11, bold, 8, rgb(1, 1, 1));
    drawRight(
      page,
      'AMOUNT',
      PAGE_WIDTH - MARGIN - 8,
      y - 11,
      bold,
      8,
      rgb(1, 1, 1),
    );
    y -= 30;
  };

  drawPageHeader();

  page.drawText(pdfText(data.companyName), {
    color: NAVY,
    font: bold,
    size: 22,
    x: MARGIN,
    y,
  });
  drawRight(
    page,
    invoiceLabel(data.invoiceNumber),
    PAGE_WIDTH - MARGIN,
    y + 4,
    bold,
    14,
  );
  y -= 31;
  page.drawText(`For: ${pdfText(data.customerName)}`, {
    color: SLATE,
    font: regular,
    size: 10,
    x: MARGIN,
    y,
  });
  drawRight(
    page,
    `Due: ${dateLabel(data.dueAt, data.timeZone)}`,
    PAGE_WIDTH - MARGIN,
    y,
    regular,
    10,
    SLATE,
  );
  y -= 20;
  const jobLines = wrapText(data.jobTitle, bold, 11, PAGE_WIDTH - 2 * MARGIN);
  for (const line of jobLines) {
    page.drawText(line, { color: NAVY, font: bold, size: 11, x: MARGIN, y });
    y -= 15;
  }
  y -= 13;

  if (data.status === 'paid' || data.status === 'void') {
    const statusText = data.status === 'paid' ? 'PAID IN FULL' : 'VOID';
    const statusColor = data.status === 'paid' ? GREEN : RED;
    page.drawRectangle({
      borderColor: statusColor,
      borderWidth: 1,
      color:
        data.status === 'paid'
          ? rgb(240 / 255, 253 / 255, 244 / 255)
          : rgb(1, 242 / 255, 242 / 255),
      height: 30,
      width: PAGE_WIDTH - 2 * MARGIN,
      x: MARGIN,
      y: y - 21,
    });
    page.drawText(statusText, {
      color: statusColor,
      font: bold,
      size: 10,
      x: MARGIN + 10,
      y: y - 11,
    });
    y -= 43;
  }

  drawItemHeader();
  for (const item of data.items) {
    const description = `${item.description}${item.taxable ? '' : ' (non-taxable)'}`;
    const lines = wrapText(description, regular, 9, 275);
    const rowHeight = Math.max(30, lines.length * 12 + 14);
    ensureSpace(rowHeight, true);
    page.drawRectangle({
      borderColor: BORDER,
      borderWidth: 0.5,
      color: LIGHT,
      height: rowHeight,
      width: PAGE_WIDTH - 2 * MARGIN,
      x: MARGIN,
      y: y - rowHeight + 6,
    });
    let textY = y - 8;
    for (const line of lines) {
      page.drawText(line, {
        color: NAVY,
        font: regular,
        size: 9,
        x: MARGIN + 8,
        y: textY,
      });
      textY -= 12;
    }
    drawRight(page, String(item.quantity), 390, y - 8, regular, 9);
    drawRight(page, money(item.unitPriceCents), 472, y - 8, regular, 9);
    drawRight(
      page,
      money(item.lineTotalCents),
      PAGE_WIDTH - MARGIN - 8,
      y - 8,
      bold,
      9,
    );
    y -= rowHeight;
  }

  ensureSpace(170);
  y -= 10;
  const totalsX = 340;
  const totalsRight = PAGE_WIDTH - MARGIN;
  const drawTotal = (label: string, value: string, emphasized = false) => {
    page.drawText(label, {
      color: emphasized ? NAVY : SLATE,
      font: emphasized ? bold : regular,
      size: emphasized ? 11 : 9,
      x: totalsX,
      y,
    });
    drawRight(
      page,
      value,
      totalsRight,
      y,
      emphasized ? bold : regular,
      emphasized ? 11 : 9,
      emphasized ? NAVY : SLATE,
    );
    y -= emphasized ? 22 : 17;
  };
  drawTotal('Subtotal', money(data.subtotalCents));
  if (data.discountCents)
    drawTotal('Discount', `-${money(data.discountCents)}`);
  drawTotal('Tax', money(data.taxCents));
  page.drawLine({
    color: BORDER,
    end: { x: totalsRight, y: y + 7 },
    start: { x: totalsX, y: y + 7 },
    thickness: 1,
  });
  drawTotal('Total', money(data.totalCents), true);
  drawTotal('Recorded paid', money(data.paidCents));
  drawTotal('Outstanding', money(data.outstandingCents), true);

  if (data.status === 'void' && data.voidReason) {
    const reasonLines = wrapText(
      `Void reason: ${data.voidReason}`,
      regular,
      9,
      290,
    );
    ensureSpace(reasonLines.length * 12 + 24);
    y -= 4;
    for (const line of reasonLines) {
      page.drawText(line, { color: RED, font: regular, size: 9, x: MARGIN, y });
      y -= 12;
    }
  }

  for (const [index, currentPage] of pages.entries()) {
    currentPage.drawLine({
      color: BORDER,
      end: { x: PAGE_WIDTH - MARGIN, y: FOOTER_HEIGHT },
      start: { x: MARGIN, y: FOOTER_HEIGHT },
      thickness: 0.75,
    });
    currentPage.drawText(
      'Generated by CrewFlow. Payment status is recorded by the service business.',
      {
        color: SLATE,
        font: regular,
        size: 7,
        x: MARGIN,
        y: 27,
      },
    );
    drawRight(
      currentPage,
      `Page ${index + 1} of ${pages.length}`,
      PAGE_WIDTH - MARGIN,
      27,
      regular,
      7,
      SLATE,
    );
  }

  return document.save();
}
