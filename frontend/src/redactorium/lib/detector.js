import { DETECTORS } from "./piiPatterns.js";
import { summarizeSpans, documentScanOptions } from "./textScan.js";

/**
 * detectColumns
 *   Given a parsed file ({ kind, headers, rows }), return the findings the review table shows:
 *   one row per decision the reader makes.
 *
 *   A spreadsheet column whose cells ARE personal data (every cell an email address, a phone
 *   number, a name) is one "column" row: its treatment rewrites every cell in the column.
 *
 *   Free text is different: the personal data sits inside sentences. A document (PDF, Word,
 *   text, log) and any spreadsheet column with no whole-cell match are scanned inside the text
 *   instead, and each kind found there (email addresses, phone numbers, ...) becomes its own
 *   "text" row. Its treatment rewrites only the matched characters.
 *
 *   opts.customDetectors — compiled custom rules (customRules.js), appended to both passes.
 */
export function detectColumns(parsed, opts = {}) {
  const { headers, rows } = parsed;
  const isDocument = parsed.kind === "text" || parsed.kind === "docx-structured";
  const sampleLimit = opts.sampleLimit ?? 500;
  const sample = rows.slice(0, sampleLimit);
  const custom = opts.customDetectors || [];
  const allDetectors = [...DETECTORS, ...custom];
  const extra = custom.filter((d) => d.find);
  const scanOptions = documentScanOptions(parsed, extra);
  const byId = new Map(allDetectors.map((d) => [d.id, d]));
  const out = [];

  headers.forEach((header, idx) => {
    const column = isDocument ? null : columnVerdict(sample, idx, header, allDetectors);

    // Look inside the text. Every row, not a sample: a kind that first appears in row 2,000 is
    // still a kind the reader must decide about, and an undecided kind would pass through.
    const texts = rows.map((r) => (r[idx] === undefined || r[idx] === null ? "" : String(r[idx])));
    const nonEmpty = texts.filter((t) => t.trim() !== "").length;
    const kinds = summarizeSpans(texts, scanOptions);
    // A free-text header alone must not hide stronger evidence inside its values.
    // Retain direct field hints (e.g. Name), even for unfamiliar name formats.
    const proseHeader = /\b(notes?|comments?|messages?|details?|description|text)\b/i.test(header);
    const wholeColumn = column?.top && (column.top.hits > 0 || !proseHeader || kinds.length === 0);
    if (wholeColumn) {
      out.push({ ...column, key: `col:${idx}`, mode: "column", suggested: defaultTransformFor(column.top) });
    }
    if (kinds.length) {
      for (const k of kinds) {
        if (wholeColumn && k.detectorId === column.top.detectorId) continue;
        const det = byId.get(k.detectorId) || {};
        const top = {
          detectorId: k.detectorId,
          name: det.name || k.detectorId,
          category: det.category || "custom",
          tier: det.tier || "heuristic",
          citation: det.citation || "",
          confidence: k.confidence,
          matchRate: nonEmpty ? k.texts / nonEmpty : 0,
          hits: k.matches,
          matches: k.matches,
          sampled: nonEmpty,
          headerHit: false,
          examples: k.examples,
          isCustom: !!det._custom,
        };
        out.push({
          key: `text:${idx}:${k.detectorId}`,
          mode: "text",
          index: idx,
          header,
          sampled: nonEmpty,
          containsPII: true,
          top,
          findings: [top],
          suggested: defaultTextTransformFor(k.detectorId),
        });
      }
      return;
    }
    if (wholeColumn) return;

    // Nothing found. A spreadsheet column still gets a row, so the reader can redact it by
    // hand; a document with nothing found has nothing to decide.
    out.push({
      key: `${isDocument ? "text" : "col"}:${idx}`,
      mode: isDocument ? "text" : "column",
      index: idx,
      header,
      sampled: nonEmpty,
      containsPII: false,
      top: null,
      findings: [],
      suggested: "keep",
      empty: isDocument,
    });
  });
  return out;
}

// The whole-cell pass: what share of the column's cells match each detector outright.
function columnVerdict(sample, idx, header, allDetectors) {
  const values = [];
  for (const row of sample) {
    const v = row[idx];
    if (v !== undefined && v !== null && String(v).trim() !== "") values.push(String(v).trim());
  }
  const nonEmpty = values.length;
  const findings = [];
  if (nonEmpty) {
    for (const det of allDetectors) {
      let hits = 0;
      let scoreSum = 0;
      const examples = [];
      const headerHit = det.columnHint && det.columnHint.test(header);
      for (const v of values) {
        const s = det.test(v);
        if (s > 0) {
          // Some shapes count only in a column named for them: a bare run of digits is a phone
          // number in a phone column and an order or customer number anywhere else.
          if (!headerHit && det.hintOnly && det.hintOnly(v)) continue;
          hits++; scoreSum += s;
          if (examples.length < 3) examples.push(v);
        }
      }
      const matchRate = hits / nonEmpty;
      const boost = headerHit ? (det.columnHintBoost ?? 0.15) : 0;
      if (matchRate < 0.35 && !headerHit) continue;
      if (det.needsHint && !headerHit) continue; // a weak shape (five digits, C100000) counts only in a column named for it
      // A matching header counts even when no value matches: a "phone" column in a format the
      // pattern does not know is still a phone column, and missing it costs more than a false flag.
      const avgValueScore = hits ? scoreSum / hits : 0;
      const columnConfidence = Math.min(0.99, (avgValueScore || det.base) * (0.35 + 0.65 * matchRate) + boost);
      findings.push({
        detectorId: det.id,
        name: det.name,
        category: det.category,
        tier: det.tier,
        citation: det.citation,
        hits,
        sampled: nonEmpty,
        matchRate,
        confidence: Number(columnConfidence.toFixed(3)),
        headerHit: !!headerHit,
        examples,
        isCustom: !!det._custom,
      });
    }
  }
  findings.sort((a, b) => b.confidence - a.confidence);
  const top = findings[0] || null;
  return { index: idx, header, sampled: nonEmpty, containsPII: !!top, top, findings };
}

function defaultTransformFor(finding) {
  if (finding.isCustom) return "redact";
  switch (finding.detectorId) {
    case "email":
    case "phone":
    case "person_name":
    case "url":
    case "mac":
      return "synthetic";
    case "credit_card":
    case "iban":
    case "ssn":
    case "passport":
    case "us_dl":
    case "nhs":
    case "aadhaar":
      return "redact";
    case "dob":
    case "postal_us":
    case "postal_uk":
    case "ipv4":
    case "ipv6":
      return "generalize";
    case "address_street":
    case "place_us":
      return "redact";
    case "company":
    case "job_title":
      return "generalize";
    default:
      return finding.confidence > 0.7 ? "redact" : "keep";
  }
}

// Inside prose the plain default is to take the value out. Network addresses keep their
// network, which is usually what a support log needs.
function defaultTextTransformFor(detectorId) {
  return detectorId === "ipv4" || detectorId === "ipv6" ? "generalize" : "redact";
}
