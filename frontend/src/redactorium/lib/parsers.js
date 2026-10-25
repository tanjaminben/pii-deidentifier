/**
 * Parsers — read CSV / XLSX / DOCX / PDF / TXT into { kind, format, headers, rows, meta }.
 * Spreadsheets become tables. Documents become one column of text (lines of a text file or
 * PDF, segments of a Word file) that the scanner reads inside, then join back on export.
 */

import Papa from "papaparse";
import * as XLSX from "xlsx";
import { parseDOCXStructured } from "./docxHandler.js";
import { DETECTORS } from "./piiPatterns.js";
import { pdfTextLines } from "./pdfText.js";

// The browser build (xlsx.mjs) exports SSF by name; Node loads the CommonJS build, where it
// sits on the default export. The tests run in Node, the page in the browser.
const SSF = XLSX.SSF || (XLSX.default && XLSX.default.SSF);

// ---- header row or data row? ----
// A spreadsheet's first row is read as column names. When that row holds an email address, a
// card number, an SSN or the like, it is data, and treating it as names would copy it into the
// clean file untouched. Then every row is data and the columns are numbered instead.
const DATA_SHAPED = new Set(["email", "phone", "ssn", "credit_card", "iban", "ipv4", "ipv6", "mac", "url"]);
// Shapes a column name never has but a person's row does: a date (of birth), a street address, a
// postcode. They count only when the column below shares the shape, so a timesheet whose
// column names are dates (with hours below them) keeps its header.
const ROW_SHAPED = new Set(["dob", "address_street", "place_us", "postal_us", "postal_uk"]);
const ROW_SHAPE_MIN = 0.5;
const shaped = (v, ids, min) => v !== "" && DETECTORS.some((d) => ids.has(d.id) && d.test(v) >= min);
export function firstRowIsData(row, rest = []) {
  return row.some((cell, i) => {
    const v = String(cell ?? "").trim();
    if (shaped(v, DATA_SHAPED, 0.9)) return true;
    if (!shaped(v, ROW_SHAPED, ROW_SHAPE_MIN)) return false;
    const below = rest.map((r) => String(r[i] ?? "").trim()).filter((x) => x !== "");
    return below.length > 0 && below.filter((x) => shaped(x, ROW_SHAPED, ROW_SHAPE_MIN)).length >= Math.ceil(below.length * 0.35);
  });
}
// A row's width stops at its last non-empty cell, so a trailing delimiter adds no column.
const filledWidth = (r) => { let n = r.length; while (n > 0 && String(r[n - 1] ?? "").trim() === "") n--; return n; };
function tableFrom(data, format, meta) {
  const width = data.reduce((w, r) => Math.max(w, filledWidth(r)), data[0].length);
  if (firstRowIsData(data[0], data.slice(1))) {
    const headers = Array.from({ length: width }, (_, i) => `column_${i + 1}`);
    return { kind: "table", format, headers, rows: data.map((r) => headers.map((_, i) => r[i] ?? "")), meta: { ...meta, headerless: true } };
  }
  // A header row narrower than the rows below it names what it names; the extra columns keep
  // their data under a numbered name instead of being dropped from the clean file.
  const headers = Array.from({ length: width }, (_, i) => (i < data[0].length ? String(data[0][i] ?? "") : `column_${i + 1}`));
  return { kind: "table", format, headers, rows: data.slice(1).map((r) => headers.map((_, i) => r[i] ?? "")), meta };
}

// ---- CSV ----
export async function parseCSV(file) {
  // Read the bytes first: Papa's File path needs FileReader, which only a browser has, and a
  // string parses identically everywhere. The decoder drops a UTF-8 byte-order mark; note
  // whether there was one, so the clean file keeps it (Excel reads accents by it).
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const text = new TextDecoder("utf-8").decode(bytes);
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: false,
      skipEmptyLines: false,
      complete: (res) => {
        // An unclosed quote makes every row after it one long cell, and that cell would be
        // kept as it is. Refuse the file rather than hand back something half-redacted.
        const quote = (res.errors || []).find((e) => e.type === "Quotes");
        if (quote) {
          return reject(new Error(`Line ${(quote.row ?? 0) + 1} of this CSV has a quote mark that never closes, so the rows after it run together. Fix that line and try again.`));
        }
        const data = res.data || [];
        // A final newline parses as one empty row; it is not data.
        const last = data[data.length - 1];
        if (data.length > 1 && last && last.length === 1 && last[0] === "") data.pop();
        if (data.length === 0 || data.every((r) => r.every((c) => String(c ?? "") === ""))) {
          return reject(new Error("This CSV file is empty"));
        }
        resolve(tableFrom(data, "csv", { sheetName: null, bom, delimiter: res.meta?.delimiter || ",", newline: res.meta?.linebreak || "\n" }));
      },
      error: reject,
    });
  });
}

