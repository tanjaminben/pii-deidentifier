// Regression tests for the 2026-09-24 release review: each test is one finding, reproduced.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseFile } from "../src/redactorium/lib/parsers.js";
import { detectColumns } from "../src/redactorium/lib/detector.js";
import { applyTransformations, generalize } from "../src/redactorium/lib/transformers.js";
import { buildOutput, buildLogJSON, cleanBaseName } from "../src/redactorium/lib/exporters.js";
import { compileRule } from "../src/redactorium/lib/customRules.js";
import { DETECTORS, aadhaarValid } from "../src/redactorium/lib/piiPatterns.js";

const det = (id) => DETECTORS.find((d) => d.id === id);
const planFrom = (detection, transform) => detection.map((r) => ({
  key: r.key, mode: r.mode, index: r.index, header: r.header, detectorId: r.top?.detectorId || null, transform: transform || r.suggested,
}));
async function run(file, transform, options = {}) {
  const parsed = await parseFile(file);
  const detection = detectColumns(parsed, options);
  const plan = planFrom(detection, transform);
  const applied = await applyTransformations(parsed, plan, { seed: "t", extra: (options.customDetectors || []).filter((d) => d.find) });
  const output = await buildOutput({ ...parsed, headers: applied.headers, rows: applied.rows }, applied.edits);
  return { parsed, detection, plan, applied, output };
}

test("a file with no header row: the first row is data and gets treated", async () => {
  const csv = "Ada Lovelace,ada@example.com,123-45-6789\nGrace Hopper,grace@example.com,234-56-7890\n";
  const { parsed, output } = await run(new File([csv], "headerless.csv"), "redact");
  assert.equal(parsed.meta.headerless, true);
  assert.deepEqual(parsed.headers, ["column_1", "column_2", "column_3"]);
  const text = await output.blob.text();
  assert.ok(!/Ada|ada@|123-45/.test(text), text);
  assert.ok(!text.startsWith("column_1"), "no invented header row in the clean file");
});

test("a real header row stays the header", async () => {
  const { parsed } = await run(new File(["name,email\nAda,ada@example.com\n"], "h.csv"));
  assert.equal(parsed.meta.headerless, undefined);
  assert.deepEqual(parsed.headers, ["name", "email"]);
});

test("an unclosed quote is refused, not half-redacted", async () => {
  const csv = 'name,notes\nAda,"she said ""hi\nGrace,grace@example.com\n';
  await assert.rejects(parseFile(new File([csv], "bad.csv")), /quote mark that never closes/);
});

