/**
 * Transformers — per-value rewriting rules.
 * All deterministic within a run given a seed + salt (for reproducibility
 * in the transformation log).
 *
 * Synthetic values are drawn from RFC-reserved / authority-designated ranges
 * (SafeSeed's approach) so outputs are auditable and provably fake.
 */

import { scanText, documentScanOptions } from "./textScan.js";
import { isIPv6, dateYear } from "./piiPatterns.js";
import { placeState, FICTIONAL_PLACES } from "./places.js";

// ---------- deterministic PRNG (mulberry32) ----------
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function newSyntheticSeed() {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, "0")).join("");
}

// ---------- Keyed hashing (HMAC-SHA-256 via WebCrypto) ----------
// A plain SHA-256 of a Social Security number or a phone number can be reversed by hashing
// every possible value, which takes seconds. So the hash is keyed. With no key from the user,
// the key is random for this run and never stored: the same value still gets the same code
// everywhere in the file (and across a batch), but nobody can rebuild the codes from guesses.
// A key the user supplies makes the codes repeatable across runs; the record never holds it.
// One person, one code: case and spacing must not split a code ("Ada@Example.org" and
// "ada@example.org", "123-45-6789" and "123 45 6789"), so the value is normalized before it is
// keyed. Digit kinds lose their separators; everything is trimmed and lower-cased.
const DIGIT_KINDS = new Set(["ssn", "credit_card", "iban", "nhs", "aadhaar", "phone"]);
export function canonical(value, detectorId) {
  const v = String(value).trim().toLowerCase();
  return DIGIT_KINDS.has(detectorId) ? v.replace(/[\s().-]/g, "") : v;
}
export async function makeHasher(userKey = "") {
  const keyBytes = userKey ? new TextEncoder().encode(String(userKey)) : crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const cache = new Map();
  const hash = async (value, detectorId) => {
    const v = canonical(value, detectorId);
    if (cache.has(v)) return cache.get(v);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(v));
    const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
    cache.set(v, hex);
    return hex;
  };
  hash.keyMode = userKey ? "user-supplied" : "random";
  return hash;
}

// ---------- Reserved / catalog data pools (SafeSeed-style) ----------
const RESERVED_EMAIL_LOCALS = ["ada", "grace", "leibniz", "curie", "turing", "boole", "lovelace", "hopper", "erdos", "shannon"];
const RESERVED_EMAIL_DOMAINS = ["example.com", "example.org", "example.net"]; // RFC 2606
const RESERVED_NAMES_FIRST  = ["Alex", "Sam", "Robin", "Jamie", "Chris", "Taylor", "Morgan", "Casey", "Riley", "Reese", "Avery", "Blake", "Cameron", "Dakota", "Devon", "Emerson", "Finley", "Harper", "Hayden", "Jordan", "Kendall", "Logan", "Parker", "Quinn", "Rowan", "Sawyer", "Skyler", "Spencer", "Tatum", "Wren"];
const RESERVED_NAMES_LAST   = ["Testerson", "Sample", "Fixture", "Placeholder", "Draft", "Notreal", "Faux", "Nominal", "Redact", "Void", "Example", "Specimen", "Mockford", "Dummyson", "Stubbs", "Template", "Filler", "Proxy", "Standin", "Sandbox", "Blank", "Cipher", "Nullsen", "Fauxwell", "Mockington", "Sampleton", "Fixtor", "Draftwood", "Stubbington", "Ersatz"];
const RESERVED_COMPANIES    = ["ACME Test Co.", "Example Holdings Ltd", "Placeholder Industries Inc.", "Sample Group AB", "Fixture Systems GmbH", "Not-Real Partners LLC"];
const RESERVED_JOB_TITLES   = ["Test Analyst", "Sample Coordinator", "Placeholder Manager", "Fixture Designer", "Draft Specialist", "Notional Consultant"];
const RESERVED_STREETS      = ["100 Example Way", "200 Sample Street", "300 Placeholder Rd", "400 Fixture Ave", "500 Notreal Ln"];
// RFC 5737 documentation IPv4 blocks
const DOC_V4_BASES = ["192.0.2.", "198.51.100.", "203.0.113."];
// RFC 3849 documentation IPv6
const DOC_V6_PREFIX = "2001:db8::";
// ISO/IEC test PANs (Stripe-published test cards — designated-test-only)
const TEST_CARDS = ["4242424242424242", "4000056655665556", "5555555555554444", "378282246310005", "6011111111111117"];
// 999 000 0000 to 999 999 9999 is the NHS test range, so a generated number with a valid check
// digit is never a real person's, and a file of many patients gets many distinct fakes.
function nhsTestNumber(rng) {
  for (;;) {
    const body = "999" + String(Math.floor(rng() * 1e6)).padStart(6, "0");
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += Number(body[i]) * (10 - i);
    let check = 11 - (sum % 11);
    if (check === 11) check = 0;
    if (check === 10) continue;
    return body + check;
  }
}
// NANPA sets 555-0100 to 555-0199 aside for fiction in every area code, so the area code can
// vary freely: about 70,000 distinct fakes instead of 100.
const FICTITIOUS_PHONE = (rng) => {
  const n = 100 + Math.floor(rng() * 100); // 555-01xx
  let area = 200 + Math.floor(rng() * 800);
  if (Math.floor(area / 10) % 10 === 9) area -= 10; // a middle 9 is not a valid area code
  if (area % 100 === 11) area -= 1;                  // N11 codes are service numbers (411, 911)
  return `+1 ${area} 555 0${String(n).padStart(3, "0")}`;
};

