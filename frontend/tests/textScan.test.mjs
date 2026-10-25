import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scanText, summarizeSpans, rewriteSpans, TEXT_PATTERNS, resolveOverlaps } from "../src/redactorium/lib/textScan.js";

const kinds = (text, opts) => scanText(text, opts).map((s) => `${s.detectorId}=${s.value}`);

test("finds personal data in the middle of sentences", () => {
  const text = "Contact Ada at ada.lovelace@corp.co.uk or +44 7700 900123 before Friday.";
  assert.deepEqual(kinds(text), ["email=ada.lovelace@corp.co.uk", "phone=+44 7700 900123"]);
});

test("spans point at the exact characters", () => {
  const text = "SSN 123-45-6789, card 4111 1111 1111 1111.";
  for (const s of scanText(text)) assert.equal(text.slice(s.start, s.end), s.value);
});

test("checksums gate card, IBAN and NHS numbers", () => {
  assert.deepEqual(kinds("card 4111 1111 1111 1111"), ["credit_card=4111 1111 1111 1111"]);
  assert.deepEqual(kinds("order 4111 1111 1111 1112"), []);
  assert.deepEqual(kinds("IBAN GB82 WEST 1234 5698 7654 32"), ["iban=GB82 WEST 1234 5698 7654 32"]);
  assert.deepEqual(kinds("IBAN GB82 WEST 1234 5698 7654 33"), []);
  assert.deepEqual(kinds("NHS no 943 476 5919"), ["nhs=943 476 5919"]);
});

test("SSN rules: dashed shape anywhere, bare digits only after a label, never-issued areas rejected", () => {
  assert.deepEqual(kinds("ref 123-45-6789 ok"), ["ssn=123-45-6789"]);
  assert.deepEqual(kinds("SSN: 123456789"), ["ssn=123456789"]);
  assert.deepEqual(kinds("invoice 123456789"), []);
  assert.deepEqual(kinds("000-12-3456 and 666-12-3456 and 912-12-3456"), []);
  assert.deepEqual(kinds("part 123-45-6789-01"), []);
});

test("phones: international and North American shapes, not dates or times", () => {
  assert.deepEqual(kinds("call (415) 555-0134"), ["phone=(415) 555-0134"]);
  assert.deepEqual(kinds("call 415.555.0134"), ["phone=415.555.0134"]);
  assert.deepEqual(kinds("call +1 212 555 0100"), ["phone=+1 212 555 0100"]);
  assert.deepEqual(kinds("on 2024-01-15 at 10:30:45+0000"), []);
});

test("network identifiers", () => {
  assert.deepEqual(kinds("from 203.0.113.7 via fe80::1ff:fe23:4567:890a"), ["ipv4=203.0.113.7", "ipv6=fe80::1ff:fe23:4567:890a"]);
  assert.deepEqual(kinds("NIC 00:1A:2B:3C:4D:5E"), ["mac=00:1A:2B:3C:4D:5E"]);
  assert.deepEqual(kinds("at 10:30:45 today"), []);
});

test("context-gated kinds need their label", () => {
  assert.deepEqual(kinds("Born 12 March 1985 in York"), ["dob=12 March 1985"]);
  assert.deepEqual(kinds("Released 12 March 1985"), []);
  assert.deepEqual(kinds("DOB: 1985-03-12"), ["dob=1985-03-12"]);
  assert.deepEqual(kinds("Passport: X1234567"), ["passport=X1234567"]);
  assert.deepEqual(kinds("Model X1234567"), []);
  assert.deepEqual(kinds("Springfield, IL 62704"), ["place_us=Springfield, IL", "postal_us=62704"]);
  assert.deepEqual(kinds("Batch 62704 shipped"), []);
});

test("names only when labeled", () => {
  assert.deepEqual(kinds("Name: Ada Lovelace, joined 2019"), ["person_name=Ada Lovelace"]);
  assert.deepEqual(kinds("patient=Grace Hopper;"), ["person_name=Grace Hopper"]);
  assert.deepEqual(kinds("Dear Alan Turing, thanks"), ["person_name=Alan Turing"]);
  assert.deepEqual(kinds("Grace Hopper wrote the compiler"), []);
  assert.deepEqual(kinds("user_name=jsmith status=ok"), ["person_name=jsmith"]);
  assert.deepEqual(kinds("Dear team, hello"), []);
  assert.deepEqual(kinds("name: the account"), []);
});

test("ordinary prose stays clean", () => {
  const prose = "As soon as possible, the Head of Legal will review the policy with the Company Group and the Data Protection Officer.";
  assert.deepEqual(kinds(prose), []);
});

test("overlaps resolve to the stronger claim", () => {
  // Ten digits after an NHS label are an NHS number, not a phone number.
  assert.deepEqual(kinds("NHS 943 476 5919"), ["nhs=943 476 5919"]);
});

