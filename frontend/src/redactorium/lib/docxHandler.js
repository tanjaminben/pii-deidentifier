/**
 * DOCX round-trip.
 *
 * A Word file is a zip of XML parts. Text lives in <w:t> runs (and field codes in
 * <w:instrText>, e.g. a mailto: link) inside paragraphs, and not only in word/document.xml:
 * headers, footers, footnotes and endnotes carry text too, a hyperlink keeps its address in a
 * relationships file, and the title and subject sit in the document properties. Each piece of
 * text becomes one "segment", the row the scanner and the treatments see: a stretch of runs
 * between paragraph boundaries, one hyperlink address, or one property.
 *
 * Writing back, only the replaced characters change: each replacement goes into the run
 * where the match starts, and the matched characters are cut from every run they cover.
 * Runs with no match keep their text and formatting exactly.
 *
 * Before anything is read, the package is cleaned of what a shared Word file should not carry:
 *   - tracked deletions (<w:del>, <w:moveFrom>) are removed, because deleted text is still in
 *     the file and shows up the moment someone turns on Track Changes;
 *   - tracked insertions (<w:ins>, <w:moveTo>) are accepted, and formatting-change records
 *     (which name their author) are dropped;
 *   - comments are removed, with their anchors, references and parts;
 *   - the author, last editor, company and manager fields in the document properties are
 *     emptied, and the comment/revision author list (word/people.xml) is removed.
 * What was removed is reported in `meta.cleaned` and lands in the record.
 */

import JSZip from "jszip";

