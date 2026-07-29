import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const data = new Uint8Array(fs.readFileSync(process.argv[1]));
const doc = await pdfjsLib.getDocument({data, isEvalSupported:false, useWorkerFetch:false, disableFontFace:true}).promise;
const pages = [];
for (let i=1; i<=Math.min(doc.numPages, 25); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(it => it.str).join(' ');
    pages.push(`=== PAGE ${i} ===\n${text}`);
}
console.log(pages.join('\n\n'));
