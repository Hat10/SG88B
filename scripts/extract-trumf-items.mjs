// Dump text items (page, x, y, str) from a Trumf PDF to JSON, for parser tests.
// pdfjs-dist v5 requires Node 18+ — run with a newer node if `node -v` is older:
//   ~/.nvm/versions/node/v24.6.0/bin/node scripts/extract-trumf-items.mjs testdata/trumf-juli.pdf testdata/trumf-items.json
import { readFile, writeFile } from 'node:fs/promises';

const [, , pdfPath, outPath] = process.argv;
if (!pdfPath || !outPath) {
  console.error('Bruk: node scripts/extract-trumf-items.mjs <inn.pdf> <ut.json>');
  process.exit(1);
}

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const data = new Uint8Array(await readFile(pdfPath));
const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;

const items = [];
for (let page = 1; page <= doc.numPages; page++) {
  const content = await (await doc.getPage(page)).getTextContent();
  for (const item of content.items) {
    if (!item.str?.trim()) continue;
    items.push({ page, x: item.transform[4], y: item.transform[5], str: item.str });
  }
}

await writeFile(outPath, JSON.stringify(items, null, 1));
console.log(`Skrev ${items.length} tekstelementer fra ${doc.numPages} sider til ${outPath}`);