// The glossary part holds building blocks (AutoText, a saved signature block) in the same
// WordprocessingML as the body, so it is read and treated the same way.
const TEXT_PARTS = /^word\/(document|glossary\/document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
const RELS_PARTS = /^word\/(?:glossary\/)?_rels\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml\.rels$/;
const CORE_TEXT_TAGS = ["dc:title", "dc:subject", "dc:description", "cp:keywords"];
// A token is a paragraph boundary, a tab or line break (kept as a separator the scanner can
// see), or a text element whose content we read and may rewrite.
// (An empty <w:t/> is self-closing and carries no text; the open-tag pattern refuses it so the
// match cannot run on to the next </w:t>.)
const TOKEN_RE = /<w:p\b[^>]*\/>|<w:p\b[^>]*>|<\/w:p>|<w:(?:tab|br|cr)\b[^>]*\/>|(<w:(t|instrText)(?:\s[^>]*[^/])?>)([\s\S]*?)<\/w:\2>/g;

function decodeXml(s) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}
const encodeText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const encodeAttr = (s, quote = '"') => encodeText(s).replace(quote === "'" ? /'/g : /"/g, quote === "'" ? "&apos;" : "&quot;");


// OPC relationships are empty XML elements, either paired or self-closing.
// Parse only those elements and their quoted attributes; preserve source offsets
// so cleanup and hyperlink treatment never rewrite unrelated XML.
const wordOpenError = () => new Error("This file could not be opened as a Word document (.docx)");
function relationshipElements(xml) {
  if (/<!DOCTYPE\b/i.test(xml)) throw wordOpenError();
  const visible = xml.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, value => " ".repeat(value.length));
  const elements = [];
  const element = /<((?:[^\s/<>:="']+:)?Relationship)(?=[\s/>])((?:[^<>"']|"[^"]*"|'[^']*')*)(\/>|>\s*<\/\1\s*>)/g;
  let match;
  while ((match = element.exec(visible)) !== null) {
    const attrs = {};
    const raw = match[2];
    const attribute = /\s+([^\s=/<>"']+)\s*=\s*(["'])([\s\S]*?)\2/y;
    let cursor = 0;
    while (cursor < raw.length) {
      let next = cursor;
      while (next < raw.length && /\s/.test(raw[next])) next++;
      if (next === raw.length) break;
      attribute.lastIndex = cursor;
      const attr = attribute.exec(raw);
      if (!attr || attr.index !== cursor || Object.hasOwn(attrs, attr[1])) throw wordOpenError();
      const start = match.index + 1 + match[1].length + attr.index + attr[0].indexOf(attr[2]) + 1;
      attrs[attr[1]] = { value: decodeXml(attr[3]), start, end: start + attr[3].length, quote: attr[2] };
      cursor = attribute.lastIndex;
    }
    elements.push({ start: match.index, end: element.lastIndex, attrs });
  }
  // An unsupported or malformed recognized element cannot be silently skipped
  // while claiming its source metadata was removed or its hyperlink was scanned.
  const marker = /<\/?(?:[^\s/<>:="']+:)?Relationship(?=[\s/>])/g;
  let index = 0;
  while ((match = marker.exec(visible)) !== null) {
    while (elements[index] && elements[index].end <= match.index) index++;
    if (!elements[index] || elements[index].start > match.index) throw wordOpenError();
  }
  return elements;
}

// ---------- cleaning ----------
const count = (xml, re) => (xml.match(re) || []).length;
const REVISION_TAGS = "rPrChange|pPrChange|sectPrChange|tblPrChange|tblGridChange|tcPrChange|trPrChange|numberingChange|cellIns|cellDel|cellMerge";

export function cleanPartXml(xml, cleaned) {
  let x = xml;
  cleaned.trackedDeletions += count(x, /<w:del\b[^>]*>/g) + count(x, /<w:moveFrom\b[^>]*>/g);
  x = x.replace(/<w:del\b[^>]*\/>/g, "").replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, "");
  x = x.replace(/<w:moveFrom\b[^>]*\/>/g, "").replace(/<w:moveFrom\b[^>]*>[\s\S]*?<\/w:moveFrom>/g, "");
  x = x.replace(/<w:move(?:From|To)Range(?:Start|End)\b[^>]*\/>/g, "");
  cleaned.trackedInsertions += count(x, /<w:ins\b[^>]*>/g) + count(x, /<w:moveTo\b[^>]*>/g);
  x = x.replace(/<w:ins\b[^>]*\/>/g, "").replace(/<w:ins\b[^>]*>/g, "").replace(/<\/w:ins>/g, "");
  x = x.replace(/<w:moveTo\b[^>]*\/>/g, "").replace(/<w:moveTo\b[^>]*>/g, "").replace(/<\/w:moveTo>/g, "");
  // Formatting revisions carry w:author; the current formatting stays.
  x = x.replace(new RegExp(`<w:(${REVISION_TAGS})\\b[^>]*\\/>`, "g"), "")
       .replace(new RegExp(`<w:(${REVISION_TAGS})\\b[^>]*>[\\s\\S]*?<\\/w:\\1>`, "g"), "");
  // Comment anchors and the runs that hold comment references.
  x = x.replace(/<w:commentRange(?:Start|End)\b[^>]*\/>/g, "");
  x = x.replace(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:commentReference\b[^>]*\/>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g, "");
  x = x.replace(/<w:commentReference\b[^>]*\/>/g, "");
  return x;
}

async function cleanPackage(zip) {
  const cleaned = { trackedDeletions: 0, trackedInsertions: 0, comments: 0, propertiesCleared: [] };
  const commentsXml = zip.file("word/comments.xml") ? await zip.file("word/comments.xml").async("string") : "";
  cleaned.comments = count(commentsXml, /<w:comment\b/g);
  for (const p of Object.keys(zip.files).filter((p) => /^word\/comments[A-Za-z]*\.xml$/.test(p) || p === "word/people.xml")) zip.remove(p);
  for (const relsPath of Object.keys(zip.files).filter((p) => /^word\/_rels\/.*\.rels$/.test(p))) {
    const rels = await zip.file(relsPath).async("string");
    zip.file(relsPath, rels.replace(/<Relationship\b[^>]*Target="(?:comments[A-Za-z]*|people)\.xml"[^>]*\/>/g, ""));
  }
  if (zip.file("[Content_Types].xml")) {
    const ct = await zip.file("[Content_Types].xml").async("string");
    zip.file("[Content_Types].xml", ct.replace(/<Override\b[^>]*PartName="\/word\/(?:comments[A-Za-z]*|people)\.xml"[^>]*\/>/g, ""));
  }
  // Data parts a reader never sees: content-control data (customXml/), custom document
  // properties (docProps/custom.xml) and document variables (<w:docVars> in settings.xml).
  const customXml = Object.keys(zip.files).filter((p) => /^customXml\//.test(p) && !zip.files[p].dir);
  cleaned.dataPartsRemoved = customXml.filter((p) => /^customXml\/item\d+\.xml$/.test(p)).length;
  for (const p of customXml) zip.remove(p);
  if (zip.file("docProps/custom.xml")) {
    const custom = await zip.file("docProps/custom.xml").async("string");
    if (/<property\b/.test(custom)) cleaned.propertiesCleared.push("custom properties");
    zip.remove("docProps/custom.xml");
  }
  for (const relsPath of ["_rels/.rels", ...Object.keys(zip.files).filter((p) => /^word\/_rels\/.*\.rels$/.test(p))]) {
    const f = zip.file(relsPath);
    if (!f) continue;
    const rels = await f.async("string");
    zip.file(relsPath, rels.replace(/<Relationship\b[^>]*Target="(?:\.\.\/customXml\/[^"]*|\/?docProps\/custom\.xml)"[^>]*\/>/g, ""));
  }
  if (zip.file("[Content_Types].xml")) {
    const ct = await zip.file("[Content_Types].xml").async("string");
    zip.file("[Content_Types].xml", ct.replace(/<Override\b[^>]*PartName="\/(?:customXml\/[^"]*|docProps\/custom\.xml)"[^>]*\/>/g, ""));
  }
  let mailMergeRemoved = false;
  if (zip.file("word/settings.xml")) {
    const settings = await zip.file("word/settings.xml").async("string");
    cleaned.documentVariables = count(settings, /<w:docVar\b/g);
    const next = settings.replace(/<w:docVars\b[^>]*\/>/g, "").replace(/<w:docVars\b[^>]*>[\s\S]*?<\/w:docVars>/g, "")
      .replace(/<w:mailMerge\b[^>]*\/>/g, "").replace(/<w:mailMerge\b[^>]*>[\s\S]*?<\/w:mailMerge>/g, "");
    mailMergeRemoved = /<w:mailMerge\b/.test(settings);
    if (mailMergeRemoved && /<w:mailMerge\b/.test(next)) throw wordOpenError();
    zip.file("word/settings.xml", next);
  }
  if (zip.file("word/_rels/settings.xml.rels")) {
    const rels = await zip.file("word/_rels/settings.xml.rels").async("string");
    const elements = relationshipElements(rels);
    if (mailMergeRemoved && elements.some(element => !element.attrs.Type)) throw wordOpenError();
    let next = rels;
    for (const element of elements.filter(element => /\/mailMerge(?:Header)?Source$/.test(element.attrs.Type?.value || "")).reverse()) {
      next = next.slice(0, element.start) + next.slice(element.end);
    }
    zip.file("word/_rels/settings.xml.rels", next);
  }
  if (mailMergeRemoved) cleaned.propertiesCleared.push("mail merge connection and query");
  // What Redactorium cannot read inside: pictures (a pasted screenshot), embedded files (a
  // pasted spreadsheet) and charts (their data). They stay in the file as they are, and the
  // page says so. A picture's alt text is text, and is treated with the rest.
  cleaned.unread = [];
  if (Object.keys(zip.files).some((p) => /^word\/media\//.test(p) && !zip.files[p].dir)) cleaned.unread.push("pictures");
  if (Object.keys(zip.files).some((p) => /^word\/embeddings\//.test(p) && !zip.files[p].dir)) cleaned.unread.push("embedded files");
  if (Object.keys(zip.files).some((p) => /^word\/charts\//.test(p) && !zip.files[p].dir)) cleaned.unread.push("charts");

  const blank = async (path, tags, labels) => {
    const f = zip.file(path);
    if (!f) return;
    let x = await f.async("string");
    tags.forEach((tag, i) => {
      const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`);
      const m = x.match(re);
      if (m && m[2].trim()) { cleaned.propertiesCleared.push(labels[i]); x = x.replace(re, `<${tag}$1></${tag}>`); }
    });
    zip.file(path, x);
  };
  await blank("docProps/core.xml", ["dc:creator", "cp:lastModifiedBy"], ["author", "last modified by"]);
  if (zip.file("docProps/core.xml")) {
    let core = await zip.file("docProps/core.xml").async("string");
    for (const tag of ["dcterms:created", "dcterms:modified", "cp:lastPrinted"]) {
      const re = new RegExp(`<${tag}\\b[^>]*(?:/>|>[\\s\\S]*?</${tag}>)`, "g");
      if (re.test(core)) { cleaned.propertiesCleared.push(tag.split(":")[1] + " timestamp"); core = core.replace(re, ""); }
    }
    zip.file("docProps/core.xml", core);
  }
  await blank("docProps/app.xml", ["Company", "Manager"], ["company", "manager"]);
  // The application properties list every heading in the document (TitlesOfParts).
  if (zip.file("docProps/app.xml")) {
    const app = await zip.file("docProps/app.xml").async("string");
    if (/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/.test(app)) {
      cleaned.propertiesCleared.push("headings list");
      zip.file("docProps/app.xml", app.replace(/<HeadingPairs>[\s\S]*?<\/HeadingPairs>/, "").replace(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/, ""));
    }
  }
  // The attached template is a path on the author's machine, user name included.
  if (zip.file("word/settings.xml")) {
    const settings = await zip.file("word/settings.xml").async("string");
    if (/<w:attachedTemplate\b/.test(settings)) {
      cleaned.propertiesCleared.push("attached template path");
      zip.file("word/settings.xml", settings.replace(/<w:attachedTemplate\b[^>]*\/>/g, ""));
      const relsPath = "word/_rels/settings.xml.rels";
      if (zip.file(relsPath)) {
        const rels = await zip.file(relsPath).async("string");
        zip.file(relsPath, rels.replace(/<Relationship\b[^>]*Type="[^"]*\/attachedTemplate"[^>]*\/>/g, ""));
      }
    }
  }
  // A page thumbnail is a picture of page one, saved by default by Word for Mac.
  const thumbnails = Object.keys(zip.files).filter((p) => /^docProps\/thumbnail\./i.test(p) && !zip.files[p].dir);
  if (thumbnails.length) {
    cleaned.propertiesCleared.push("page thumbnail");
    for (const p of thumbnails) zip.remove(p);
    if (zip.file("_rels/.rels")) {
      const rels = await zip.file("_rels/.rels").async("string");
      zip.file("_rels/.rels", rels.replace(/<Relationship\b[^>]*Type="[^"]*\/metadata\/thumbnail"[^>]*\/>/g, ""));
    }
    if (zip.file("[Content_Types].xml")) {
      const ct = await zip.file("[Content_Types].xml").async("string");
      zip.file("[Content_Types].xml", ct.replace(/<Override\b[^>]*PartName="\/docProps\/thumbnail\.[^"]*"[^>]*\/>/gi, ""));
    }
  }
  // SmartArt (an org chart, a process diagram) keeps its text in a drawing part this reader
  // does not open; it stays as it is, and the page says so.
  if (Object.keys(zip.files).some((p) => /^word\/diagrams\//.test(p) && !zip.files[p].dir)) cleaned.unread.push("SmartArt");
  return cleaned;
}

// ---------- segments ----------
// A run is one place text is written back: an element's content (openTag + text) or an
// attribute's value (valueStart..valueEnd).
function segmentBody(path, xml) {
  const segments = [];
  let current = null;
  const close = () => { if (current && current.runs.length) segments.push(current); current = null; };
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(xml)) !== null) {
    const tok = m[0];
    if (!m[1]) {
      if (tok.startsWith("<w:p") || tok === "</w:p>") { close(); continue; }
      // A tab or break between runs: visible to the scanner, owned by no run.
      if (current) current.text += tok.startsWith("<w:tab") ? "\t" : "\n";
      continue;
    }
    if (!current) current = { path, text: "", runs: [] };
    const text = decodeXml(m[3]);
    const start = current.text.length;
    current.text += text;
    current.runs.push({ openTagStart: m.index, closeTagStart: m.index + tok.lastIndexOf("</w:"), openTag: m[1], start, end: start + text.length });
  }
  close();
  return segments;
}

// Text that lives in attributes: image alt text and titles (<wp:docPr descr="..."> and
// <pic:cNvPr>), a hyperlink's hover text (<w:hyperlink w:tooltip="...">) and a simple field's
// instruction (<w:fldSimple w:instr=" HYPERLINK &quot;mailto:...&quot; ">).
function segmentAltText(path, xml) {
  const segments = [];
  const re = /<(?:wp:docPr|pic:cNvPr|w:hyperlink|w:fldSimple|v:shape|v:imagedata)\b[^>]*>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[0];
    const attr = /\b(descr|alt|title|o:title|w:tooltip|w:instr)="([^"]*)"/g;
    let a;
    while ((a = attr.exec(tag)) !== null) {
      if (!a[2].trim()) continue;
      const valueStart = m.index + a.index + a[0].indexOf('"') + 1;
      const text = decodeXml(a[2]);
      segments.push({ path, text, runs: [{ attr: true, valueStart, valueEnd: valueStart + a[2].length, start: 0, end: text.length }] });
    }
  }
  return segments;
}

// Decoded character positions point back to the original URI bytes. That lets
// the scanner see %40 without rewriting unrelated %26/%2F query delimiters.
function decodeUriPositions(raw) {
  let text = "";
  const offsets = [0];
  for (let i = 0; i < raw.length;) {
    const start = i;
    let value = raw[i];
    if (/^%[0-9a-f]{2}/i.test(raw.slice(i))) {
      const first = parseInt(raw.slice(i + 1, i + 3), 16);
      const count = first < 128 ? 1 : first >= 194 && first <= 223 ? 2 : first <= 239 && first >= 224 ? 3 : first >= 240 && first <= 244 ? 4 : 0;
      const encoded = raw.slice(i, i + count * 3);
      if (count && new RegExp(`^(?:%[0-9a-f]{2}){${count}}$`, "i").test(encoded)) {
        try { value = decodeURIComponent(encoded); i += encoded.length; } catch { /* Preserve malformed bytes. */ }
      }
    }
    if (i === start) i++;
    for (let j = 0; j < value.length; j++) offsets[text.length + j] = start;
    text += value;
    offsets[text.length] = i;
  }
  return { text, offsets };
}

function segmentRels(path, xml) {
  const segments = [];
  for (const element of relationshipElements(xml)) {
    if (element.attrs.TargetMode?.value !== "External") continue;
    const target = element.attrs.Target;
    if (!target) throw wordOpenError();
    const uriRaw = target.value;
    const { text, offsets: uriOffsets } = decodeUriPositions(uriRaw);
    segments.push({ path, text, runs: [{ attr: true, uriRaw, uriOffsets, quote: target.quote, valueStart: target.start, valueEnd: target.end, start: 0, end: text.length }] });
  }
  return segments;
}

function segmentCore(path, xml) {
  const segments = [];
  for (const tag of CORE_TEXT_TAGS) {
    const re = new RegExp(`(<${tag}(?:\\s[^>]*)?>)([\\s\\S]*?)</${tag}>`);
    const m = xml.match(re);
    if (!m || !m[2].trim()) continue;
    const text = decodeXml(m[2]);
    segments.push({ path, text, runs: [{ openTagStart: m.index, closeTagStart: m.index + m[1].length + m[2].length, openTag: m[1], start: 0, end: text.length }] });
  }
  return segments;
}

export async function parseDOCXStructured(file) {
  const buf = await file.arrayBuffer();
  let zip;
  try { zip = await JSZip.loadAsync(buf); }
  catch { throw new Error("This file could not be opened as a Word document (.docx)"); }
  if (!zip.file("word/document.xml")) throw new Error("This file is not a Word document (.docx)");
  const cleaned = await cleanPackage(zip);

  const order = (a, b) => (a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b));
  const parts = {};
  const segments = [];
  for (const path of Object.keys(zip.files).filter((p) => TEXT_PARTS.test(p)).sort(order)) {
    parts[path] = cleanPartXml(await zip.file(path).async("string"), cleaned);
    segments.push(...segmentBody(path, parts[path]), ...segmentAltText(path, parts[path]));
  }
  for (const path of Object.keys(zip.files).filter((p) => RELS_PARTS.test(p)).sort()) {
    parts[path] = await zip.file(path).async("string");
    segments.push(...segmentRels(path, parts[path]));
  }
  if (zip.file("docProps/core.xml")) {
    parts["docProps/core.xml"] = await zip.file("docProps/core.xml").async("string");
    segments.push(...segmentCore("docProps/core.xml", parts["docProps/core.xml"]));
  }

  return {
    kind: "docx-structured",
    format: "docx",
    headers: ["text"],
    rows: segments.map((s) => [s.text]),
    meta: { zip, parts, segments, cleaned },
  };
}

// New text for each run of a segment, given the replacements (sorted, non-overlapping,
// positions in the segment's text). A replacement lands in the run where its match starts.
export function spliceRuns(segment, replacements) {
  return segment.runs.map((run) => {
    let out = "";
    let pos = run.start;
    for (const r of replacements) {
      if (r.end <= run.start || r.start >= run.end) continue;
      if (r.start > pos) out += segment.text.slice(pos, r.start);
      if (r.start >= run.start) out += r.text;
      pos = Math.min(r.end, run.end);
    }
    if (pos < run.end) out += segment.text.slice(pos, run.end);
    return out;
  });
}

/**
 * Rebuild a DOCX blob. `edits[i]` lists the replacements made in segment i (from
 * applyTransformations). Segments with no edits are written back untouched.
 */
export async function buildDOCX(parsed, newRows, edits) {
  const { zip, parts, segments } = parsed.meta;
  const byPart = new Map();
  segments.forEach((seg, i) => {
    const reps = (edits && edits[i]) || [];
    if (!reps.length) return;
    const texts = spliceRuns(seg, [...reps].sort((a, b) => a.start - b.start));
    if (!byPart.has(seg.path)) byPart.set(seg.path, []);
    seg.runs.forEach((run, r) => {
      const t = texts[r];
      if (t === seg.text.slice(run.start, run.end)) return;
      if (run.attr) {
        // A hyperlink address must stay an address: a redaction mark inside "mailto:" is not one,
        // and Word would offer to repair the file.
        const original = seg.text.slice(run.start, run.end);
        let value = t;
        if (run.uriRaw !== undefined) {
          value = run.uriRaw;
          for (const edit of [...reps].sort((a, b) => b.start - a.start)) {
            value = value.slice(0, run.uriOffsets[edit.start]) + encodeURIComponent(edit.text) + value.slice(run.uriOffsets[edit.end]);
          }
          // Replacing the URL's start replaces the address, not a query value.
          // Prose scanning can leave closing punctuation beyond the matched span.
          // Keep generated addresses usable; redactions and hashes stay inert HTTPS.
          if (/^https?:\/\//i.test(original) && reps.some(edit => edit.start === 0)) {
            value = /^https?:\/\/[^\s<>"\[\]]+$/i.test(t) ? t : `https://example.invalid/#${encodeURIComponent(t)}`;
          }
        }
        if (/^mailto:/i.test(original) && /[\s[\]<>"]/.test(t)) value = "mailto:redacted@example.invalid";
        byPart.get(seg.path).push({ start: run.valueStart, end: run.valueEnd, replacement: encodeAttr(value, run.quote) });
        return;
      }
      const preserve = /^\s|\s$/.test(t) && !/xml:space=/.test(run.openTag);
      const openTag = preserve ? run.openTag.replace(/>$/, ' xml:space="preserve">') : run.openTag;
      byPart.get(seg.path).push({ start: run.openTagStart, end: run.closeTagStart, replacement: openTag + encodeText(t) });
    });
  });
  for (const [path, xml] of Object.entries(parts)) {
    let x = xml;
    for (const e of (byPart.get(path) || []).sort((a, b) => b.start - a.start)) x = x.slice(0, e.start) + e.replacement + x.slice(e.end);
    zip.file(path, x);
  }
  const arr = await zip.generateAsync({ type: "uint8array", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const blob = new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  return { blob, text: newRows.map((r) => r[0]).join("\n"), ext: "docx", mime: blob.type };
}
