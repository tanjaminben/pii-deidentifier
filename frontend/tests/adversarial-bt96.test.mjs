import { test } from 'node:test';
import assert from 'node:assert/strict';
import Papa from 'papaparse';
import { detectColumns } from '../src/redactorium/lib/detector.js';
import { scanText } from '../src/redactorium/lib/textScan.js';
import { applyTransformations } from '../src/redactorium/lib/transformers.js';
import { compileRule } from '../src/redactorium/lib/customRules.js';
import { buildOutput, buildLogJSON } from '../src/redactorium/lib/exporters.js';
import { planFor } from '../src/redactorium/lib/plan.js';

test('BT-96: incidental header substrings cannot hide embedded contacts', async () => {
  for (const header of ['Notes (Japan office)', 'Company comments', 'Machine notes', 'Adobe notes', 'user_guid', 'LinkedIn comments']) {
    const parsed = { kind:'csv', headers:[header], rows:[['Call ada@example.com or +1 415 555 0134']] };
    const findings = detectColumns(parsed);
    assert.deepEqual(findings.map(f=>f.top?.detectorId).sort(), ['email','phone'], header);
    const result = await applyTransformations(parsed, planFor(findings));
    assert.equal(result.rows[0][0], 'Call [REDACTED] or [REDACTED]', header);
  }
});

test('BT-96: keeping a genuine column classification still treats other embedded kinds after row 500', async () => {
  const parsed = {kind:'csv',headers:['email'], rows:Array.from({length:501},()=>['ada@example.com'])};
  parsed.rows[500] = ['Call +1 415 555 0134'];
  const findings = detectColumns(parsed);
  assert.ok(findings.some(f=>f.mode==='column' && f.top.detectorId==='email'));
  assert.ok(findings.some(f=>f.mode==='text' && f.top.detectorId==='phone'));
  const plan = planFor(findings).map(p=>p.mode==='column'?{...p,transform:'keep'}:p);
  const result = await applyTransformations(parsed,plan);
  assert.equal(result.rows[0][0],'ada@example.com');
  assert.equal(result.rows[500][0],'Call [REDACTED]');
});

test('BT-96: masking a whole column must not leave other embedded identifiers untouched', async () => {
  const parsed={kind:'csv',headers:['phone'],rows:[['+1 415 555 0134'],['+1 415 555 0134'],['Call +1 415 555 0134 or ada@example.com']]};
  const plan=planFor(detectColumns(parsed)).map(p=>p.mode==='column'?{...p,transform:'generalize'}:p);
  const result=await applyTransformations(parsed,plan);
  assert.ok(!result.rows[2][0].includes('ada@example.com'));
  assert.ok(result.rows[2][0].includes('[REDACTED]'));
  const names=detectColumns({kind:'csv',headers:['owner'],rows:[['王小明 <ada@example.com>']]});
  assert.ok(names.some(f=>f.mode==='column' && f.top.detectorId==='person_name'));
  assert.ok(names.some(f=>f.mode==='text' && f.top.detectorId==='email'));
});

test('BT-96: Unicode and invisible characters belong to the complete original email span', async () => {
  for(const value of ['josé@example.com','müller@exämple.de','ad\u200ba@example.com','аda@example.com']) {
    const text = `😀 Contact ${value} today.`;
    const spans = scanText(text);
    assert.deepEqual(spans.map(s=>s.value),[value]);
    assert.equal(text.slice(spans[0].start,spans[0].end),value);
    const parsed={kind:'text',headers:['text'],rows:[[text]]};
    const result=await applyTransformations(parsed,planFor(detectColumns(parsed)));
    assert.equal(result.rows[0][0],'😀 Contact [REDACTED] today.');
  }
});

test('BT-96: titles are preserved while complete labeled names are removed', async () => {
  for(const [before,after] of [
    ['Dear Dr. Smith,','Dear Dr. [REDACTED],'],
    ['Patient: Ludwig van Beethoven','Patient: [REDACTED]'],
    ['"name": "Ada Lovelace"','"name": "[REDACTED]"'],
    ['Name: José Núñez','Name: [REDACTED]'],
    ['Name: 王小明','Name: [REDACTED]']
  ]) {
    const parsed={kind:'text',headers:['text'],rows:[[before]]};
    const result=await applyTransformations(parsed,planFor(detectColumns(parsed)));
    assert.equal(result.rows[0][0],after);
  }
});

test('BT-96: labeled national phones are found without turning unlabelled IDs into phones', () => {
  for(const value of ['07700 900123','020 7946 0958','1-800-555-0134','4155550134','98765 43210']) {
    assert.deepEqual(scanText(`Phone ${value}`).map(s=>s.value),[value]);
  }
  assert.deepEqual(scanText('Order 4155550134'),[]);
});

