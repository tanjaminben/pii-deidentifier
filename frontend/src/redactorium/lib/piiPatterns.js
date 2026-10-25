/**
 * PII detectors — pure regex / pattern matching. No AI, no models.
 * Each detector supplies a name, a category, a regex (or predicate),
 * a confidence baseline, an optional Luhn/checksum boost, and citations.
 *
 * Confidence is scored per value; column confidence is the % of non-empty
 * cells that match, blended with per-value confidence. Higher-specificity
 * patterns (checksum-validated) start at 0.9+; heuristics stay <=0.7.
 */

import { isUSPlace } from "./places.js";

// ---------- helpers ----------
export const luhnCheck = (num) => {
  const digits = String(num).replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return sum % 10 === 0;
};

export const ibanValid = (iban) => {
  const s = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const rearr = s.slice(4) + s.slice(0, 4);
  let expanded = "";
  for (const ch of rearr) expanded += (ch >= "A" && ch <= "Z") ? (ch.charCodeAt(0) - 55) : ch;
  // mod-97 on big string
  let rem = 0;
  for (let i = 0; i < expanded.length; i += 7) {
    rem = parseInt(String(rem) + expanded.slice(i, i + 7), 10) % 97;
  }
  return rem === 1;
};

// The Verhoeff check digit (dihedral group D5), which every Aadhaar number carries (UIDAI).
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
export const verhoeffValid = (digits) => {
  let c = 0;
  const reversed = String(digits).split("").reverse();
  for (let i = 0; i < reversed.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[i % 8][+reversed[i]]];
  return c === 0;
};
// Twelve digits, optionally in groups of four; never starting with 0 or 1; Verhoeff-valid.
export const aadhaarValid = (v) => {
  const s = String(v).trim();
  if (!/^\d{4} ?\d{4} ?\d{4}$/.test(s)) return false;
  const d = s.replace(/ /g, "");
  return /^[2-9]/.test(d) && verhoeffValid(d);
};

export const ssnValid = (v) => {
  // format shape only; catches obviously invalid area/group/serial
  const m = v.match(/^(\d{3})-?(\d{2})-?(\d{4})$/);
  if (!m) return false;
  const [ , a, g, s ] = m;
  if (a === "000" || a === "666" || a[0] === "9") return false;
  if (g === "00") return false;
  if (s === "0000") return false;
  return true;
};

// Full and compressed IPv6 (2001:db8::1, fe80::1ff:fe23:4567:890a, ::1), without lookbehind.
const IPV6_RE = /^(?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,7}:|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,5}(?::[0-9A-Fa-f]{1,4}){1,2}|(?:[0-9A-Fa-f]{1,4}:){1,4}(?::[0-9A-Fa-f]{1,4}){1,3}|(?:[0-9A-Fa-f]{1,4}:){1,3}(?::[0-9A-Fa-f]{1,4}){1,4}|(?:[0-9A-Fa-f]{1,4}:){1,2}(?::[0-9A-Fa-f]{1,4}){1,5}|[0-9A-Fa-f]{1,4}:(?::[0-9A-Fa-f]{1,4}){1,6}|:(?::[0-9A-Fa-f]{1,4}){1,7}|::)(?:%[0-9A-Za-z]+)?$/;
export const isIPv6 = (v) => IPV6_RE.test(String(v)) && String(v).includes(":");

// The year of a date written as 1985-12-10, 12/10/1985, 10.12.1985, "December 10, 1985" or
// "10 December 1985"; null when the text is not one of those shapes.
const MONTH_NAMES = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_SHAPES = [
  /^(\d{4})[-/.]\d{1,2}[-/.]\d{1,2}$/,
  /^\d{1,2}[-/.]\d{1,2}[-/.](\d{4})$/,
  new RegExp(`^${MONTH_NAMES}\\.? \\d{1,2}(?:st|nd|rd|th)?,? (\\d{4})$`, "i"),
  new RegExp(`^\\d{1,2}(?:st|nd|rd|th)? ${MONTH_NAMES}\\.?,? (\\d{4})$`, "i"),
  new RegExp(`^\\d{1,2}-${MONTH_NAMES}-(\\d{4})$`, "i"),
];
export const dateYear = (v) => {
  for (const re of DATE_SHAPES) {
    const m = String(v).trim().match(re);
    if (m) return +m[1];
  }
  return null;
};

