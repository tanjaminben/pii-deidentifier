/**
 * Exporters — turn treated { headers, rows } back into a file in the original format, and
 * write the JSON record of the run. Saving a file to disk is the page's job (download.js), so
 * this module runs anywhere, the tests included.
 */

import Papa from "papaparse";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { buildDOCX } from "./docxHandler.js";
import { DETECTORS } from "./piiPatterns.js";
import { scanText } from "./textScan.js";

export const PDF_TEXT_FALLBACK_NOTICE = "Some characters (for example, Chinese or Cyrillic) cannot be preserved in the PDF export. Download the treated text as a text file instead.";

// The built-in Courier font uses WinAnsi, not a Unicode font. Inspect the treated
// text: unsupported characters removed by a treatment do not require a fallback.
// C1 controls are not the punctuation that Windows-1252 places at those bytes.
const PDF_SUPPORTED_TEXT = /^[\t\r\n\u0020-\u007e\u00a0-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018\u2019\u201a\u201c\u201d\u201e\u2020\u2021\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]*$/u;

// ---- a file name without the personal data in it ----
// "ada-lovelace-ssn-123-45-6789.csv" would otherwise come back as
// "ada-lovelace-ssn-123-45-6789.redacted.csv", and the record would repeat it. Dashes and
// underscores are read as spaces for the scan so labels still work ("ssn 123 45 6789"); an unlabeled name in a
// file name is not found, so the page says the name is kept.
export function cleanBaseName(fileName, extra = []) {
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const spans = scanText(base.replace(/[-_]/g, " "), { extra });
  if (!spans.length) return base;
  let out = "";
  let last = 0;
  for (const s of spans) { out += base.slice(last, s.start) + "redacted"; last = s.end; }
  return out + base.slice(last);
}