test('BT-96: additional supported formats are found as complete spans without classifying unlabeled IDs', async () => {
  for (const [text, id, value] of [
    ['"name": "maria gonzalez"', 'person_name', 'maria gonzalez'],
    ['"name": "мария иванова"', 'person_name', 'мария иванова'],
    ['Passport: 123456789', 'passport', '123456789'],
    ['DOB 10-Dec-1985', 'dob', '10-Dec-1985'],
    ['DOB 10/12/85', 'dob', '10/12/85'],
    ['Card 4111.1111.1111.1111', 'credit_card', '4111.1111.1111.1111'],
    ['Send to SW1A 1AA today', 'postal_uk', 'SW1A 1AA'],
    ['Open https://example.org/account?id=sample.', 'url', 'https://example.org/account?id=sample']
  ]) assert.ok(scanText(text).some(s=>s.detectorId===id && s.value===value),text);
  assert.deepEqual(scanText('Order 123456789'),[]);
  const parsed={kind:'csv',format:'csv',headers:['passport'],rows:[['123456789']]};
  assert.ok(detectColumns(parsed).some(f=>f.top?.detectorId==='passport'));
});

test('BT-96: sensitive identifiers and custom matches default to redaction', () => {
  for(const [header,value] of [['ssn','123-45-6789'],['card','4111111111111111'],['iban','GB82WEST12345698765432']]) {
    const [finding]=detectColumns({kind:'csv',headers:[header],rows:[[value]]});
    assert.equal(finding.suggested,'redact');
  }
  const rule=compileRule({id:'staff',name:'Staff ID',pattern:'EMP-\\d{3}'});
  const [finding]=detectColumns({kind:'csv',headers:['internal'],rows:[['EMP-001'],['other']]},{customDetectors:[rule]});
  assert.equal(finding.suggested,'redact');
  assert.throws(()=>compileRule({id:'bad',name:'Bad hint',pattern:'EMP-\\d+',columnHint:'['}),/Invalid column hint/);
});

test('BT-96: CSV output neutralizes formula-shaped text and preserves ordinary negative numbers', async () => {
  const rows=[['=1+1'],['+1 415 555 0134'],['@SUM(1,1)'],['-SUM(1,1)'],['-12.5'],[-12.5],[' =1+1'],['\n=1+1'],['ordinary']];
  const output=await buildOutput({format:'csv',headers:['=1+1'],rows});
  const parsed=Papa.parse(await output.blob.text()).data;
  assert.deepEqual(parsed,[ ["'=1+1"],["'=1+1"],["'+1 415 555 0134"],["'@SUM(1,1)"],["'-SUM(1,1)"],['-12.5'],['-12.5'],["' =1+1"],["'\n=1+1"],['ordinary'] ]);
});

test('BT-96: exported records distinguish SSN format checks from actual checksums', async () => {
  for (const parsed of [
    {kind:'csv',format:'csv',headers:['ssn','card','iban'],rows:[['123-45-6789','4111111111111111','GB82WEST12345698765432']]},
    {kind:'text',format:'txt',headers:['text'],rows:[['SSN 123-45-6789; card 4111111111111111; IBAN GB82WEST12345698765432.']]}
  ]) {
    const findings=detectColumns(parsed), plan=planFor(findings);
    const applied=await applyTransformations(parsed,plan);
    const record=buildLogJSON({inputFile:{name:'synthetic.'+parsed.format,size:100},format:parsed.format,
      columnPlan:plan,stats:applied.stats,detectionResults:findings,inputHash:'input',outputHash:'output'});
    const serialized=JSON.stringify(record);
    const restored=JSON.parse(serialized);
    for (const [id,tier] of [['ssn','format'],['credit_card','checksum'],['iban','checksum']]) {
      const finding=restored.detection.find(f=>f.top_finding?.detector===id);
      assert.ok(finding,`${parsed.kind} record includes ${id}`);
      assert.equal(finding.top_finding.tier,tier);
      assert.equal(finding.all_findings.find(f=>f.detector===id).tier,tier);
    }
    for (const value of ['123-45-6789','4111111111111111','GB82WEST12345698765432']) {
      assert.ok(!JSON.stringify(applied.rows).includes(value),'sensitive values are still redacted');
      assert.ok(!serialized.includes(value),'matched values are not copied into the record');
    }
  }
});

test('BT-96: custom-rule limits reject incomplete scans instead of returning partial redactions', async () => {
  const rule=compileRule({id:'staff',name:'Staff ID',pattern:'EMP-\\d{3}'});
  const parsed=n=>({kind:'text',format:'txt',headers:['text'],rows:[['EMP-001 '.repeat(n)]]});
  const atLimit=parsed(10000);
  const findings=detectColumns(atLimit,{customDetectors:[rule]});
  const plan=planFor(findings);
  assert.equal(findings.find(f=>f.top?.detectorId===rule.id).top.matches,10000);
  const applied=await applyTransformations(atLimit,plan,{extra:[rule]});
  assert.equal(applied.rows[0][0],'[REDACTED] '.repeat(10000));
  const overLimit=parsed(10001);
  const expected={message:'Max limit of 10,000 matches reached.'};
  assert.throws(()=>detectColumns(overLimit,{customDetectors:[rule]}),expected);
  await assert.rejects(applyTransformations(overLimit,plan,{extra:[rule]}),expected);
  assert.equal(overLimit.rows[0][0],'EMP-001 '.repeat(10001),'input is unchanged on failure');
  assert.equal(scanText('EMP-002',{extra:[rule]}).length,1,'the next file can still be scanned');
});
