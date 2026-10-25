/**
 * textScan — finds personal data INSIDE running text: a sentence in a PDF, a paragraph in a
 * Word document, a line in a log, a notes cell in a spreadsheet.
 *
 * The column detectors in piiPatterns.js ask "is this whole cell an email address?". That is
 * the right question for a spreadsheet column and the wrong one for prose, where the email
 * address sits in the middle of a sentence. This module asks "where in this text is there an
 * email address?" and returns the exact spans, so a treatment can replace the address and
 * leave the sentence around it alone.
 *
 * Every pattern here is a plain regular expression with no lookbehind (Safari before 16.4
 * cannot compile lookbehind, and one bad regex fails the whole bundle). A boundary before a
 * match is a consumed prefix group instead; the span offsets skip it.
 *
 * Kinds that only make sense with a label nearby (a date is only a date of birth after
 * "born" or "DOB"; ten digits are only an NHS number after "NHS") carry a `context` regex that
 * must match in the few characters before the value.
 */

import { luhnCheck, ssnValid, ibanValid, nhsValid, aadhaarValid, EMAIL_SOURCE } from "./piiPatterns.js";
import { PLACE_SOURCE } from "./places.js";

const CONTEXT_WINDOW = 32; // characters before a value that a context label may occupy

const MONTHS = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const STREET_WORDS = "(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Ter|Circle|Cir|Parkway|Pkwy|Highway|Hwy|Square|Sq)";