// ---------- Per-detector synthetic swap ----------
export function synthetic(detectorId, rng) {
  switch (detectorId) {
    case "email": {
      const local = RESERVED_EMAIL_LOCALS[Math.floor(rng() * RESERVED_EMAIL_LOCALS.length)];
      const dom   = RESERVED_EMAIL_DOMAINS[Math.floor(rng() * RESERVED_EMAIL_DOMAINS.length)];
      const salt  = Math.floor(rng() * 1e6).toString().padStart(6, "0");
      return `${local}.${salt}@${dom}`;
    }
    case "phone": return FICTITIOUS_PHONE(rng);
    case "person_name": {
      const f = RESERVED_NAMES_FIRST[Math.floor(rng() * RESERVED_NAMES_FIRST.length)];
      const l = RESERVED_NAMES_LAST[Math.floor(rng() * RESERVED_NAMES_LAST.length)];
      return `${f} ${l}`;
    }
    case "company":  return RESERVED_COMPANIES[Math.floor(rng() * RESERVED_COMPANIES.length)];
    case "job_title":return RESERVED_JOB_TITLES[Math.floor(rng() * RESERVED_JOB_TITLES.length)];
    case "address_street": return RESERVED_STREETS[Math.floor(rng() * RESERVED_STREETS.length)];
    case "place_us": return FICTIONAL_PLACES[Math.floor(rng() * FICTIONAL_PLACES.length)];
    case "ipv4": return DOC_V4_BASES[Math.floor(rng() * 3)] + (1 + Math.floor(rng() * 253));
    case "ipv6": return DOC_V6_PREFIX + Math.floor(rng() * 65535).toString(16);
    case "mac":  {
      const oct = () => Math.floor(rng() * 256).toString(16).padStart(2, "0");
      return `02:00:00:${oct()}:${oct()}:${oct()}`; // locally administered
    }
    case "url":  return `https://example.com/${Math.floor(rng() * 1e6).toString(36)}`;
    case "credit_card": return TEST_CARDS[Math.floor(rng() * TEST_CARDS.length)];
    case "iban": {
      // GB82 WEST test IBAN with random tail preserving mod-97? For MVP, use published test IBAN
      const testIbans = ["GB82WEST12345698765432", "DE89370400440532013000", "FR1420041010050500013M02606"];
      return testIbans[Math.floor(rng() * testIbans.length)];
    }
    case "ssn": {
      // Use format-only, SSA-invalid components. Area 000 is never issued.
      const g = 10 + Math.floor(rng() * 89);
      const s = 1 + Math.floor(rng() * 9998);
      return `000-${String(g).padStart(2, "0")}-${String(s).padStart(4, "0")}`;
    }
    // Zero-led numbers no issuing authority uses, so a fake cannot collide with a real document.
    case "passport": return `X0000${String(Math.floor(rng() * 1e4)).padStart(4, "0")}`;
    case "us_dl":    return `Z000${String(Math.floor(rng() * 1e4)).padStart(4, "0")}`;
    case "nhs":      return nhsTestNumber(rng);
    case "aadhaar":  return "0000 0000 0000";
    // 00001-00099: the lowest ZIP in use is 00501, so nothing below it can be real.
    case "postal_us": return `000${String(10 + Math.floor(rng() * 90))}`;
    case "postal_uk": return "TEST_POSTCODE";
    case "dob": {
      const y = 1980 + Math.floor(rng() * 40);
      return `${y}-01-01`;
    }
    default: return "SYNTHETIC_VALUE";
  }
}

