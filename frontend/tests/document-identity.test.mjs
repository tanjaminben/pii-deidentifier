import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { parseFile } from "../src/redactorium/lib/parsers.js";
import { detectColumns } from "../src/redactorium/lib/detector.js";
import { planFor } from "../src/redactorium/lib/plan.js";
import { applyTransformations, generalize } from "../src/redactorium/lib/transformers.js";
import { buildOutput, buildLogJSON } from "../src/redactorium/lib/exporters.js";
import { scanText } from "../src/redactorium/lib/textScan.js";

async function run(text, { extension = "txt", transform } = {}) {
  const file = new File([text], `fixture.${extension}`);
  const parsed = await parseFile(file);
  const detection = detectColumns(parsed);
  const plan = planFor(detection).map((p) => transform ? { ...p, transform } : p);
  const applied = await applyTransformations(parsed, plan);
  const output = await buildOutput({ ...parsed, rows: applied.rows }, applied.edits);
  return { file, parsed, detection, plan, applied, output };
}

test("a resume finds the headline name, exact repeats, contact details and US places", async () => {
  const resume = "Quinn Rivera\nProject Coordinator\nPortland, OR\nquinn@example.org | +1 415 555 0134\nExperience\nQuinn Rivera worked in Austin, Texas.\nGreater Austin Area\nExample Organization\n";
  const r = await run(resume);
  const kinds = new Map(r.detection.filter((d) => d.top).map((d) => [d.top.detectorId, d]));
  for (const id of ["person_name", "place_us", "email", "phone"]) assert.ok(kinds.has(id), id);
  assert.equal(kinds.get("person_name").top.matches, 2);
  assert.ok(kinds.get("person_name").top.confidence < 0.6);
  assert.equal(kinds.get("place_us").top.matches, 2);
  for (const value of ["Quinn Rivera", "Portland, OR", "Austin, Texas", "quinn@example.org", "+1 415 555 0134"]) {
    assert.ok(!r.output.text.includes(value), value);
  }
  assert.match(r.output.text, /Project Coordinator/);
  assert.match(r.output.text, /Greater Austin Area/);
  assert.match(r.output.text, /Example Organization/);
});

test("a labeled name finds its exact signature and earlier mentions, not longer names or case variants", async () => {
  const text = "Please contact Ada Lovelace today.\nDear Ada Lovelace,\nAda Lovelaces and ada lovelace are different matches.\nRegards,\nAda Lovelace\n";
  const r = await run(text);
  assert.equal(r.detection.find((d) => d.top?.detectorId === "person_name").top.matches, 3);
  assert.match(r.output.text, /Please contact \[REDACTED\] today/);
  assert.match(r.output.text, /Ada Lovelaces and ada lovelace/);
  assert.ok(r.output.text.endsWith("[REDACTED]\n"));
});

test("headline names support accented letters, initials and hyphenated surnames", async () => {
  for (const name of ["José Núñez", "Zoë O'Brien-Smith", "Ada M. Lovelace"]) {
    const r = await run(`${name}\nA paragraph about the work.\nSigned by ${name}.`);
    assert.equal(r.detection.find((d) => d.top?.detectorId === "person_name")?.top.matches, 2, name);
    assert.ok(!r.output.text.includes(name), name);
  }
});

test("a labeled prefix cannot beat a known full name containing an initial", async () => {
  const text = "Ada M. Lovelace\nName: Ada M. Lovelace\nPrepared by Ada M. Lovelace.";
  const r = await run(text);
  assert.equal(r.detection.find((d) => d.top?.detectorId === "person_name")?.top.matches, 3);
  assert.equal(r.output.text, "[REDACTED]\nName: [REDACTED]\nPrepared by [REDACTED].");
});

test("opening titles, places, organizations and timesheets are not headline names", async () => {
  for (const text of [
    "Weekly Timesheet\nProject Hours\nMonday Tuesday Wednesday\n8 8 8",
    "Greater Austin Area\nProject Coordinator\nExample Holdings Inc\nUniversity Department",
    "Quarterly Sales Report\nCustomer Support\nAnnual Review\nData Protection Officer",
    "Intro.\nOne.\nTwo.\nThree.\nFour.\nAda Lovelace",
  ]) {
    const r = await run(text);
    assert.ok(!r.detection.some((d) => d.top?.detectorId === "person_name"), text);
    assert.equal(r.output.text, text);
  }
});

test("headline and repeated-name context stays inside one document, never a spreadsheet or later run", async () => {
  const csv = await run("notes\nAda Lovelace\nNothing personal here.\nNothing else here.\nPlain prose here.", { extension: "csv" });
  assert.ok(!csv.detection.some((d) => d.top?.detectorId === "person_name"));
  await run("Ada Lovelace\nMore prose here.");
  const next = await run("Please ask Ada Lovelace about it.");
  assert.equal(next.output.text, "Please ask Ada Lovelace about it.");
});

test("US places match exact spans within prose, validate states and avoid a name row", async () => {
  const text = "A customer in Austin, TX called from St. Louis, Missouri. Then Santa Fe, New Mexico; Washington, DC; Winston-Salem, NC; Honolulu, Hawaii. Invalid: Austin, ZZ and Austin, Texasville.";
  const places = scanText(text).filter((s) => s.detectorId === "place_us");
  assert.deepEqual(places.map((s) => s.value), ["Austin, TX", "St. Louis, Missouri", "Santa Fe, New Mexico", "Washington, DC", "Winston-Salem, NC", "Honolulu, Hawaii"]);
  for (const s of places) assert.equal(text.slice(s.start, s.end), s.value);
  const r = await run("Portland, Texas\nA sentence follows.");
  assert.equal(r.detection.find((d) => d.top)?.top.detectorId, "place_us");
});

