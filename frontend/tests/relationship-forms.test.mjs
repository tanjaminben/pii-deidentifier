import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { parseFile } from '../src/redactorium/lib/parsers.js';
import { detectColumns } from '../src/redactorium/lib/detector.js';
import { planFor } from '../src/redactorium/lib/plan.js';
import { applyTransformations } from '../src/redactorium/lib/transformers.js';
import { buildOutput } from '../src/redactorium/lib/exporters.js';

const ns = 'http://schemas.openxmlformats.org/package/2006/relationships';
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const document = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Ordinary content.</w:t></w:r></w:p></w:body></w:document>';
const root = inner => `<Relationships xmlns="${ns}" xmlns:r="${ns}">${inner}</Relationships>`;
function relationship(prefix, paired, attrs) {
  const name = prefix + 'Relationship';
  return `<${name} ${attrs}${paired ? `>\n<!-- empty relationship -->\n</${name}>` : '/>'}`;
}
async function fixture(parts) {
  const zip = new JSZip();
  zip.file('word/document.xml', document);
  for (const [part, text] of Object.entries(parts)) zip.file(part, text);
  return new File([await zip.generateAsync({ type: 'uint8array' })], 'synthetic.docx');
}
async function treated(file, adjust) {
  const parsed = await parseFile(file);
  const detection = detectColumns(parsed);
  const plan = planFor(detection).map(p => adjust ? adjust(p) : p);
  const applied = await applyTransformations(parsed, plan);
  const output = await buildOutput({ ...parsed, rows: applied.rows }, applied.edits);
  return { parsed, readback: await JSZip.loadAsync(await output.blob.arrayBuffer()) };
}

test('Word hyperlink quote, paired and prefix forms detect the same emails and retain unrelated URI escapes', async () => {
  for (const quote of ['"', "'"]) for (const paired of [false, true]) for (const prefix of ['', 'r:']) {
    const rels = root(relationship(prefix, paired, `Id=${quote}one${quote} TargetMode = ${quote}External${quote} Target=${quote}mailto:ada%40example.org${quote}`)
      + relationship(prefix, paired, `Id=${quote}two${quote} Target = ${quote}https://example.org/?email=jos%C3%A9%40example.org&amp;return=a%26b%2Fc${quote}` + ` TargetMode=${quote}External${quote}`));
    const file = await fixture({ 'word/_rels/document.xml.rels': rels });
    const { readback } = await treated(file, p => p.detectorId === 'url' ? { ...p, transform: 'keep' } : p);
    const output = await readback.file('word/_rels/document.xml.rels').async('string');
    assert.doesNotMatch(output, /ada%40|jos%C3%A9/);
    assert.match(output, /mailto:redacted@example.invalid/);
    assert.match(output, /email=%5BREDACTED%5D&amp;return=a%26b%2Fc/);
    assert.ok(output.includes(`Id=${quote}one${quote} TargetMode = ${quote}External${quote}`));
    const kept = await treated(file, p => ({ ...p, transform: 'keep' }));
    assert.equal(await kept.readback.file('word/_rels/document.xml.rels').async('string'), rels);
  }
});

test('Word mail-merge relationship forms are removed and the remaining XML and cleanup record agree', async () => {
  for (const quote of ['"', "'"]) for (const paired of [false, true]) for (const prefix of ['', 'r:']) {
    const unrelated = relationship(prefix, paired, `Id=${quote}other${quote} Type=${quote}${office}theme${quote} Target=${quote}theme/theme1.xml${quote}`);
    const rels = root(relationship(prefix, paired, `Id=${quote}source${quote} Type = ${quote}${office}mailMergeSource${quote} Target=${quote}file:///synthetic-input.csv${quote}`)
      + relationship(prefix, paired, `Id=${quote}header${quote} Target=${quote}file:///synthetic-header.csv${quote} Type=${quote}${office}mailMergeHeaderSource${quote}`) + unrelated);
    const { parsed, readback } = await treated(await fixture({
      'word/settings.xml': '<w:settings><w:zoom w:percent="100"/><w:mailMerge><w:query w:val="SYNTHETIC_QUERY"/></w:mailMerge></w:settings>',
      'word/_rels/settings.xml.rels': rels,
    }));
    assert.equal(await readback.file('word/_rels/settings.xml.rels').async('string'), root(unrelated));
    assert.doesNotMatch(await readback.file('word/settings.xml').async('string'), /mailMerge|SYNTHETIC_QUERY/);
    assert.ok(parsed.meta.cleaned.propertiesCleared.includes('mail merge connection and query'));
  }
});

test('Word relationship replacement escapes the original attribute quote delimiter', async () => {
  for (const quote of ['"', "'"]) {
    const rels = root(relationship('r:', true, `TargetMode=${quote}External${quote} Target=${quote}mailto:ada@example.org${quote}`));
    const parsed = await parseFile(await fixture({ 'word/_rels/document.xml.rels': rels }));
    const index = parsed.rows.findIndex(row => row[0] === 'mailto:ada@example.org');
    assert.ok(index >= 0);
    const rows = parsed.rows.map(row => [...row]);
    rows[index][0] = "mailto:o'hara@example.invalid";
    const edits = parsed.rows.map(() => []);
    edits[index] = [{ start: 7, end: 22, text: "o'hara@example.invalid" }];
    const output = await buildOutput({ ...parsed, rows }, edits);
    const zip = await JSZip.loadAsync(await output.blob.arrayBuffer());
    const xml = await zip.file('word/_rels/document.xml.rels').async('string');
    assert.ok(xml.includes(quote === "'" ? "mailto:o&apos;hara%40example.invalid" : "mailto:o'hara%40example.invalid"));
  }
});

test('Unsupported or malformed relationship markup stops parsing instead of returning a cleanup claim', async () => {
  for (const markup of [
    `<Relationship Type="${office}mailMergeSource" Target="file:///synthetic-input.csv">`,
    `<Relationship Type="${office}mailMergeSource" Target="file:///synthetic-input.csv">unexpected text</Relationship>`,
    `<Relationship Type=${office}mailMergeSource Target="file:///synthetic-input.csv"/>`,
    '<Relationship Target="file:///synthetic-input.csv"/>',
    `<r:Relationship Type="${office}mailMergeSource" Target="file:///synthetic-input.csv"></Relationship>`,
  ]) {
    const file = await fixture({ 'word/settings.xml': '<w:settings><w:mailMerge/></w:settings>', 'word/_rels/settings.xml.rels': root(markup) });
    await assert.rejects(parseFile(file), /could not be opened as a Word document/);
  }
});