test("the byte-order mark, delimiter and line endings survive", async () => {
  const csv = "﻿name;city\r\nJosé Núñez;Kraków\r\n";
  const { output } = await run(new File([csv], "semi.csv"), "keep");
  const bytes = new Uint8Array(await output.blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = new TextDecoder().decode(bytes.slice(3));
  assert.equal(text, "name;city\r\nJosé Núñez;Kraków");
});

test("generalizing an IP column never passes a value through", () => {
  assert.equal(generalize("192.168.1.10", "ipv4"), "192.168.0.0/16");
  assert.equal(generalize("10.0.0.4:8080", "ipv4"), "10.0.0.0/16");
  assert.equal(generalize("2001:db8::1", "ipv4"), "2001:db8:0::/48");
  assert.equal(generalize("fe80::1ff:fe23:4567:890a", "ipv6"), "fe80:0:0::/48");
  assert.equal(generalize("2001:db8:85a3::8a2e:370:7334", "ipv6"), "2001:db8:85a3::/48");
  assert.equal(generalize("192.168.1.10", "ipv6"), "192.168.0.0/16");
  assert.equal(generalize("not an address", "ipv4"), "[REDACTED]");
});

test("an IPv6-only column is detected and generalized", async () => {
  const csv = "ip\n2001:db8::1\n2001:db8:85a3::8a2e:370:7334\nfe80::1ff:fe23:4567:890a\n";
  const { detection, output } = await run(new File([csv], "v6.csv"), "generalize");
  assert.equal(detection[0].top.detectorId, "ipv6");
  const text = await output.blob.text();
  assert.ok(!/::1\b|7334|890a/.test(text), text);
});

test("short card and IBAN values are masked whole", () => {
  assert.equal(generalize("4111111111111111", "credit_card"), "411111******1111");
  assert.equal(generalize("12345678", "credit_card"), "********");
  assert.equal(generalize("12345678", "iban"), "********");
});

test("dates of birth generalize to the year in every common shape", () => {
  assert.equal(generalize("1985-12-10", "dob"), "1985");
  assert.equal(generalize("12/10/1985", "dob"), "1985");
  assert.equal(generalize("December 10, 1985", "dob"), "1985");
  assert.equal(generalize("unknown", "dob"), "[REDACTED]");
});

test("fakes are consistent: the same person gets the same fake everywhere", async () => {
  const csv = "email\nada@corp.example\ngrace@corp.example\nada@corp.example\n";
  const { applied } = await run(new File([csv], "e.csv"), "synthetic");
  assert.equal(applied.rows[0][0], applied.rows[2][0]);
  assert.notEqual(applied.rows[0][0], applied.rows[1][0]);
  assert.match(applied.rows[0][0], /@example\.(com|org|net)$/);
});

test("fake ZIP codes sit below the lowest ZIP in use", async () => {
  const csv = "zip\n94107\n20500\n10001\n";
  const { applied } = await run(new File([csv], "z.csv"), "synthetic");
  for (const [z] of applied.rows) assert.ok(/^000\d\d$/.test(z) && +z < 501, z);
});

test("whole-cell detectors: bracketed phones, spaced SSNs, accented names, and dates are not phones", () => {
  assert.ok(det("phone").test("(415) 555-0134") > 0);
  assert.equal(det("phone").test("2024-01-15"), 0);
  assert.equal(det("phone").test("2024-01-15 10:30:00"), 0);
  assert.ok(det("ssn").test("123 45 6789") > 0);
  assert.ok(det("person_name").test("José Núñez") > 0);
  assert.ok(det("person_name").test("Zoë O'Brien-Smith") > 0);
  assert.ok(det("person_name").test("Lovelace, Ada") > 0);
  assert.ok(det("person_name").columnHint.test("customer_name"));
  assert.ok(!det("ipv4").columnHint.test("street_address"));
  assert.ok(det("ipv4").test("10.0.0.4:8080") > 0);
  assert.ok(det("dob").test("March 3, 1990") > 0);
});

test("a created-date column is not swapped for phone numbers", async () => {
  const csv = "created\n2024-01-15\n2024-02-01\n2023-12-31\n";
  const { detection } = await run(new File([csv], "d.csv"));
  assert.notEqual(detection[0].top?.detectorId, "phone");
});

test("custom rules with the g flag match every cell", async () => {
  const rule = compileRule({ id: "emp", name: "Employee ID", pattern: "^EMP-\\d{6}$", flags: "g" });
  const csv = "id\nEMP-000001\nEMP-000002\nEMP-000003\nEMP-000004\n";
  const { detection } = await run(new File([csv], "emp.csv"), undefined, { customDetectors: [rule] });
  assert.equal(detection[0].top.detectorId, "custom:emp");
  assert.equal(detection[0].top.hits, 4);
});

test("personal data in a file name is not copied into the clean file's name or the record", async () => {
  assert.equal(cleanBaseName("ada-lovelace-ssn-123-45-6789.csv"), "ada-lovelace-ssn-redacted");
  assert.equal(cleanBaseName("export for ada@corp.example.csv"), "export for redacted");
  assert.equal(cleanBaseName("customers.csv"), "customers");
  const file = new File(["email\nada@corp.example\n"], "ssn-123-45-6789.csv");
  const { parsed, detection, plan, applied } = await run(file);
  const log = buildLogJSON({ inputFile: file, format: "csv", columnPlan: plan, stats: applied.stats, detectionResults: detection, inputHash: "", outputHash: "", hashKey: applied.hashKey, seed: "t", startedAt: "", finishedAt: "", meta: parsed.meta });
  assert.equal(log.input.name, "ssn-redacted.csv");
  assert.ok(log.parameters.detectors_run.includes("email"));
});

test("a workbook: the first visible sheet, dates as dates, and the other sheets named in the record", async () => {
  const wb = XLSX.utils.book_new();
  const lookup = XLSX.utils.aoa_to_sheet([["code"], ["A"]]);
  // Excel stores a date as a day count with a date format: 31391 is 1985-12-10.
  const people = XLSX.utils.aoa_to_sheet([["name", "dob"], ["Ada Lovelace", 0]]);
  people.B2 = { t: "n", v: 31391, z: "m/d/yy" };
  const notes = XLSX.utils.aoa_to_sheet([["note"], ["x"]]);
  XLSX.utils.book_append_sheet(wb, lookup, "Lookup");
  XLSX.utils.book_append_sheet(wb, people, "People");
  XLSX.utils.book_append_sheet(wb, notes, "Notes");
  wb.Workbook = { Sheets: [{ Hidden: 1 }, { Hidden: 0 }, { Hidden: 0 }] };
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const file = new File([bytes], "book.xlsx");
  const { parsed, detection, plan, applied } = await run(file);
  assert.equal(parsed.meta.sheetName, "People");
  assert.equal(parsed.rows[0][1], "1985-12-10");
  assert.equal(detection.find((r) => r.header === "dob").top.detectorId, "dob");
  const log = buildLogJSON({ inputFile: file, format: "xlsx", columnPlan: plan, stats: applied.stats, detectionResults: detection, inputHash: "", outputHash: "", hashKey: applied.hashKey, seed: "t", startedAt: "", finishedAt: "", meta: parsed.meta });
  assert.deepEqual(log.sheets, { read: "People", left_out: ["Lookup", "Notes"] });
});

test("a five-digit number column is not a ZIP column unless it is named like one", async () => {
  const salary = await run(new File(["salary\n60000\n72000\n58000\n"], "pay.csv"));
  assert.equal(salary.detection[0].top, null);
  const zip = await run(new File(["zip\n94107\n10001\n"], "zip.csv"));
  assert.equal(zip.detection[0].top.detectorId, "postal_us");
});

test("fakes never give two different people the same value, in one file or across a batch", async () => {
  const people = Array.from({ length: 400 }, (_, i) => `person${i}@corp.example,(415) 555-${String(1000 + i).padStart(4, "0")}`);
  const csv = "email,phone\n" + people.join("\n") + "\n" + people[7] + "\n";
  const parsed = await parseFile(new File([csv], "many.csv"));
  const plan = planFrom(detectColumns(parsed), "synthetic");
  const fakes = new Map();
  const first = await applyTransformations(parsed, plan, { seed: "t", fakes });
  for (const col of [0, 1]) {
    const values = first.rows.slice(0, 400).map((r) => r[col]);
    assert.equal(new Set(values).size, 400, `column ${col} has a repeated fake`);
    assert.equal(first.rows[400][col], first.rows[7][col], "the same person keeps the same fake");
  }
  // A second file of the same batch: new people get new fakes, a returning person gets theirs.
  const more = await parseFile(new File([`email,phone\nnew@corp.example,(212) 555-0199\n${people[3]}\n`], "more.csv"));
  const second = await applyTransformations(more, planFrom(detectColumns(more), "synthetic"), { seed: "t", fakes });
  const earlier = new Set(first.rows.map((r) => r[0]));
  assert.ok(!earlier.has(second.rows[0][0]), "a new person got an earlier person's fake");
  assert.equal(second.rows[1][0], first.rows[3][0]);
});

test("a less exact phone number keeps the area code and hides the line", () => {
  assert.equal(generalize("(415) 555-0134", "phone"), "(415) ***-****");
  assert.equal(generalize("+1 212 555 0100", "phone"), "+1 212 *** ****");
  assert.equal(generalize("+44 7700 900123", "phone"), "+44 770* ******");
  assert.equal(generalize("555-0134", "phone"), "***-****");
});

test("an ID column is not a passport or license column unless it is named like one", async () => {
  const ids = await run(new File(["customer_id,order_ref\nC100000,ORD12345\nC100001,ORD12346\n"], "ids.csv"));
  for (const row of ids.detection) assert.ok(!["passport", "us_dl"].includes(row.top?.detectorId), `${row.header} read as ${row.top?.detectorId}`);
  const named = await run(new File(["passport_number,drivers_license\nC1000007,D1234567\nX9876543,B7654321\n"], "docs.csv"));
  assert.deepEqual(named.detection.map((r) => r.top?.detectorId), ["passport", "us_dl"]);
});

// 2026-09-28: a 15-digit card kept in an Excel file came back as 3.78282E+14.
async function workbook(aoa, formats = {}) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (const [addr, z] of Object.entries(formats)) ws[addr].z = z;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "People");
  return new File([XLSX.write(wb, { type: "array", bookType: "xlsx" })], "people.xlsx");
}
async function cellsOf(output) {
  const wb = XLSX.read(new Uint8Array(await output.blob.arrayBuffer()), { type: "array", cellNF: true });
  return wb.Sheets[wb.SheetNames[0]];
}