test("place treatments keep only the state, redact, code or replace with a stable fictional place", async () => {
  assert.equal(generalize("Austin, TX", "place_us"), "TX");
  assert.equal(generalize("Austin, Texas", "place_us"), "Texas");
  assert.equal(generalize("unrecognized location", "place_us"), "[REDACTED]");
  const text = "A customer in Austin, TX wrote again from Austin, TX. Another is in Boston, MA.";
  const generalized = await run(text, { transform: "generalize" });
  assert.equal(generalized.output.text, "A customer in TX wrote again from TX. Another is in MA.");
  const coded = await run(text, { transform: "hash" });
  const codes = coded.output.text.match(/[a-f0-9]{16}/g);
  assert.equal(codes.length, 3);
  assert.equal(codes[0], codes[1]);
  assert.notEqual(codes[0], codes[2]);
  const fake = await run(text, { transform: "synthetic" });
  assert.ok(!/Austin|Boston/.test(fake.output.text));
  const values = [...fake.applied.edits[0]].map((e) => e.text);
  assert.equal(values[0], values[1]);
  assert.notEqual(values[0], values[2]);
});

test("the record reports name and place decisions without matched personal values", async () => {
  const r = await run("Quinn Rivera\nPortland, OR\nquinn@example.org");
  const log = buildLogJSON({ inputFile: r.file, format: r.parsed.format, columnPlan: r.plan,
    stats: r.applied.stats, detectionResults: r.detection, meta: r.parsed.meta,
    inputHash: "a".repeat(64), outputHash: "b".repeat(64), hashKey: r.applied.hashKey });
  for (const id of ["person_name", "place_us"]) {
    assert.ok(log.parameters.detectors_run.includes(id));
    assert.equal(log.transformations.find((t) => t.detector === id)?.matches_changed, 1);
  }
  assert.ok(!/Quinn Rivera|Portland, OR|quinn@example.org/.test(JSON.stringify(log)));
});

test("Keep preserves the recognized name and places", async () => {
  const text = "Quinn Rivera\nPortland, OR\nPlease ask Quinn Rivera.";
  const r = await run(text, { transform: "keep" });
  assert.equal(r.output.text, text);
  assert.ok(r.applied.stats.every((s) => s.changed === 0));
});

test("place columns and headerless rows treat every location, including the first", async () => {
  const headered = await run('location\n"Austin, TX"\n"Boston, Massachusetts"', { extension: "csv" });
  assert.equal(headered.detection[0].top.detectorId, "place_us");
  assert.equal(headered.detection[0].mode, "column");
  const headerless = await run('"Austin, TX"\n"Boston, MA"', { extension: "csv" });
  assert.equal(headerless.parsed.meta.headerless, true);
  assert.equal(headerless.applied.stats[0].changed, 2);
  assert.ok(!/Austin|Boston/.test(headerless.output.text));
});

test("a long document of ordinary log entries gains no headline names", async () => {
  const line = "2026-09-29T10:00:00Z INFO ada@example.org from 203.0.113.7 opened ticket 88231\n";
  const start = performance.now();
  const r = await run(line.repeat(20000));
  assert.ok(!r.detection.some((d) => d.top?.detectorId === "person_name"));
  assert.equal(r.detection.find((d) => d.top?.detectorId === "email").top.matches, 20000);
  assert.ok(performance.now() - start < 5000, "document context remains bounded on a large log");
});

test("Word headline names repeat across body runs, header and footer without losing formatting", async () => {
  const zip = new JSZip();
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  zip.file("word/document.xml", `<w:document ${ns}><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Quinn </w:t></w:r><w:r><w:t>Rivera</w:t></w:r></w:p><w:p><w:r><w:t>Portland, OR</w:t></w:r></w:p><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>The body stays here.</w:t></w:r></w:p></w:body></w:document>`);
  zip.file("word/header1.xml", `<w:hdr ${ns}><w:p><w:r><w:t>Quinn Rivera</w:t></w:r></w:p></w:hdr>`);
  zip.file("word/footer1.xml", `<w:ftr ${ns}><w:p><w:r><w:t>Prepared by Quinn Rivera.</w:t></w:r></w:p></w:ftr>`);
  const file = new File([await zip.generateAsync({ type: "uint8array" })], "resume.docx");
  const parsed = await parseFile(file);
  const detection = detectColumns(parsed);
  assert.equal(detection.find((d) => d.top?.detectorId === "person_name")?.top.matches, 3);
  const applied = await applyTransformations(parsed, planFor(detection));
  const output = await buildOutput({ ...parsed, rows: applied.rows }, applied.edits);
  const cleaned = await JSZip.loadAsync(await output.blob.arrayBuffer());
  for (const path of ["word/document.xml", "word/header1.xml", "word/footer1.xml"]) {
    const xml = await cleaned.file(path).async("string");
    assert.ok(!/Quinn|Portland/.test(xml), path);
    assert.match(xml, /\[REDACTED\]/);
  }
  assert.match(await cleaned.file("word/document.xml").async("string"), /<w:i\/><\/w:rPr><w:t>The body stays here\.<\/w:t>/);
});
