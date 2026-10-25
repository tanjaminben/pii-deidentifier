import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { parseFile } from '../src/redactorium/lib/parsers.js';
import { detectColumns } from '../src/redactorium/lib/detector.js';
import { planFor } from '../src/redactorium/lib/plan.js';
import { applyTransformations } from '../src/redactorium/lib/transformers.js';
import { buildOutput, buildLogJSON } from '../src/redactorium/lib/exporters.js';

const relationshipNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
const officeRelationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const documentXml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Ordinary content.</w:t></w:r></w:p></w:body></w:document>';

async function processDocx(parts, transform) {
  const zip = new JSZip();
  zip.file('word/document.xml', documentXml);
  for (const [name, text] of Object.entries(parts)) zip.file(name, text);
  const file = new File([await zip.generateAsync({ type: 'uint8array' })], 'synthetic.docx');
  const parsed = await parseFile(file);
  let plan = planFor(detectColumns(parsed));
  if (transform) plan = plan.map(p => ({ ...p, transform }));
  const applied = await applyTransformations(parsed, plan);
  const output = await buildOutput({ ...parsed, rows: applied.rows }, applied.edits);
  return { file, parsed, plan, applied, readback: await JSZip.loadAsync(await output.blob.arrayBuffer()) };
}

test('Word URL treatments keep an absolute destination when a matched URL excludes its closing parenthesis', async () => {
  const original = 'https://example.org/article/Example_(test)';
  const relationships = `<Relationships xmlns="${relationshipNamespace}"><Relationship Id="rId1" Type="${officeRelationship}hyperlink" TargetMode="External" Target="${original}"/></Relationships>`;
  for (const transform of [undefined, 'hash', 'synthetic', 'keep']) {
    const { plan, readback } = await processDocx({ 'word/_rels/document.xml.rels': relationships }, transform);
    assert.ok(plan.some(p => p.detectorId === 'url'));
    if (!transform) assert.equal(plan.find(p => p.detectorId === 'url').transform, 'redact');
    const rels = await readback.file('word/_rels/document.xml.rels').async('string');
    const target = rels.match(/Target="([^"]*)"/)[1];
    if (transform === 'keep') {
      assert.equal(rels, relationships);
    } else {
      const url = new URL(target);
      assert.equal(url.protocol, 'https:');
      assert.equal(url.hostname, transform === 'synthetic' ? 'example.com' : 'example.invalid');
      assert.doesNotMatch(target, /article\/Example_|https%3A/);
    }
  }
});

test('Word mail-merge cleanup removes either attribute quote form and retains unrelated settings relationships', async () => {
  const unrelated = `<Relationship Id="rId3" Type="${officeRelationship}theme" Target="theme/theme1.xml"/>`;
  for (const quote of ['"', "'"]) {
    const { file, parsed, plan, applied, readback } = await processDocx({
      'word/settings.xml': '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:mailMerge><w:connectString w:val="SYNTHETIC_CONNECTION"/><w:query w:val="SELECT demo FROM example"/></w:mailMerge></w:settings>',
      'word/_rels/settings.xml.rels': `<Relationships xmlns="${relationshipNamespace}"><Relationship Id="rId1" Type=${quote}${officeRelationship}mailMergeSource${quote} Target="file:///fixture-input.csv" TargetMode="External"/><Relationship Id="rId2" Type = ${quote}${officeRelationship}mailMergeHeaderSource${quote} Target="file:///fixture-header.csv" TargetMode="External"/>${unrelated}</Relationships>`,
    });
    const settings = await readback.file('word/settings.xml').async('string');
    const rels = await readback.file('word/_rels/settings.xml.rels').async('string');
    assert.doesNotMatch(settings + rels, /mailMerge|SYNTHETIC_CONNECTION|SELECT|fixture-input|fixture-header/);
    assert.match(settings, /<w:zoom w:percent="100"\/>/);
    assert.equal(rels, `<Relationships xmlns="${relationshipNamespace}">${unrelated}</Relationships>`);
    const log = buildLogJSON({ inputFile: file, format: parsed.format, columnPlan: plan,
      stats: applied.stats, detectionResults: [], meta: parsed.meta,
      inputHash: 'a'.repeat(64), outputHash: 'b'.repeat(64) });
    assert.ok(parsed.meta.cleaned.propertiesCleared.includes('mail merge connection and query'));
    assert.match(JSON.stringify(log), /mail merge connection and query/);
  }
});