test("a long number kept in an Excel file comes back in full, not in scientific notation", async () => {
  const file = await workbook([["card_number", "account"], [378282246310005, 100000000001], ["4111111111111111", 100000000002]]);
  const { output } = await run(file, "keep");
  const ws = await cellsOf(output);
  assert.equal(XLSX.utils.format_cell(ws.A2), "378282246310005");
  assert.equal(XLSX.utils.format_cell(ws.B2), "100000000001");
  assert.equal(ws.A2.t, "n", "still a number");
});

test("an Excel number shown through a digit mask is read as the text a person sees", async () => {
  const file = await workbook(
    [["zip", "ssn", "phone", "amount"], [2139, 78051120, 4155550134, 1234.5]],
    { A2: "00000", B2: "000-00-0000", C2: "[<=9999999]###-####;(###) ###-####", D2: "#,##0.00" },
  );
  const { parsed, detection } = await run(file, "keep");
  assert.deepEqual(parsed.rows[0], ["02139", "078-05-1120", "(415) 555-0134", 1234.5]);
  assert.deepEqual(detection.map((r) => r.top?.detectorId || null), ["postal_us", "ssn", "phone", null]);
});

test("ID and order-number columns are not read as phones, cards or Aadhaar numbers", async () => {
  const csv = "customer_ref,order_no,phone\n100000000001,10002345,4155550134\n100000000002,10002346,2125550100\n100000000003,10002347,6175550182\n";
  const { detection } = await run(new File([csv], "orders.csv"));
  assert.deepEqual(detection.map((r) => r.top?.detectorId || null), [null, null, "phone"]);
  const formatted = await run(new File(["contact\n+1 415 555 0134\n(212) 555-0100\n"], "c.csv"));
  assert.equal(formatted.detection[0].top?.detectorId, "phone", "a number written like a phone counts without a phone header");
});

