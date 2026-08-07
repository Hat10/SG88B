// Tynn pdfjs-wrapper rundt trumfText — kun denne fila rører pdfjs-dist,
// så all radlogikk kan testes i Node uten PDF-motor.
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ParseResult } from './types';
import { buildTrumfLines, parseTrumfLines, type TextItem } from './trumfText';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

export async function extractTrumfItems(buffer: ArrayBuffer): Promise<TextItem[]> {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const items: TextItem[] = [];
  for (let page = 1; page <= pdf.numPages; page++) {
    const content = await (await pdf.getPage(page)).getTextContent();
    for (const item of content.items as any[]) {
      if (!item.str?.trim()) continue;
      items.push({ page, x: item.transform[4], y: item.transform[5], str: item.str });
    }
  }
  return items;
}

export async function parseTrumfPdf(file: File): Promise<ParseResult> {
  const items = await extractTrumfItems(await file.arrayBuffer());
  return parseTrumfLines(buildTrumfLines(items));
}