// ---- XLSX ----
// A digit mask pads or punctuates a number (00000, 000-00-0000, (###) ###-####, and Excel's
// Phone format with its [<=9999999] condition). Plain 0, thousands separators, decimals,
// currency and percent all mean a quantity, which stays a number.
export function isDigitMask(format) {
  const sections = String(format).replace(/\[[^\]]*\]/g, "").split(";").filter(Boolean);
  return sections.length > 0 && sections.every((s) => /^[0#\-\s()]+$/.test(s) && (/[-\s()]/.test(s) || /^0{2,}$/.test(s)));
}

export async function parseXLSX(file) {
  const buf = await file.arrayBuffer();
  let wb;
  try { wb = XLSX.read(buf, { type: "array", cellNF: true }); }
  catch { throw new Error("This file could not be opened as a spreadsheet"); }
  // The first sheet a person would see: hidden sheets are skipped.
  const visible = wb.SheetNames.filter((_, i) => !wb.Workbook?.Sheets?.[i]?.Hidden);
  const sheetName = visible[0] || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  for (const [addr, cell] of Object.entries(ws)) {
    if (addr[0] === "!" || !cell || cell.t !== "n" || !cell.z) continue;
    if (SSF.is_date(cell.z)) {
      // Dates are stored as day counts; write them as dates, or a birth date reads as a ZIP code.
      cell.v = SSF.format(cell.v % 1 ? "yyyy-mm-dd hh:mm:ss" : "yyyy-mm-dd", cell.v);
    } else if (isDigitMask(cell.z)) {
      // A number shown through a digit mask is an identifier: 2139 under 00000 is the ZIP
      // 02139, and 78051120 under 000-00-0000 is an SSN. Read the text a person sees, which is
      // what the detectors match and what goes back out.
      cell.v = SSF.format(cell.z, cell.v);
    } else continue;
    cell.t = "s";
    // A text cell that keeps its number format is read back as a broken value (SheetJS 0.20).
    delete cell.w;
    delete cell.z;
  }
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (aoa.length === 0) throw new Error(`The sheet "${sheetName}" is empty`);
  return tableFrom(aoa, "xlsx", { sheetName, sheetNames: wb.SheetNames });
}

// ---- DOCX ----  (structured — preserves formatting for round-trip)
export async function parseDOCX(file) {
  return parseDOCXStructured(file);
}

// ---- TXT / Markdown / log ----
export async function parseTXT(file, ext = "txt") {
  const text = await file.text();
  const rows = text.split(/\r?\n/).map(l => [l]);
  return {
    kind: "text",
    format: "txt",
    headers: ["line"],
    rows,
    meta: { originalText: text, joiner: text.includes("\r\n") ? "\r\n" : "\n", ext },
  };
}

// ---- PDF ----  (pdfjs-dist, imported dynamically to keep the main bundle small)
export async function parsePDF(file) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf");
  // Keep file contents inside this origin. The matching worker is vendored in public/.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.min.mjs", document.baseURI).href;
  const buf = await file.arrayBuffer();
  let doc;
  // isEvalSupported: false keeps pdf.js from compiling font programs with new Function; the
  // page CSP has no unsafe-eval.
  try { doc = await pdfjs.getDocument({ data: buf, isEvalSupported: false }).promise; }
  catch (e) {
    if (e && e.name === "PasswordException") throw new Error("This PDF is password-protected. Remove the password, then try again.");
    throw new Error("This file could not be opened as a PDF");
  }
  // One row per line of text, as the PDF lays it out; pageStarts marks where each page begins
  // so the clean PDF keeps the same page breaks.
  const lines = [];
  const pageStarts = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pageStarts.push(lines.length);
    for (const line of pdfTextLines(content.items)) lines.push(line);
  }
  if (!lines.some((l) => l.trim())) {
    throw new Error("This PDF has no text Redactorium can read. It is probably a scan, which is a picture of text.");
  }
  return {
    kind: "text",
    format: "pdf",
    headers: ["line"],
    rows: lines.map(t => [t]),
    meta: { joiner: "\n", pageStarts, pageCount: doc.numPages },
  };
}

// ---- dispatch ----
export async function parseFile(file) {
  const name = file.name.toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : "";
  if (ext === "csv") return parseCSV(file);
  if (ext === "xlsx" || ext === "xls") return parseXLSX(file);
  if (ext === "docx") return parseDOCX(file);
  if (ext === "pdf") return parsePDF(file);
  if (ext === "txt" || ext === "md" || ext === "log") return parseTXT(file, ext);
  throw new Error(`Redactorium can't read .${ext || "(no extension)"} files. Try CSV, Excel, Word, PDF, or a text or log file.`);
}
