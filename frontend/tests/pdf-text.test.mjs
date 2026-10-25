import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfTextLines } from "../src/redactorium/lib/pdfText.js";
import { detectColumns } from "../src/redactorium/lib/detector.js";

const item = (str, x, y, width, height = 10, hasEOL = false) => ({
  str, transform: [height, 0, 0, height, x, y], width, height, hasEOL,
});

test("PDF header columns do not swallow a name when hasEOL is missing", () => {
  // Synthetic text with the geometry that reproduced the reported resume failure.
  const rows = pdfTextLines([
    item("Austin, TX", 46, 714, 53, 10, true),
    item("Greater Metro Area", 46, 701, 102),
    item(" ", 148, 701, 130),
    item("Maya Penrose", 246, 708, 90, 16),
    item("", 211, 692, 0, 10, true),
    item("Product Manager", 211, 692, 159, 12, true),
  ]);
  assert.deepEqual(rows, ["Austin, TX", "Greater Metro Area", "Maya Penrose", "Product Manager"]);
  const findings = detectColumns({ kind: "text", headers: ["line"], rows: rows.map(s => [s]), meta: {} });
  assert.equal(findings.find(d => d.top?.detectorId === "person_name")?.top.matches, 1);
});

test("PDF columns on the same baseline stay separate across wide synthetic spaces", () => {
  assert.deepEqual(pdfTextLines([
    item("Maya Penrose", 40, 700, 70), item(" ", 110, 700, 170),
    item("maya@example.org", 280, 700, 100, 10, true),
  ]), ["Maya Penrose", "maya@example.org"]);
});

test("PDF fields drawn in reverse column order do not merge an email and name", () => {
  const rows = pdfTextLines([
    item("maya@example.org", 280, 700, 100), item("Maya Penrose", 40, 700, 70),
  ]);
  assert.deepEqual(rows, ["maya@example.org", "Maya Penrose"]);
  const findings = detectColumns({ kind: "text", headers: ["line"], rows: rows.map(s => [s]), meta: {} });
  assert.equal(findings.find(d => d.top?.detectorId === "person_name")?.top.matches, 1);
});

test("PDF small negative kerning remains within a single identifier", () => {
  assert.deepEqual(pdfTextLines([
    item("maya", 40, 700, 25), item("@example.org", 64.5, 700, 70),
  ]), ["maya@example.org"]);
});

test("PDF lines without hasEOL respect their baselines", () => {
  assert.deepEqual(pdfTextLines([
    item("Maya Penrose", 40, 700, 70), item("Austin, TX", 40, 686, 50),
  ]), ["Maya Penrose", "Austin, TX"]);
});

test("PDF inline font changes, kerning and ordinary word spaces preserve values", () => {
  assert.deepEqual(pdfTextLines([
    item("Name:", 40, 700, 27), item("Maya", 70, 700.2, 25, 11),
    item(" Penrose", 95, 700, 43, 10, true),
    item("maya", 40, 680, 25), item("@example.org", 65, 680, 68, 11, true),
    item("+1 415", 40, 660, 32), item("555", 75, 660, 18), item("0134", 96, 660, 24),
  ]), ["Name: Maya Penrose", "maya@example.org", "+1 415 555 0134"]);
});

test("PDF whitespace EOL items and missing geometry preserve text", () => {
  assert.deepEqual(pdfTextLines([
    item("Maya Penrose", 40, 700, 70), item("", 40, 686, 0, 10, true),
    { type: "beginMarkedContent" }, { str: "Notes " }, { str: "remain", hasEOL: true },
    { str: "Last line" },
  ]), ["Maya Penrose", "Notes remain", "Last line"]);
});

test("PDF small superscripts remain attached to their surrounding text", () => {
  assert.deepEqual(pdfTextLines([
    item("(ABC)", 40, 700, 28), item("2", 68, 703, 3, 6),
    item(" Certified", 71, 700, 45, 10, true),
  ]), ["(ABC)2 Certified"]);
});

test("PDF rotated text uses its own baseline direction", () => {
  const rotate = (i) => ({ ...i, transform: [0, 10, -10, 0, i.transform[5], i.transform[4]] });
  assert.deepEqual(pdfTextLines([
    rotate(item("Name:", 40, 700, 27)), rotate(item("Maya", 70, 700, 25)),
    rotate(item(" Penrose", 95, 700, 43, 10, true)),
  ]), ["Name: Maya Penrose"]);
});