test("an Aadhaar number needs its Verhoeff check digit and a column named for it", async () => {
  assert.ok(aadhaarValid("2341 2341 2346") && aadhaarValid("999941057058"));
  assert.ok(!aadhaarValid("2341 2341 2347") && !aadhaarValid("100000000001"));
  const named = await run(new File(["aadhaar\n2341 2341 2346\n999941057058\n"], "a.csv"));
  assert.equal(named.detection[0].top?.detectorId, "aadhaar");
  const unnamed = await run(new File(["reference\n2341 2341 2346\n999941057058\n"], "b.csv"));
  assert.notEqual(unnamed.detection[0].top?.detectorId, "aadhaar");
});

// 2026-09-28, evening: the independent review of the release.
test("ten digits that fail the NHS check digit are an ID, not a mistyped NHS number", async () => {
  const ids = await run(new File(["order_id\n1000000001\n1000000002\n1000000003\n"], "o.csv"), "keep");
  assert.equal(ids.detection[0].top, null);
  const nhs = await run(new File(["nhs_number\n9434765919\n4010232137\n"], "n.csv"), "keep");
  assert.equal(nhs.detection[0].top?.detectorId, "nhs");
});

test("a phone column named in another language or in shorthand counts as a phone column", async () => {
  for (const header of ["telefon", "msisdn", "mob", "handy"]) {
    const { detection } = await run(new File([`${header}\n4155550134\n2125550100\n6175550182\n`], "p.csv"), "keep");
    assert.equal(detection[0].top?.detectorId, "phone", header);
  }
});

test("a headerless file of names, dates of birth and addresses is data from its first row", async () => {
  const csv = "Ada Lovelace,1985-12-10,12 Example Street,94107\nGrace Hopper,1906-12-09,34 Sample Road,10001\nMary Jackson,1921-04-09,56 Fixture Avenue,23669\n";
  const { parsed } = await run(new File([csv], "people.csv"), "keep");
  assert.equal(parsed.meta.headerless, true);
  assert.deepEqual(parsed.headers, ["column_1", "column_2", "column_3", "column_4"]);
  assert.equal(parsed.rows.length, 3);
  const sheet = await run(new File(["name,2026-09-01,2026-09-02\nAda,8,7.5\nGrace,7,8\n"], "hours.csv"), "keep");
  assert.notEqual(sheet.parsed.meta.headerless, true, "a timesheet's date columns are a header: the cells below are hours");
  assert.deepEqual(sheet.parsed.headers, ["name", "2026-09-01", "2026-09-02"]);
});

test("a header row narrower than the data keeps the extra columns; a trailing comma adds none", async () => {
  const wide = await run(new File(["a,b\n1,2,ada@example.org\n3,4,grace@example.org\n"], "w.csv"), "keep");
  assert.deepEqual(wide.parsed.headers, ["a", "b", "column_3"]);
  assert.equal(wide.parsed.rows[0][2], "ada@example.org");
  assert.equal(wide.detection.find((r) => r.index === 2)?.top?.detectorId, "email");
  const trailing = await run(new File(["a,b\n1,2,\n3,4,\n"], "t.csv"), "keep");
  assert.deepEqual(trailing.parsed.headers, ["a", "b"]);
});

test("a sixteen-digit number kept in an Excel file goes back as text, so Excel shows every digit", async () => {
  const file = await workbook([["card_number"], [4111111111111111]]);
  const { output } = await run(file, "keep");
  const ws = await cellsOf(output);
  assert.equal(ws.A2.t, "s");
  assert.equal(ws.A2.v, "4111111111111111");
});
