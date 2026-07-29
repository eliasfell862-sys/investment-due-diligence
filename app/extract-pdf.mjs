import fs from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = process.argv.find(a => a.endsWith('.pdf')) || process.argv[2];
const data = new Uint8Array(fs.readFileSync(pdfPath));
const doc = await pdfjsLib.getDocument({data, isEvalSupported:false, useWorkerFetch:false, disableFontFace:true}).promise;
const pages = [];
for (let i=1; i<=Math.min(doc.numPages, 30); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(it => it.str).join(' ');
    pages.push(`=== PAGE ${i} ===\n${text}`);
}
console.log(pages.join('\n\n'));