test("custom rules search inside text", () => {
  const extra = [{ id: "custom:emp", find: /EMP-\d{6}/g, base: 0.85 }];
  assert.deepEqual(kinds("ticket from EMP-004211 about EMP-000007", { extra }), ["custom:emp=EMP-004211", "custom:emp=EMP-000007"]);
});

test("summarizeSpans counts matches per kind across texts", () => {
  const s = summarizeSpans(["a@example.org and b@example.org", "call (415) 555-0134", "c@example.org"]);
  const email = s.find((k) => k.detectorId === "email");
  assert.equal(email.matches, 3);
  assert.equal(email.texts, 2);
  assert.deepEqual(email.examples, ["a@example.org", "b@example.org", "c@example.org"]);
  assert.equal(s.find((k) => k.detectorId === "phone").matches, 1);
});

test("rewriteSpans replaces only treated spans and keeps the rest of the sentence", () => {
  const text = "Mail ada@example.org, call (415) 555-0134.";
  const spans = scanText(text);
  const out = rewriteSpans(text, spans, (sp) => (sp.detectorId === "email" ? "[REDACTED]" : null));
  assert.equal(out.text, "Mail [REDACTED], call (415) 555-0134.");
  assert.equal(out.changed, 1);
});

test("no pattern uses lookbehind (Safari before 16.4 cannot compile it)", () => {
  for (const p of TEXT_PATTERNS) assert.ok(!/\(\?<[=!]/.test(p.re.source), `${p.id} uses lookbehind`);
  const src = readFileSync(new URL("../src/redactorium/lib/textScan.js", import.meta.url), "utf8");
  assert.ok(!/\(\?<[=!]/.test(src), "textScan.js contains a lookbehind");
});

test("large text scans in reasonable time", () => {
  const line = "2026-09-24T10:00:00Z INFO user ada@example.org from 203.0.113.7 opened ticket 88231 and closed it again\n";
  const big = line.repeat(20000); // ~2 MB
  const t0 = Date.now();
  const spans = scanText(big);
  const ms = Date.now() - t0;
  assert.equal(spans.length, 40000);
  assert.ok(ms < 5000, `scan took ${ms}ms`);
});

// The reference rule, one candidate at a time against everything kept so far. resolveOverlaps
// must give the same answer while staying linear over a whole log.
function resolveOneByOne(found) {
  const sorted = found.slice().sort((a, b) => b.score - a.score || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const kept = [];
  for (const f of sorted) {
    if (kept.some((k) => f.start < k.end && k.start < f.end)) continue;
    kept.push(f);
  }
  return kept.sort((a, b) => a.start - b.start);
}

test("resolveOverlaps matches the one-by-one rule on random overlapping spans", () => {
  let seed = 20260928;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const scores = [0.5, 0.7, 0.85, 0.95];
  for (let trial = 0; trial < 300; trial++) {
    const found = [];
    const count = 1 + rand(60);
    for (let i = 0; i < count; i++) {
      const start = rand(200);
      const end = start + rand(12); // zero-length spans included on purpose
      found.push({ start, end, detectorId: `d${rand(5)}`, value: "", score: scores[rand(4)] });
    }
    assert.deepEqual(resolveOverlaps(found), resolveOneByOne(found), `trial ${trial}`);
  }
  assert.deepEqual(resolveOverlaps([]), []);
});

test("a card or IBAN that starts inside a rejected candidate is still found", () => {
  const byKind = (text) => Object.fromEntries(scanText(text).map((s) => [s.detectorId, s.value]));
  const card = byKind("Phone 415 555 0134 4111 1111 1111 1111 exp 12/26");
  assert.equal(card.phone, "415 555 0134");
  assert.equal(card.credit_card, "4111 1111 1111 1111", "the card after a rejected 0134 4111... candidate");
  const iban = byKind("Ref AB12 3456 7890 IBAN GB82 WEST 1234 5698 7654 32");
  assert.equal(iban.iban, "GB82 WEST 1234 5698 7654 32", "the IBAN after a rejected AB12... candidate");
});

test("an international phone ends where the phone ends, not at the date, time or ordinal after it", () => {
  const phones = (text) => scanText(text).filter((s) => s.detectorId === "phone").map((s) => s.value);
  assert.deepEqual(phones("Tel +44 7700 900123 2026-09-28 follow-up"), ["+44 7700 900123"]);
  assert.deepEqual(phones("Tel +44 7700 900123 1st floor"), ["+44 7700 900123"]);
  assert.deepEqual(phones("Call +1 415 555 0134 2024-01-15 10:30"), ["+1 415 555 0134"]);
  assert.deepEqual(phones("Meet at +1 415 555 0134 10:30 sharp"), ["+1 415 555 0134"]);
  assert.deepEqual(phones("Paris +33 1 23 45 67 89, Berlin +49-30-1234-5678."), ["+33 1 23 45 67 89", "+49-30-1234-5678"]);
  assert.deepEqual(phones("UK 28.09.2026 +44 20 7946 0958 28.09.2026"), ["+44 20 7946 0958"]);
});