// ---------- Generalization ----------
export function generalize(value, detectorId) {
  const v = String(value ?? "");
  switch (detectorId) {
    case "place_us": return placeState(v) || redact(v);
    case "dob": {
      const year = dateYear(v) || (v.match(/\b(1[89]\d\d|20\d\d)\b/) || [])[1];
      return year ? String(year) : redact(v);
    }
    case "postal_us": return v.slice(0, 3) + "**"; // first 3 digits only
    case "postal_uk": {
      const m = v.match(/^([A-Z]{1,2}\d[A-Z\d]?)/i);
      return m ? m[1].toUpperCase() : v[0] + "***";
    }
    case "ipv4":
    case "ipv6": {
      // Keep the network, drop the host: IPv4 keeps its first two parts (/16), IPv6 its
      // first three groups (/48). A value that is neither is redacted, never passed through.
      const s = v.trim();
      const p4 = s.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}(?::\d{1,5})?$/);
      if (p4) return `${p4[1]}.${p4[2]}.0.0/16`;
      if (isIPv6(s)) {
        const [head, tail = ""] = s.split("::");
        const groups = head ? head.split(":") : [];
        const tailGroups = tail ? tail.split(":") : [];
        const full = [...groups, ...Array(Math.max(0, 8 - groups.length - tailGroups.length)).fill("0"), ...tailGroups];
        return `${full.slice(0, 3).map((g) => g || "0").join(":")}::/48`;
      }
      return redact(v);
    }
    case "credit_card": {
      // First six and last four is the PCI display rule, and only for a full-length number.
      const digits = v.replace(/\D/g, "");
      return digits.length >= 13 ? `${digits.slice(0, 6)}******${digits.slice(-4)}` : "*".repeat(Math.max(4, digits.length));
    }
    case "iban": {
      const s = v.replace(/\s/g, "");
      return s.length >= 15 ? s.slice(0, 4) + "****" + s.slice(-4) : "*".repeat(Math.max(4, s.length));
    }
    case "ssn": {
      const digits = v.replace(/\D/g, "");
      return `***-**-${digits.length === 9 ? digits.slice(-4) : "****"}`;
    }
    case "nhs": {
      const digits = v.replace(/\D/g, "");
      return `*** *** ${digits.slice(-4)}`;
    }
    case "email": {
      const [l, d] = v.split("@");
      if (!d) return "***";
      return "***@" + d;
    }
    case "phone": {
      // Keep the start (the country and area code, roughly where) and hide the last seven
      // digits, the part that identifies the line. The number keeps its own punctuation.
      const total = (v.match(/\d/g) || []).length;
      let seen = 0;
      return v.replace(/\d/g, (d) => (++seen > total - 7 ? "*" : d));
    }
    case "person_name": {
      const parts = v.split(/\s+/);
      return parts.map(p => (p[0] || "") + ".").join(" ");
    }
    case "address_street": {
      const m = v.match(/\b(street|st|road|rd|ave|avenue|blvd|boulevard|lane|ln|drive|dr|court|ct|way|place|pl)\b/i);
      return m ? "*** " + m[0] : "***";
    }
    case "company": {
      const m = v.match(/\b(Inc\.?|LLC|Ltd\.?|GmbH|AS|AB|SA|SAS|BV|PLC|Co\.?|Corp\.?)\b/i);
      return m ? "*** " + m[0] : "*** Co.";
    }
    case "job_title": {
      const seniority = /(Senior|Junior|Lead|Head|Chief|VP|Director)/i.exec(v);
      return seniority ? seniority[0] + " (generalized)" : "Professional (generalized)";
    }
    default: {
      // Generic generalization: keep first char + length bucket
      if (v.length === 0) return "";
      return v[0] + "*".repeat(Math.min(6, Math.max(1, v.length - 1)));
    }
  }
}