export const nhsValid = (v) => {
  const s = String(v).replace(/\s|-/g, "");
  if (!/^\d{10}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(s[i], 10) * (10 - i);
  let check = 11 - (sum % 11);
  if (check === 11) check = 0;
  if (check === 10) return false;
  return check === parseInt(s[9], 10);
};

// ---------- detectors ----------
// tier: "checksum" | "reserved" | "format" | "heuristic"
// Confidence at value-level assigned by detector; column-level aggregated later.
// Keep original Unicode/format characters in the match so redaction offsets remain exact.
export const EMAIL_SOURCE = String.raw`[\p{L}\p{N}\p{Cf}][\p{L}\p{M}\p{N}\p{Cf}._%+\-]{0,63}@[\p{L}\p{N}\p{Cf}](?:[\p{L}\p{M}\p{N}\p{Cf}\-]{0,61}[\p{L}\p{N}\p{Cf}])?(?:\.[\p{L}\p{N}\p{Cf}](?:[\p{L}\p{M}\p{N}\p{Cf}\-]{0,61}[\p{L}\p{N}\p{Cf}])?)*\.[\p{L}\p{M}\p{Cf}]{2,24}`;
const wholeEmail = new RegExp(`^${EMAIL_SOURCE}$`, 'u');
export const DETECTORS = [
  {
    id: "email",
    name: "Email address",
    category: "contact",
    tier: "format",
    base: 0.95,
    citation: "Shaped like an email address (RFC 5322)",
    test: (v) => {
      const m = wholeEmail.test(String(v));
      return m ? 0.97 : 0;
    },
    columnHint: /(mail|e[-_]?mail)/i,
  },
  {
    id: "phone",
    name: "Phone number",
    category: "contact",
    tier: "format",
    base: 0.75,
    citation: "Shaped like a phone number (E.164, North American); digits alone count only under a phone-like header",
    test: (v) => {
      const s = String(v).trim();
      // A date or a timestamp is not a phone number, however many digits it has.
      if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[T ].*)?$|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(s)) return 0;
      // strong: +NN...  or  (XXX) XXX-XXXX or XXX-XXX-XXXX
      if (/^\+?\(?\d[\d\s().\-]{6,17}\d$/.test(s) && s.replace(/\D/g, "").length >= 8) {
        return /^\+/.test(s) || /^\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}$/.test(s) ? 0.9 : 0.72;
      }
      return 0;
    },
    columnHint: /(phone|mobile|\btel\b|\bt[ée]l\b|telefon|telephone|\bcell\b|handy|msisdn|whatsapp|\bmob\b|\bph\b|contact[\s_-]*number)/i,
    // Digits with no +, spaces, dashes or brackets look the same as IDs and order numbers.
    hintOnly: (v) => /^\d+$/.test(String(v).trim()),
  },
  {
    id: "ssn",
    name: "US Social Security number",
    category: "government-id",
    tier: "format",
    base: 0.98,
    citation: "Shaped like an SSN, never-issued numbers excluded (SSA rules)",
    test: (v) => ssnValid(String(v).trim().replace(/ /g, "-")) ? 0.98 : 0,
    columnHint: /((^|[^a-z])ssn([^a-z]|$)|social[-_ ]?security)/i,
    // A bare nine-digit passport/order number is not an SSN without context.
    hintOnly: (v) => /^\d{9}$/.test(String(v).trim()),
  },
  {
    id: "credit_card",
    name: "Payment card number",
    category: "financial",
    tier: "checksum",
    base: 0.97,
    citation: "Passes the card check digit (ISO/IEC 7812, Luhn)",
    test: (v) => {
      const s = String(v).replace(/[\s.-]/g, "");
      if (!/^\d{12,19}$/.test(s)) return 0;
      return luhnCheck(s) ? 0.97 : 0.3;
    },
    columnHint: /(^|[^a-z])(card|pan|credit|payment)([^a-z]|$)/i,
    // A long number that fails the check digit is a card only in a card column (a mistyped
    // card); anywhere else it is an order, account or customer number.
    hintOnly: (v) => !luhnCheck(String(v).replace(/[\s.-]/g, "")),
  },
  {
    id: "iban",
    name: "Bank account number (IBAN)",
    category: "financial",
    tier: "checksum",
    base: 0.98,
    citation: "Passes the account check digits (ISO 13616)",
    test: (v) => {
      const s = String(v).replace(/\s+/g, "").toUpperCase();
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return 0;
      return ibanValid(s) ? 0.98 : 0.4;
    },
    columnHint: /(iban|bank)/i,
  },
  {
    id: "ipv4",
    name: "IP address",
    category: "network",
    tier: "format",
    base: 0.92,
    citation: "Four numbers joined by dots (RFC 791)",
    test: (v) => {
      // An optional port (10.0.0.4:8080) still makes it an address.
      const m = String(v).trim().match(/^(25[0-5]|2[0-4]\d|[01]?\d?\d)(\.(25[0-5]|2[0-4]\d|[01]?\d?\d)){3}(:\d{1,5})?$/);
      return m ? 0.94 : 0;
    },
    // "ip", "ip_address", "client ip" — but not a street or email "address" column.
    columnHint: /((^|[^a-z])ip([^a-z]|$)|ipv4|ip[_ -]?addr)/i,
  },
  {
    id: "ipv6",
    name: "IP address (v6)",
    category: "network",
    tier: "format",
    base: 0.9,
    citation: "Groups of hex digits joined by colons (RFC 4291)",
    test: (v) => (isIPv6(String(v).trim()) ? 0.9 : 0),
    columnHint: /(ipv6|(^|[^a-z])ip([^a-z]|$))/i,
  },
  {
    id: "dob",
    name: "Date of birth",
    category: "demographic",
    tier: "format",
    base: 0.7,
    citation: "Shaped like a date, so check it (ISO 8601 and common forms)",
    test: (v) => {
      const s = String(v).trim();
      const year = dateYear(s);
      if (!year || year < 1900 || year > new Date().getFullYear()) return 0;
      return 0.65; // heuristic — could be any date
    },
    columnHint: /(^|[^a-z])(dob|birth|born|birthday)([^a-z]|$)/i,
    columnHintBoost: 0.25,
  },
  {
    id: "passport",
    name: "Passport number",
    category: "government-id",
    tier: "format",
    base: 0.6,
    citation: "Six to nine letters and digits in a passport column (ICAO 9303)",
    test: (v) => {
      const s = String(v).trim().toUpperCase();
      return /^\d{9}$/.test(s) || (/^[A-Z0-9]{6,9}$/.test(s) && /[A-Z]/.test(s) && /\d/.test(s)) ? 0.6 : 0;
    },
    columnHint: /(passport)/i,
    columnHintBoost: 0.3,
    // Customer, order and ticket IDs have the same shape, so the column name has to say passport.
    needsHint: true,
  },
  {
    id: "us_dl",
    name: "US driver's license",
    category: "government-id",
    tier: "format",
    base: 0.55,
    citation: "A letter or two, then digits, in a license column (state formats)",
    test: (v) => {
      const s = String(v).trim().toUpperCase();
      return /^[A-Z]\d{5,8}$|^[A-Z]{1,2}\d{5,7}$/.test(s) ? 0.55 : 0;
    },
    columnHint: /(licen[cs]e|dl[_ -]?number|driver)/i,
    columnHintBoost: 0.3,
    needsHint: true,
  },
  {
    id: "postal_us",
    name: "US ZIP code",
    category: "address",
    tier: "format",
    base: 0.75,
    citation: "Five digits after a state or a ZIP label (USPS)",
    test: (v) => /^\d{5}(-\d{4})?$/.test(String(v).trim()) ? 0.8 : 0,
    columnHint: /(zip|postal)/i,
    needsHint: true,
  },
  {
    id: "postal_uk",
    name: "UK postcode",
    category: "address",
    tier: "format",
    base: 0.85,
    citation: "Shaped like a UK postcode (Royal Mail)",
    test: (v) => /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(String(v).trim()) ? 0.9 : 0,
    columnHint: /(post\s*code|postcode)/i,
  },
  {
    id: "address_street",
    name: "Street address",
    category: "address",
    tier: "heuristic",
    base: 0.55,
    citation: "A number, then a street word like Street or Road",
    test: (v) => {
      const s = String(v).trim();
      return /^\d{1,6}\s+\w+.*\b(street|st|road|rd|ave|avenue|blvd|boulevard|lane|ln|drive|dr|court|ct|way|place|pl)\b/i.test(s) ? 0.6 : 0;
    },
    columnHint: /(address|street|addr)/i,
    columnHintBoost: 0.3,
  },
  {
    id: "person_name",
    name: "Person name",
    category: "demographic",
    tier: "heuristic",
    base: 0.4,
    citation: "A name-like column, labeled name, short opening line or exact repeat. Check it.",
    test: (v) => {
      const s = String(v).trim();
      // Any script's letters (José Núñez, Zoë O'Brien-Smith, McKenzie), and "Last, First".
      const word = "\\p{Lu}[\\p{L}\\p{M}'’.-]*";
      if (!new RegExp(`^${word}(?:,? ${word}){1,3}$`, "u").test(s)) return 0;
      return 0.55;
    },
    columnHint: /((^|[^a-z])(full[_ ]?|first[_ ]?|last[_ ]?|customer[_ ]?|patient[_ ]?|employee[_ ]?|contact[_ ]?|client[_ ]?|given[_ ]?|family[_ ]?)?name([^a-z]|$)|surname|given|(^|[^a-z])(attendee|member|owner|assignee)([^a-z]|$))/i,
    columnHintBoost: 0.35,
  },
  {
    id: "place_us",
    name: "Place",
    category: "address",
    tier: "heuristic",
    base: 0.65,
    citation: "A capitalized city followed by a US state name or abbreviation. Check it.",
    test: (v) => isUSPlace(v) ? 0.7 : 0,
    columnHint: /(^|[^a-z])(city|place|location|city[_ -]?state)([^a-z]|$)/i,
  },
  {
    id: "company",
    name: "Company name",
    category: "professional",
    tier: "heuristic",
    base: 0.45,
    citation: "Ends in Inc, Ltd, LLC, GmbH or a similar word",
    test: (v) => {
      const s = String(v).trim();
      return /\b(Inc\.?|LLC|Ltd\.?|GmbH|AS|AB|SA|SAS|BV|PLC|Co\.?|Corp\.?|Company|Group|Holdings)\b/i.test(s) ? 0.65 : 0;
    },
    columnHint: /(company|employer|organi[sz]ation|firm)/i,
    columnHintBoost: 0.3,
  },
  {
    id: "job_title",
    name: "Job title",
    category: "professional",
    tier: "heuristic",
    base: 0.4,
    citation: "Contains a job word like Manager or Engineer",
    test: (v) => {
      const s = String(v).trim();
      return /\b(Manager|Director|Engineer|Developer|Analyst|Consultant|Officer|President|Executive|Assistant|Coordinator|Specialist|Architect|Designer|Lead|Head|VP|CEO|CTO|CFO|COO|Partner|Attorney|Nurse|Doctor|Advokat|Legal|Counsel)\b/i.test(s) ? 0.55 : 0;
    },
    columnHint: /(title|role|position|job)/i,
    columnHintBoost: 0.3,
  },
  {
    id: "nhs",
    name: "UK NHS number",
    category: "government-id",
    tier: "checksum",
    base: 0.95,
    citation: "Passes the NHS check digit",
    test: (v) => {
      const s = String(v).replace(/\s|-/g, "");
      if (!/^\d{10}$/.test(s)) return 0;
      let sum = 0;
      for (let i = 0; i < 9; i++) sum += parseInt(s[i], 10) * (10 - i);
      let check = 11 - (sum % 11);
      if (check === 11) check = 0;
      if (check === 10) return 0;
      // Ten digits that fail the check digit are an order, invoice or account number, not a
      // mistyped NHS number: scoring them at all put a code on ID columns by default.
      return check === parseInt(s[9], 10) ? 0.96 : 0;
    },
    columnHint: /(nhs)/i,
  },
  {
    id: "aadhaar",
    name: "Aadhaar number (India)",
    category: "government-id",
    tier: "checksum",
    base: 0.85,
    citation: "Twelve digits with a Verhoeff check digit, in an Aadhaar column (UIDAI)",
    test: (v) => (aadhaarValid(v) ? 0.8 : 0),
    columnHint: /(^|[^a-z])(aadhaar|aadhar|uid)([^a-z]|$)/i,
    columnHintBoost: 0.15,
    // Order numbers, barcodes and phone numbers with a country code are twelve digits too.
    needsHint: true,
  },
  {
    id: "url",
    name: "Web address",
    category: "network",
    tier: "format",
    base: 0.9,
    citation: "Starts with http:// or https:// (RFC 3986)",
    test: (v) => /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(String(v).trim()) ? 0.92 : 0,
    columnHint: /(^|[^a-z])(url|website|link)([^a-z]|$)/i,
  },
  {
    id: "mac",
    name: "Network card (MAC) address",
    category: "network",
    tier: "format",
    base: 0.95,
    citation: "Six pairs of hex digits (IEEE 802)",
    test: (v) => /^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/i.test(String(v).trim()) ? 0.97 : 0,
    columnHint: /(^|[^a-z])mac([^a-z]|$)/i,
  },
];

export const CATEGORY_COLORS = {
  contact: "pill-forest",
  "government-id": "pill-brick",
  financial: "pill-brick",
  network: "pill-plum",
  demographic: "pill-ochre",
  address: "pill-ochre",
  professional: "pill-plum",
};

export const TIER_LABEL = {
  checksum: "checksum-verified",
  reserved: "reserved-namespace",
  format: "format-matched",
  heuristic: "heuristic",
};