// Each entry: id (matches a DETECTORS id, which supplies the name and citation), a global
// regex whose group 1 is the value (group 0 may include one consumed boundary character), a
// score, and optional `valid(value)` and `context` gates.
export const TEXT_PATTERNS = [
  {
    id: "place_us",
    re: new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}_])(${PLACE_SOURCE})`, "gu"),
    score: 0.65,
  },
  {
    id: "email",
    re: new RegExp(String.raw`(^|[^\p{L}\p{M}\p{N}\p{Cf}._%+\-])(${EMAIL_SOURCE})(?![\p{L}\p{M}\p{N}\p{Cf}\-])`, "gu"),
    score: 0.97,
  },
  {
    id: "credit_card",
    // 4-4-4-4(-3) with one consistent separator, Amex 4-6-5, or 13 to 19 digits in a row.
    re: /(^|[^0-9-])(\d{4}([ .-]?)\d{4}\3\d{4}\3\d{1,4}(?:\3\d{1,3})?|\d{4}([ .-]?)\d{6}\4\d{5}|\d{13,19})(?![0-9])/g,
    score: 0.97,
    valid: (v) => { const d = v.replace(/\D/g, ""); return d.length >= 13 && d.length <= 19 && luhnCheck(d); },
  },
  {
    id: "ssn",
    re: /(^|[^0-9-])(\d{3}-\d{2}-\d{4})(?![0-9-]*[0-9])/g,
    score: 0.95,
    valid: (v) => ssnValid(v),
  },
  {
    id: "ssn",
    // Nine digits with spaces or none only count after an SSN label.
    re: /(^|[^0-9])(\d{3} ?\d{2} ?\d{4})(?![0-9])/g,
    score: 0.9,
    valid: (v) => ssnValid(v.replace(/ /g, "")),
    context: /\b(?:ssn|social security(?: number| no\.?)?|ss#)\b/i,
  },
  {
    id: "iban",
    re: /(^|[^A-Za-z0-9])([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?)(?![A-Za-z0-9])/g,
    score: 0.98,
    valid: (v) => ibanValid(v),
  },
  {
    id: "nhs",
    re: /(^|[^0-9])(\d{3}[ -]?\d{3}[ -]?\d{4})(?![0-9])/g,
    score: 0.96,
    valid: (v) => nhsValid(v),
    context: /\bnhs\b/i,
  },
  {
    id: "phone",
    // International: +CC then 2 to 5 groups. The digit count is checked after matching.
    re: /(^|[^\w+])(\+\d{1,3}(?:[ .-]?\(?\d{1,5}\)?){2,6})(?![0-9])/g,
    score: 0.9,
    valid: (v) => { const n = v.replace(/\D/g, "").length; return n >= 8 && n <= 15; },
    // The match is greedy and runs into whatever number follows ("+44 7700 900123 2026-09-28",
    // "... 10:30", "... 1st floor"). Trailing groups are dropped while the digit count is over
    // 15, then while the text right after the value carries on as a date (-09-28, /09/2026,
    // .09.2026), a time (:30) or an ordinal (1st), so the phone ends where the phone ends.
    refine: (value, text, start) => {
      const m = value.match(/^(\+\d{1,3})((?:[ .-]?\(?\d{1,5}\)?)+)$/);
      if (!m) return value;
      const groups = m[2].split(/(?=[ .-])/).filter(Boolean);
      const digits = (v) => v.replace(/\D/g, "").length;
      let v = value;
      while (groups.length > 1) {
        const after = text.slice(start + v.length, start + v.length + 12);
        if (digits(v) > 15 || /^[-/.]\d{1,2}[-/.]\d{2,4}|^:\d{2}|^(?:st|nd|rd|th)\b/i.test(after)) {
          groups.pop();
          v = m[1] + groups.join("");
          continue;
        }
        break;
      }
      return v;
    },
  },
  {
    id: "phone",
    // North American: (415) 555-0134, 415-555-0134, 415.555.0134, 415 555 0134.
    re: /(^|[^\w+-])(\(\d{3}\) ?\d{3}[ .-]\d{4}|\d{3}([ .-])\d{3}\3\d{4})(?![0-9-]*[0-9])/g,
    score: 0.85,
  },
  {
    id: "phone",
    re: /(^|[^\w+\-])(1[ .-]\d{3}[ .-]\d{3}[ .-]\d{4}|0\d{4}[ .-]\d{6}|0\d{2}[ .-]\d{4}[ .-]\d{4}|[6-9]\d{4}[ .-]\d{5}|\d{10})(?![\d-])/g,
    score: 0.8,
    context: /\b(?:phone|mobile|tel(?:ephone)?|call|contact)\s*[:=]?\s*$/i,
  },
  {
    id: "ipv4",
    re: /(^|[^0-9.])((?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))(?![0-9]|\.[0-9])/g,
    score: 0.9,
  },
  {
    id: "ipv6",
    re: /(^|[^0-9A-Fa-f:])((?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,7}:(?![0-9A-Fa-f])|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,5}(?::[0-9A-Fa-f]{1,4}){1,2}|(?:[0-9A-Fa-f]{1,4}:){1,4}(?::[0-9A-Fa-f]{1,4}){1,3}|(?:[0-9A-Fa-f]{1,4}:){1,3}(?::[0-9A-Fa-f]{1,4}){1,4}|(?:[0-9A-Fa-f]{1,4}:){1,2}(?::[0-9A-Fa-f]{1,4}){1,5}|[0-9A-Fa-f]{1,4}:(?::[0-9A-Fa-f]{1,4}){1,6})(?![0-9A-Fa-f:])/g,
    score: 0.85,
    // "::" alone, or a clock like 10::30, is not an address worth flagging.
    valid: (v) => (v.match(/[0-9A-Fa-f]{1,4}/g) || []).length >= 3,
  },
  {
    id: "mac",
    re: /(^|[^0-9A-Fa-f:-])([0-9A-Fa-f]{2}([:-])[0-9A-Fa-f]{2}(?:\3[0-9A-Fa-f]{2}){4})(?![0-9A-Fa-f]|[:-][0-9A-Fa-f])/g,
    score: 0.95,
  },
  {
    id: "dob",
    re: new RegExp(`(^|[^0-9A-Za-z])(\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{4}|${MONTHS}\\.? \\d{1,2}(?:st|nd|rd|th)?,? \\d{4}|\\d{1,2}(?:st|nd|rd|th)? ${MONTHS}\\.?,? \\d{4})(?![0-9])`, "g"),
    score: 0.8,
    context: /\b(?:born|birth(?:day|date)?|dob|d\.o\.b\.?|date of birth)\b/i,
  },
  {
    id: "person_name",
    // Quoted fields give lowercase and non-Latin names a reliable boundary.
    re: /((?:^|[^\p{L}])["']?(?:full[ _]?name|first[ _]?name|last[ _]?name|name|patient|customer|employee|client|applicant)["']?\s*[:=]\s*["'])([\p{L}\p{M}][\p{L}\p{M}'’.-]*(?:[ \t]+[\p{L}\p{M}][\p{L}\p{M}'’.-]*){0,5})(?=["'])/giu,
    score: 0.65,
  },
  {
    id: "dob",
    re: new RegExp(`(^|[^0-9A-Za-z])(\\d{1,2}-${MONTHS}-\\d{4}|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2})(?![0-9])`, "gi"),
    score: 0.8,
    context: /\b(?:born|birth(?:day|date)?|dob|d\.o\.b\.?|date of birth)\b/i,
  },
  {
    id: "person_name",
    // Only a labeled name: "Name: Ada Lovelace", "patient=Grace Hopper", "Dear Alan Turing,".
    // Group 1 is the label (consumed, never replaced); group 2 is the name. Capitalized
    // words, or one lowercase token for log fields such as name=jsmith.
    re: /((?:^|[^\p{L}])["']?(?:(?:(?:[Ff]ull|[Ff]irst|[Ll]ast|[Cc]ustomer|[Pp]atient|[Ee]mployee|[Cc]ontact|[Cc]lient|[Aa]pplicant|[Uu]ser)[ _]?)?(?:[Nn]ame|NAME)|[Pp]atient|PATIENT|[Cc]ustomer|CUSTOMER|[Ee]mployee|[Cc]lient|[Aa]pplicant)["']?\s*[:=]\s*["']?(?:(?:Dr|Mr|Mrs|Ms|Prof)\.?\s+)?|(?:^|[^\p{L}])(?:Dear|DEAR|dear)\s+(?:(?:Dr|Mr|Mrs|Ms|Prof)\.?\s+)?)([\p{Lu}\p{Lt}\p{Lo}][\p{L}\p{M}'’.-]*(?: (?:van |von |de |del |da |di |la |le |der |den )*[\p{Lu}\p{Lt}\p{Lo}][\p{L}\p{M}'’.-]*){0,3}|[a-z][a-z0-9._'’-]*[a-z0-9])(?=[\s,;.|)"'\]]|$)/gu,
    score: 0.6,
    // A lowercase value is a log field (name=jsmith), so it must sit hard against "=" or ":".
    // That keeps "Dear team," and "name: the account" out.
    validAt: (value, text, start) => /[\p{Lu}\p{Lt}\p{Lo}]/u.test(value[0]) || /[:=]$/.test(text.slice(0, start)),
  },
  {
    id: "address_street",
    re: new RegExp(`(^|[^0-9A-Za-z])(\\d{1,6}(?: [A-Z][A-Za-z'’.-]+){1,4} ${STREET_WORDS}\\.?)(?![A-Za-z])`, "g"),
    score: 0.6,
  },
  {
    id: "postal_us",
    // A ZIP code right after a state abbreviation ("Springfield, IL 62704") or a ZIP label.
    re: /(^|[^0-9])(\d{5}(?:-\d{4})?)(?![0-9])/g,
    score: 0.75,
    context: /(?:\b[A-Z]{2},?\s+|\b[Zz][Ii][Pp](?:\s*[Cc]ode)?\s*[:#]?\s*)$/,
  },
  {
    id: "postal_uk",
    re: /(^|[^A-Za-z0-9])([A-Z]{1,2}\d[A-Z\d]?[ \t]?\d[A-Z]{2})(?![A-Za-z0-9])/gi,
    score: 0.8,
  },
  {
    id: "url",
    re: /(^|[^A-Za-z0-9_])(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)}\]])/gi,
    score: 0.55,
  },
  {
    id: "passport",
    re: /(^|[^A-Za-z0-9])([A-Z0-9]{6,9})(?![A-Za-z0-9])/g,
    score: 0.7,
    valid: (v) => /^[0-9]{9}$/.test(v) || (/[A-Z]/.test(v) && /\d/.test(v)),
    context: /\bpassport(?:\s*(?:no\.?|number|#))?\s*[:#]?\s*$/i,
  },
  {
    id: "us_dl",
    re: /(^|[^A-Za-z0-9])([A-Z]{1,2}\d{5,8})(?![A-Za-z0-9])/g,
    score: 0.7,
    context: /\b(?:driver'?s? licen[cs]e|licen[cs]e(?:\s*(?:no\.?|number|#))?|dl\s*#?)\s*[:#]?\s*$/i,
  },
  {
    id: "aadhaar",
    re: /(^|[^0-9])(\d{4} ?\d{4} ?\d{4})(?![0-9])/g,
    score: 0.75,
    context: /\baadhaa?r\b/i,
    valid: (v) => aadhaarValid(v),
  },
];

/**
 * Find every span of personal data in `text`.
 * extra: compiled custom rules ({ id, find: RegExp(global), base }).
 * Returns spans sorted by start: { start, end, detectorId, value, score }. Overlaps are
 * resolved in favor of the stronger claim (higher score, then the longer match).
 */
export function scanText(text, { extra = [], knownNames = null } = {}) {
  const s = String(text ?? "");
  if (!s) return [];
  const found = [];
  for (const p of TEXT_PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(s)) !== null) {
      const start = m.index + m[1].length;
      // A pattern may hand back a shorter value (a phone that ran into a date), never a longer one.
      const value = p.refine ? p.refine(m[2], s, start) : m[2];
      const end = start + value.length;
      const accepted = value !== ""
        && (!p.valid || p.valid(value))
        && (!p.validAt || p.validAt(value, s, start))
        && (!p.context || p.context.test(s.slice(Math.max(0, start - CONTEXT_WINDOW), start)));
      if (!accepted) {
        // Resume just past the value's first character, not past its end: a real card or IBAN can
        // start inside a rejected candidate ("0134 4111 1111 1111 1111" fails the check digit,
        // "4111 1111 1111 1111" inside it passes), and the scanner must get to try it.
        p.re.lastIndex = start + 1;
        continue;
      }
      // Step back to the value's end so an adjacent match can reuse the boundary character.
      p.re.lastIndex = end > m.index ? end : m.index + 1;
      found.push({ start, end, detectorId: p.id, value, score: p.score });
    }
  }
  for (const rule of extra) {
    if (!rule.find) continue;
    rule.find.lastIndex = 0;
    let m, guard = 0;
    while ((m = rule.find.exec(s)) !== null) {
      if (guard++ >= 10000) throw new Error("Max limit of 10,000 matches reached.");
      if (m[0].length === 0) { rule.find.lastIndex++; continue; }
      found.push({ start: m.index, end: m.index + m[0].length, detectorId: rule.id, value: m[0], score: rule.base ?? 0.85 });
    }
  }
  if (knownNames) {
    // A label may recognize only a prefix before an initial ("Name: Ada M. Lovelace").
    // Give the known full name that label's score so the longer match wins the tie.
    const nameScores = new Map();
    for (const span of found) {
      if (span.detectorId === "person_name") {
        nameScores.set(span.start, Math.max(span.score, nameScores.get(span.start) || 0));
      }
    }
    knownNames.re.lastIndex = 0;
    let m;
    while ((m = knownNames.re.exec(s)) !== null) {
      const start = m.index + m[1].length;
      const value = m[2];
      const score = Math.max(knownNames.scores.get(value), nameScores.get(start) || 0);
      found.push({ start, end: start + value.length, detectorId: "person_name", value, score });
    }
  }
  return resolveOverlaps(found);
}