// ---- file hash helper (SHA-256 of arbitrary bytes) ----
export async function bytesSha256(bytes) {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function stringSha256(str) {
  return bytesSha256(new TextEncoder().encode(str));
}

// ---- build cleaned output as Blob + text ----
// `parsed` is the parsed file with its rows replaced by the treated rows (keep `kind` and
// `meta`: the Word writer needs both). `edits` comes from applyTransformations.
export async function buildOutput(parsed, edits = null) {
  const { format, headers, rows, meta } = parsed;
  if (format === "csv") {
    // Same delimiter and line ending as the input, the byte-order mark if it had one, and no
    // invented header row when the first row was data.
    // Quote syntax alone does not prevent spreadsheets from evaluating a cell.
    // Keep ordinary negative numbers numeric-looking; protect formula-shaped text,
    // including phone numbers beginning with +, and column headers.
    const config = { delimiter: meta?.delimiter || ",", newline: meta?.newline || "\r\n",
      escapeFormulae: /^[\t\r\n ]*[=+@]|^[\t\r\n]|^ *-(?!\d+(?:\.\d+)?$)/ };
    const csv = meta?.headerless ? Papa.unparse(rows, config) : Papa.unparse({ fields: headers, data: rows }, config);
    const blob = new Blob([meta?.bom ? "﻿" + csv : csv], { type: "text/csv;charset=utf-8" });
    return { blob, text: csv, ext: "csv", mime: "text/csv" };
  }
  if (format === "xlsx" || format === "xls") {
    const aoa = meta?.headerless ? rows : [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Excel's General format turns a whole number of twelve digits or more into 3.78282E+14, so a
    // card, account or customer number kept as it was would come back unreadable. Show it in full.
    for (const [addr, cell] of Object.entries(ws)) {
      if (addr[0] === "!" || cell.t !== "n" || !Number.isInteger(cell.v) || Math.abs(cell.v) < 1e11) continue;
      // Excel shows at most 15 significant digits, so a 16-digit card written back as a number
      // would display as ...1110: sixteen digits and up go back as text, in full.
      if (Math.abs(cell.v) >= 1e15) { cell.t = "s"; cell.v = String(cell.v); delete cell.z; }
      else cell.z = "0";
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, meta?.sheetName || "Sheet1");
    const arr = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const blob = new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const csvPreview = XLSX.utils.sheet_to_csv(ws);
    return { blob, text: csvPreview, ext: "xlsx", mime: blob.type };
  }
  if (format === "docx") {
    if (parsed.kind !== "docx-structured") throw new Error("Word output needs the parsed document structure");
    return buildDOCX(parsed, rows, edits);
  }
  // text formats — join back into a document
  const joiner = meta?.joiner ?? "\n";
  const text = rows.map(r => r[0] ?? "").join(joiner);
  if (format === "pdf") {
    if (!PDF_SUPPORTED_TEXT.test(text)) {
      return {
        blob: new Blob([text], { type: "text/plain;charset=utf-8" }), text,
        ext: "txt", mime: "text/plain", warning: PDF_TEXT_FALLBACK_NOTICE,
        fallbackReason: "pdf-font-unsupported-characters",
      };
    }
    // A new, text-only PDF from the extracted text: the original's layout, images, attachments and
    // metadata stay behind, and any text it hid (white, covered, invisible) is now plainly visible.
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    // jsPDF stamps the creation time with the local UTC offset, which says where the person
    // who ran it was. Write UTC instead.
    const now = new Date();
    const two = (n) => String(n).padStart(2, "0");
    doc.setCreationDate(`D:${now.getUTCFullYear()}${two(now.getUTCMonth() + 1)}${two(now.getUTCDate())}${two(now.getUTCHours())}${two(now.getUTCMinutes())}${two(now.getUTCSeconds())}+00'00'`);
    doc.setFont("courier", "normal"); doc.setFontSize(10);
    const margin = 54; const width = doc.internal.pageSize.getWidth() - margin * 2;
    const bottom = doc.internal.pageSize.getHeight() - margin;
    const pages = meta?.pageStarts?.length ? meta.pageStarts : [0];
    let y = margin;
    pages.forEach((start, p) => {
      if (p > 0) { doc.addPage(); y = margin; }
      const end = p + 1 < pages.length ? pages[p + 1] : rows.length;
      const pageText = rows.slice(start, end).map(r => r[0] ?? "").join("\n");
      for (const l of doc.splitTextToSize(pageText, width)) {
        if (y > bottom) { doc.addPage(); y = margin; }
        doc.text(l, margin, y); y += 12;
      }
    });
    const blob = doc.output("blob");
    return { blob, text, ext: "pdf", mime: "application/pdf" };
  }
  // Text, Markdown and log files keep their own extension.
  const ext = meta?.ext || "txt";
  const blob = new Blob([text], { type: ext === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8" });
  return { blob, text, ext, mime: "text/plain" };
}

// ---- The record (JSON) ----
// What ran, what it found, what the reader chose, and fingerprints of the file before and
// after. It never holds the personal data itself: no matched values, no examples, no hash key.
export function buildLogJSON({ inputFile, format, columnPlan, stats, detectionResults, inputHash, outputHash, outputFormat, outputFallbackReason, hashKey, seed, startedAt, finishedAt, meta, customDetectors = [], reused = [] }) {
  const where = (mode) => (mode === "text" ? "text" : "column");
  const log = {
    tool: "Redactorium",
    version: "0.2.0",
    profile: "pattern-based (no AI model, no network)",
    run: {
      started_at: startedAt,
      finished_at: finishedAt,
      environment: "browser (client-side only)",
    },
    input: {
      name: cleanBaseName(inputFile.name, customDetectors.filter((d) => d.find)) + (inputFile.name.includes(".") ? inputFile.name.slice(inputFile.name.lastIndexOf(".")) : ""),
      size_bytes: inputFile.size,
      format,
      sha256: inputHash,
    },
    output: {
      sha256: outputHash,
      format: outputFormat || format,
      ...(outputFallbackReason ? { fallback_reason: outputFallbackReason } : {}),
    },
    parameters: {
      hash_algorithm: "HMAC-SHA-256, first 16 hex characters",
      hash_key: hashKey === "user-supplied" ? "supplied by the user, not stored" : "random, generated for this run and not stored",
      synthetic_seed: seed || null,
      catalog: "SafeSeed-style reserved / cited fields",
      detectors_run: [...DETECTORS.map((d) => d.id), ...customDetectors.map((d) => d.id)],
    },
    detection: detectionResults.map((c) => ({
      found_in: where(c.mode),
      column_index: c.index,
      column_header: c.header,
      ...(c.mode === "text"
        ? { texts_scanned: c.sampled, matches: c.top ? c.top.matches : 0 }
        : { sampled_cells: c.sampled }),
      top_finding: c.top ? {
        detector: c.top.detectorId,
        name: c.top.name,
        category: c.top.category,
        tier: c.top.tier,
        citation: c.top.citation,
        confidence: c.top.confidence,
        match_rate: c.top.matchRate,
      } : null,
      all_findings: (c.findings || []).map((f) => ({
        detector: f.detectorId, confidence: f.confidence, match_rate: f.matchRate, tier: f.tier,
      })),
    })),
    transformations: columnPlan.map((p, i) => ({
      found_in: where(p.mode),
      column_index: p.index,
      column_header: p.header,
      detector: p.detectorId || null,
      transform: p.transform,
      ...(p.mode === "text"
        ? { matches_found: stats[i].sampled, matches_changed: stats[i].changed }
        : { cells_touched: stats[i].sampled, cells_changed: stats[i].changed }),
      reviewer_note: p.note && p.note.trim() ? p.note.trim() : null,
    })),
    limits: [
      ...(reused.length ? [`The fakes for ${reused.join(", ")} come from a short published list of test values and repeated once it ran out, so two different values may share one fake.`] : []),
      "This record comes from a client-side tool and is not signed. It documents what was done; it is not a cryptographic proof of who did it.",
      "Detection is pattern matching. 'Nothing found' means nothing matched the patterns, not that the file holds no personal data.",
    ],
  };
  if (meta?.cleaned) {
    const c = meta.cleaned;
    log.document_cleaning = {
      comments_removed: c.comments,
      tracked_deletions_removed: c.trackedDeletions,
      tracked_insertions_accepted: c.trackedInsertions,
      properties_cleared: c.propertiesCleared,
      hidden_data_parts_removed: c.dataPartsRemoved || 0,
      document_variables_removed: c.documentVariables || 0,
      not_read_and_left_as_is: c.unread || [],
    };
  }
  if (meta?.sheetNames && meta.sheetNames.length > 1) {
    log.sheets = { read: meta.sheetName, left_out: meta.sheetNames.filter((n) => n !== meta.sheetName) };
  }
  return log;
}
