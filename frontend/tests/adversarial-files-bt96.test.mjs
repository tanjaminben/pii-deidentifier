import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { parseFile } from '../src/redactorium/lib/parsers.js';
import { detectColumns } from '../src/redactorium/lib/detector.js';
import { planFor } from '../src/redactorium/lib/plan.js';
import { applyTransformations } from '../src/redactorium/lib/transformers.js';
import { buildOutput } from '../src/redactorium/lib/exporters.js';

test('BT-96: Word output removes timestamps and mail merge connections, and treats VML descriptions', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Ordinary content.</w:t></w:r></w:p><v:shape alt="Photo of ada@example.com"/><v:imagedata o:title="Owner grace@example.com"/></w:body></w:document>');
  zip.file('docProps/core.xml', '<cp:coreProperties><dcterms:created xsi:type="dcterms:W3CDTF">2025-01-01T01:02:03Z</dcterms:created><dcterms:modified>2025-02-01T01:02:03Z</dcterms:modified><cp:lastPrinted>2025-03-01T01:02:03Z</cp:lastPrinted></cp:coreProperties>');
  zip.file('word/settings.xml', '<w:settings><w:zoom w:percent="100"/><w:mailMerge><w:connectString w:val="private_database"/><w:query w:val="SELECT email FROM customers"/><w:dataSource r:id="rId1"/></w:mailMerge></w:settings>');
  zip.file('word/_rels/settings.xml.rels', '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/mailMergeSource" Target="file:///private-customers.csv" TargetMode="External"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/mailMergeHeaderSource" Target="file:///private-headers.csv" TargetMode="External"/></Relationships>');
  const parsed = await parseFile(new File([await zip.generateAsync({type:'uint8array'})], 'synthetic.docx'));
  const applied = await applyTransformations(parsed, planFor(detectColumns(parsed)));
  const output = await buildOutput({...parsed, rows:applied.rows}, applied.edits);
  const readback = await JSZip.loadAsync(await output.blob.arrayBuffer());
  const parts = await Promise.all(Object.values(readback.files).filter(f=>!f.dir).map(f=>f.async('string')));
  assert.doesNotMatch(parts.join('\n'), /private_|private-|SELECT|2025-0|ada@example|grace@example|mailMerge/);
  assert.match(await readback.file('word/settings.xml').async('string'), /<w:zoom w:percent="100"\/>/);
  assert.match(await readback.file('word/document.xml').async('string'), /alt="Photo of \[REDACTED\]"/);
  assert.match(await readback.file('word/document.xml').async('string'), /o:title="Owner \[REDACTED\]"/);
  for (const label of ['created timestamp','modified timestamp','lastPrinted timestamp','mail merge connection and query']) assert.ok(parsed.meta.cleaned.propertiesCleared.includes(label));
});

test('BT-96: encoded Word hyperlinks redact logical email spans and preserve unrelated URI escapes', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml','<w:document><w:body><w:p><w:r><w:t>Contact link</w:t></w:r></w:p></w:body></w:document>');
  zip.file('word/_rels/document.xml.rels','<Relationships><Relationship Id="rId1" TargetMode="External" Target="https://example.com/contact?name=jos%C3%A9%40example.org&amp;return=a%26b%2Fc"/><Relationship Id="rId2" TargetMode="External" Target="mailto:ada%40example.org"/></Relationships>');
  const fixture = new File([await zip.generateAsync({type:'uint8array'})],'links.docx');
  const parsed = await parseFile(fixture);
  const plan = planFor(detectColumns(parsed));
  assert.ok(plan.some(p=>p.detectorId==='email'));
  const applied = await applyTransformations(parsed, plan);
  const output = await buildOutput({...parsed,rows:applied.rows},applied.edits);
  const readback = await JSZip.loadAsync(await output.blob.arrayBuffer());
  const rels = await readback.file('word/_rels/document.xml.rels').async('string');
  assert.match(rels,/name=%5BREDACTED%5D&amp;return=a%26b%2Fc/);
  assert.match(rels,/mailto:redacted@example.invalid/);
  assert.doesNotMatch(rels,/jos%C3%A9|ada%40/);
  const keep = await parseFile(fixture);
  const kept = await applyTransformations(keep,plan.map(p=>({...p,transform:'keep'})));
  const keptOutput = await buildOutput({...keep,rows:kept.rows},kept.edits);
  const keptZip = await JSZip.loadAsync(await keptOutput.blob.arrayBuffer());
  assert.equal(await keptZip.file('word/_rels/document.xml.rels').async('string'),await zip.file('word/_rels/document.xml.rels').async('string'));
});

test('BT-96: fake values use a fresh seed by default, retain explicit repeatability and normalize formatting', async () => {
  const parsed = {kind:'csv',format:'csv',headers:['phone'],rows:[['+1 415 555 0134'],['+1 (415) 555-0134']]};
  const plan = [{key:'column:0',index:0,mode:'column',detectorId:'phone',transform:'synthetic'}];
  const a = await applyTransformations(parsed,plan,{seed:'same'});
  const b = await applyTransformations(parsed,plan,{seed:'same'});
  assert.deepEqual(a.rows,b.rows);
  assert.equal(a.rows[0][0],a.rows[1][0]);
  const many = {...parsed,rows:Array.from({length:12},(_,i)=>[`+1 415 555 ${String(i+100).padStart(4,'0')}`])};
  assert.notDeepEqual((await applyTransformations(many,plan)).rows,(await applyTransformations(many,plan)).rows);
  const postcode = await applyTransformations({...parsed,headers:['postcode'],rows:[['SW1A 1AA']]},[{...plan[0],detectorId:'postal_uk'}]);
  assert.equal(postcode.rows[0][0],'TEST_POSTCODE');
});

test('BT-96: replacing a whole Word hyperlink retains a valid reserved destination', async () => {
  for (const transform of ['redact','synthetic','hash']) {
    const zip = new JSZip();
    zip.file('word/document.xml','<w:document><w:body><w:p><w:r><w:t>Website</w:t></w:r></w:p></w:body></w:document>');
    zip.file('word/_rels/document.xml.rels','<Relationships><Relationship Id="rId1" TargetMode="External" Target="https://private.example.org/account/secret"/></Relationships>');
    const parsed = await parseFile(new File([await zip.generateAsync({type:'uint8array'})],'url.docx'));
    const plan = planFor(detectColumns(parsed)).map(p=>({...p,transform}));
    assert.ok(plan.some(p=>p.detectorId==='url'));
    const applied = await applyTransformations(parsed,plan);
    const output = await buildOutput({...parsed,rows:applied.rows},applied.edits);
    const readback = await JSZip.loadAsync(await output.blob.arrayBuffer());
    const rels = await readback.file('word/_rels/document.xml.rels').async('string');
    const target = rels.match(/Target="([^"]*)"/)[1];
    assert.equal(new URL(target).protocol,'https:');
    assert.equal(new URL(target).hostname,transform==='synthetic'?'example.com':'example.invalid');
    assert.doesNotMatch(rels,/private\.example|account\/secret|https%3A/);
  }
});