const OPENING_LINES = 5;
const NAME_LINE = /^\p{Lu}[\p{L}\p{M}'’-]*\.?(?:[ \t]+\p{Lu}[\p{L}\p{M}'’-]*\.?){1,3}$/u;
// Exclude obvious headings, roles, organizations and regions. This remains a low-score
// candidate rule, not a promise to distinguish every person's name from every title.
const NOT_NAME = /\b(?:area|greater|region|city|county|state|street|road|avenue|manager|director|engineer|developer|analyst|consultant|officer|president|executive|assistant|coordinator|specialist|architect|designer|lead|head|chief|senior|junior|vp|ceo|cto|cfo|partner|attorney|nurse|doctor|legal|counsel|inc|ltd|llc|corp|company|group|holdings|university|college|school|department|institute|resume|curriculum|vitae|experience|education|skills|summary|profile|project|hours|timesheet|weekly|monthly|quarterly|annual|report|review|overview|sales|customer|support|protection|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Build context once for one document, shared by detection and treatment. A name found
 * after a label or in the opening five non-empty body lines seeds exact whole-name
 * repeats throughout that document, including Word headers and footers. Nothing is
 * learned from another file, a spreadsheet column, or a saved preset.
 */
export function documentScanOptions(parsed, extra = []) {
  if (parsed.kind !== "text" && parsed.kind !== "docx-structured") return { extra };
  const scores = new Map();
  const remember = (value, score) => scores.set(value, Math.max(score, scores.get(value) || 0));
  let opening = 0;
  parsed.rows.forEach((row, i) => {
    const text = String(row[0] ?? "");
    for (const sp of scanText(text, { extra })) {
      if (sp.detectorId === "person_name") remember(sp.value, sp.score);
    }
    const seg = parsed.meta?.segments?.[i];
    const body = parsed.kind !== "docx-structured"
      || (seg?.path === "word/document.xml" && !seg.runs.some((r) => r.attr));
    if (!body || opening >= OPENING_LINES) return;
    for (const line of text.split(/\r?\n/)) {
      const name = line.trim();
      if (!name) continue;
      if (opening++ >= OPENING_LINES) break;
      if (name.length <= 40 && NAME_LINE.test(name) && !NOT_NAME.test(name)) remember(name, 0.45);
    }
  });
  if (!scores.size) return { extra };
  const names = [...scores.keys()].sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
  const re = new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}_-])(${names})(?![\\p{L}\\p{M}\\p{N}_-])`, "gu");
  return { extra, knownNames: { re, scores } };
}

/**
 * Resolve overlapping candidates: the strongest claim wins (higher score, then the longer
 * match, then the earlier start), and a candidate is kept only if it overlaps nothing already
 * kept. Candidates are first grouped into runs of touching spans, because a span can only
 * conflict with spans in its own run: the greedy pass then stays linear over a whole log.
 * Comparing every candidate with every kept span was quadratic, and a 2 MB log with 40,000
 * matches took seconds (5.5 s on a shared CI runner).
 */
export function resolveOverlaps(found) {
  const byStart = found.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const strongestFirst = (a, b) => b.score - a.score || (b.end - b.start) - (a.end - a.start) || a.start - b.start;
  const kept = [];
  let run = [];
  let runEnd = -Infinity;
  const flush = () => {
    if (run.length === 1) {
      kept.push(run[0]);
    } else if (run.length > 1) {
      run.sort(strongestFirst);
      const local = [];
      for (const f of run) {
        if (local.some((k) => f.start < k.end && k.start < f.end)) continue;
        local.push(f);
      }
      kept.push(...local);
    }
    run = [];
  };
  for (const f of byStart) {
    if (f.start >= runEnd) flush();
    run.push(f);
    if (f.end > runEnd) runEnd = f.end;
  }
  flush();
  return kept.sort((a, b) => a.start - b.start || strongestFirst(a, b));
}

/**
 * Summarize the spans found across many texts (the cells of one column, or every paragraph of
 * a document): one entry per kind, with how many matches, in how many texts, up to three
 * examples, and the average score.
 */
export function summarizeSpans(texts, opts = {}) {
  const byKind = new Map();
  texts.forEach((t) => {
    const seen = new Set();
    for (const sp of scanText(t, opts)) {
      let k = byKind.get(sp.detectorId);
      if (!k) { k = { detectorId: sp.detectorId, matches: 0, texts: 0, scoreSum: 0, examples: [] }; byKind.set(sp.detectorId, k); }
      k.matches++;
      k.scoreSum += sp.score;
      if (!seen.has(sp.detectorId)) { seen.add(sp.detectorId); k.texts++; }
      if (k.examples.length < 3 && !k.examples.includes(sp.value)) k.examples.push(sp.value);
    }
  });
  return [...byKind.values()]
    .map((k) => ({ detectorId: k.detectorId, matches: k.matches, texts: k.texts, confidence: Number((k.scoreSum / k.matches).toFixed(3)), examples: k.examples }))
    .sort((a, b) => b.matches - a.matches || b.confidence - a.confidence);
}

/**
 * Rewrite `text`, replacing each span whose kind has a treatment. `treat(span)` returns the
 * replacement string, or null to keep the original. Returns { text, changed } where changed
 * counts the spans actually replaced.
 */
export function rewriteSpans(text, spans, treat) {
  let out = "";
  let last = 0;
  let changed = 0;
  for (const sp of spans) {
    const next = treat(sp);
    if (next === null || next === undefined || next === sp.value) continue;
    out += text.slice(last, sp.start) + next;
    last = sp.end;
    changed++;
  }
  return { text: out + text.slice(last), changed };
}