// ---------- Redaction ----------
export function redact(value, style = "block") {
  const v = String(value ?? "");
  if (!v) return v;
  if (style === "block") return "[REDACTED]";
  if (style === "stars") return "*".repeat(Math.min(12, Math.max(3, v.length)));
  return "[REDACTED]";
}

// Two different people must never share a fake, or a join (or a unique email column) merges
// them, so a clash is redrawn. A few kinds come from a short published list (test cards, test
// IBANs, the one NHS test number) and repeat once the list runs out.
const REDRAWS = 64;
// Kinds whose fake can take a suffix and still read as one of its kind: a name gets a middle
// initial, the others a number. So two people never share a fake however long the file.
const SUFFIXED = new Set(["person_name", "company", "job_title", "address_street", "place_us"]);
function freshFake(detectorId, ctx) {
  let used = ctx.used.get(detectorId);
  if (!used) { used = new Set(); ctx.used.set(detectorId, used); }
  let fake = synthetic(detectorId, ctx.rng);
  for (let i = 0; i < REDRAWS && used.has(fake); i++) fake = synthetic(detectorId, ctx.rng);
  if (used.has(fake)) {
    if (SUFFIXED.has(detectorId)) {
      const base = fake;
      for (let n = 1; used.has(fake); n++) {
        fake = detectorId === "place_us" ? base.replace(",", ` ${n + 1},`)
          : detectorId === "person_name" && n <= 26 && base.includes(" ")
          ? base.replace(" ", ` ${String.fromCharCode(64 + n)}. `)
          : `${base} ${n + 1}`;
      }
    } else {
      // The published pools (test cards, test IBANs) are what they are; the record says so.
      if (!ctx.reused) ctx.reused = new Set();
      ctx.reused.add(detectorId);
    }
  }
  used.add(fake);
  return fake;
}

// ---------- One value, one treatment ----------
async function treat(value, detectorId, plan, ctx) {
  switch (plan.transform) {
    case "hash": return ctx.hash(value, detectorId);
    case "redact": return redact(value, plan.redactStyle || "block");
    case "generalize": return generalize(value, detectorId);
    case "synthetic": {
      // One fake per real value within a run, so the same customer in two rows (or two files
      // of a batch) is still one customer, and joins between them keep working.
      const key = `${detectorId}\u0000${canonical(value, detectorId)}`;
      if (!ctx.fakes.has(key)) ctx.fakes.set(key, freshFake(detectorId, ctx));
      return ctx.fakes.get(key);
    }
    default: return value;
  }
}

/**
 * Apply the reviewed plan (one entry per findings row, see detector.js).
 *   mode "column": the treatment rewrites every non-empty cell in the column.
 *   mode "text":   the treatment rewrites only the matched characters of its kind; the rest
 *                  of each sentence, line, or cell is left exactly as it was.
 * options: { salt, seed, hasher, fakes, extra } — `hasher` (from makeHasher) and `fakes` (a Map)
 * let a batch share one key and one set of fakes; `extra` must be the custom rules detection ran with.
 * Returns { headers, rows, stats, edits, hashKey }. `edits` (documents only) lists, per row,
 * the replaced character ranges, so the Word writer can keep the formatting around them.
 */
