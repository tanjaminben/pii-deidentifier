import test from 'node:test';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildOutput, buildLogJSON, PDF_TEXT_FALLBACK_NOTICE } from '../src/redactorium/lib/exporters.js';
import { parseFile } from '../src/redactorium/lib/parsers.js';
import { detectColumns } from '../src/redactorium/lib/detector.js';
import { planFor } from '../src/redactorium/lib/plan.js';
import { applyTransformations } from '../src/redactorium/lib/transformers.js';

const pdfInput = rows => ({format:'pdf', headers:['Text'], rows:rows.map(line=>[line]), meta:{joiner:'\n', pageStarts:[0]}});

async function readPdf(output) {
  const document = await getDocument({data:new Uint8Array(await output.blob.arrayBuffer()), isEvalSupported:false}).promise;
  try {
    const lines = [];
    for (let page=1;page<=document.numPages;page++) {
      const content=await (await document.getPage(page)).getTextContent();
      lines.push(content.items.filter(item=>item.str).map(item=>item.str).join(' '));
    }
    return lines;
  } finally { await document.destroy(); }
}

test('BT-96: PDF fallback preserves multilingual treated text as exact UTF-8', async () => {
  const text='José Muñoz; 王小明; Привет\nمرحبا — 🐸\nContact [REDACTED].';
  const output=await buildOutput(pdfInput(text.split('\n')));
  assert.equal(output.ext,'txt');
  assert.equal(output.mime,'text/plain');
  assert.equal(output.blob.type,'text/plain;charset=utf-8');
  assert.equal(await output.blob.text(),text);
  assert.deepEqual(new Uint8Array(await output.blob.arrayBuffer()),new TextEncoder().encode(text));
  assert.equal(output.warning,PDF_TEXT_FALLBACK_NOTICE);
  assert.match(output.warning,/Some characters \(for example, Chinese or Cyrillic\)/);
  assert.equal(output.fallbackReason,'pdf-font-unsupported-characters');
});

test('BT-96: supported accented Latin and WinAnsi punctuation retain readable PDF output', async () => {
  const lines=['José Muñoz; café, naïve, Æsop, Straße.', '“Hello” — €10 … Œuvre, Š, Ž, Ÿ, ™.'];
  const output=await buildOutput(pdfInput(lines));
  assert.equal(output.ext,'pdf');
  assert.equal(output.warning,undefined);
  assert.equal(output.fallbackReason,undefined);
  assert.deepEqual(await readPdf(output),[lines.join(' ')]);
});

test('BT-96: later-page unsupported characters trigger fallback without losing page text', async () => {
  const input=pdfInput(['First page.','', 'Second page: Привет']);
  input.meta.pageStarts=[0,2];
  const output=await buildOutput(input);
  assert.equal(output.ext,'txt');
  assert.equal(await output.blob.text(),'First page.\n\nSecond page: Привет');
});

test('BT-96: fallback checks treated output, not the original characters', async () => {
  const parsed=await parseFile(new File(['Contact 王小明@example.com today.'],'synthetic.txt'));
  const applied=await applyTransformations(parsed,planFor(detectColumns(parsed)));
  const output=await buildOutput({...parsed,format:'pdf',rows:applied.rows},applied.edits);
  assert.equal(output.ext,'pdf');
  assert.deepEqual(await readPdf(output),['Contact [REDACTED] today.']);
});

test('BT-96: unsupported combining characters are preserved rather than silently normalized', async () => {
  const text='Cafe\u0301';
  const output=await buildOutput(pdfInput([text]));
  assert.equal(output.ext,'txt');
  assert.equal(await output.blob.text(),text);
});

test('BT-96: JSON record distinguishes PDF input from text fallback without copying content', async () => {
  const output=await buildOutput(pdfInput(['王小明; Привет']));
  const log=buildLogJSON({inputFile:{name:'synthetic.pdf',size:123},format:'pdf',columnPlan:[],stats:[],detectionResults:[],
    inputHash:'input',outputHash:'output',outputFormat:output.ext,outputFallbackReason:output.fallbackReason});
  assert.equal(log.input.format,'pdf');
  assert.deepEqual(log.output,{sha256:'output',format:'txt',fallback_reason:'pdf-font-unsupported-characters'});
  assert.doesNotMatch(JSON.stringify(log),/王小明|Привет/);
});