export async function applyTransformations(parsed, columnPlan, options = {}) {
  const { headers, rows } = parsed;
  const hash = options.hasher || await makeHasher(options.salt || "");
  const extra = options.extra || [];
  const scanOptions = documentScanOptions(parsed, extra);
  const fakes = options.fakes || new Map();
  // A later file of a batch must not replay the first file's draws (every one of them would
  // clash), so its stream also depends on how many fakes the batch has handed out so far.
  const rng = makeRng(hashSeed((options.seed || newSyntheticSeed()) + (fakes.size ? `\u0000${fakes.size}` : "")));
  // Fakes an earlier file of the batch handed out count as taken.
  const used = new Map();
  for (const [k, fake] of fakes) {
    const id = k.slice(0, k.indexOf("\u0000"));
    if (!used.has(id)) used.set(id, new Set());
    used.get(id).add(fake);
  }
  const ctx = { hash, rng, fakes, used, reused: new Set() };

  const outRows = rows.map((r) => [...r]);
  const stats = columnPlan.map((c) => ({
    key: c.key, index: c.index, header: c.header, mode: c.mode || "column",
    detectorId: c.detectorId || null, transform: c.transform, sampled: 0, changed: 0,
  }));
  const isDocument = parsed.kind === "text" || parsed.kind === "docx-structured";
  const edits = isDocument ? rows.map(() => []) : null;

  // Whole-cell columns.
  for (let ci = 0; ci < columnPlan.length; ci++) {
    const plan = columnPlan[ci];
    if ((plan.mode || "column") !== "column" || plan.transform === "keep") continue;
    for (let ri = 0; ri < outRows.length; ri++) {
      const original = outRows[ri][plan.index];
      if (original === undefined || original === null || String(original).trim() === "") continue;
      stats[ci].sampled++;
      const next = await treat(original, plan.detectorId, plan, ctx);
      if (next !== original) stats[ci].changed++;
      outRows[ri][plan.index] = next;
    }
  }

  // Free text: rewrite the matched spans only.
  const textColumns = new Map(); // column index -> Map(detectorId -> plan row)
  columnPlan.forEach((plan, i) => {
    if (plan.mode !== "text" || !plan.detectorId) return;
    if (!textColumns.has(plan.index)) textColumns.set(plan.index, new Map());
    textColumns.get(plan.index).set(plan.detectorId, i);
  });
  for (const [col, byKind] of textColumns) {
    // A whole-column replacement already removes the original value. Do not scan
    // newly generated fakes; if the column is kept, its text findings still apply.
    if (columnPlan.some(p => (p.mode || "column") === "column" && p.index === col && ["redact", "hash", "synthetic"].includes(p.transform))) continue;
    for (let ri = 0; ri < outRows.length; ri++) {
      const cell = outRows[ri][col];
      if (cell === undefined || cell === null || cell === "") continue;
      const text = String(cell);
      const replacements = [];
      for (const span of scanText(text, scanOptions)) {
        const i = byKind.get(span.detectorId);
        if (i === undefined) continue; // detection scanned every row with the same rules
        stats[i].sampled++;
        const plan = columnPlan[i];
        if (plan.transform === "keep") continue;
        const next = String(await treat(span.value, span.detectorId, plan, ctx));
        if (next === span.value) continue;
        stats[i].changed++;
        replacements.push({ start: span.start, end: span.end, text: next });
      }
      if (!replacements.length) continue;
      let out = "";
      let last = 0;
      for (const r of replacements) { out += text.slice(last, r.start) + r.text; last = r.end; }
      outRows[ri][col] = out + text.slice(last);
      if (edits) edits[ri].push(...replacements);
    }
  }

  return { headers: [...headers], rows: outRows, stats, edits, hashKey: hash.keyMode, reused: [...ctx.reused].sort() };
}
