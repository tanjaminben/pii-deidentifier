// Shared by the single-file page and batch mode: the starting plan for a set of findings, and
// the one boundary note a file earns (what the clean copy will not contain, or cannot check).

export const isDocument = (parsed) => parsed.kind === "text" || parsed.kind === "docx-structured";

export function planFor(detection) {
  return detection.map((row) => ({
    key: row.key,
    mode: row.mode,
    index: row.index,
    header: row.header,
    detectorId: row.top?.detectorId || null,
    transform: row.suggested,
  }));
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (items) => (items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`);

// One sentence or two, plain, about this file only. Null when there is nothing to say.
export function fileNotice(parsed) {
  const meta = parsed.meta || {};
  const notes = [];
  if (parsed.format === "csv") {
    notes.push("CSV cells that could run as spreadsheet formulas are exported as text with a leading apostrophe.");
  }
  if (meta.headerless) {
    notes.push("The first row looked like data, not column names, so the columns are numbered and every row is checked.");
  }
  if (meta.sheetNames && meta.sheetNames.length > 1) {
    notes.push(`This workbook has ${meta.sheetNames.length} sheets. Redactorium reads “${meta.sheetName}”, and the clean file contains only that sheet.`);
  }
  if (parsed.format === "pdf") {
    notes.push("The exported PDF contains text only. It omits the original layout, images, and attachments. Review the exported PDF for text that was hidden in the original, such as white text or text covered by a black box.");
  }
  if (meta.cleaned) {
    const c = meta.cleaned;
    const dropped = [];
    if (c.comments) dropped.push(plural(c.comments, "comment"));
    if (c.trackedDeletions || c.trackedInsertions) dropped.push("the tracked changes (accepted as final)");
    if (c.propertiesCleared.length) dropped.push("the author and company details");
    if (c.dataPartsRemoved || c.documentVariables) dropped.push("hidden data fields");
    if (dropped.length) notes.push(`The clean copy also drops ${list(dropped)}.`);
    if (c.unread && c.unread.length) notes.push(`Redactorium can't read inside ${list(c.unread)}, so they stay in the clean copy as they are.`);
  }
  return notes.length ? notes.join(" ") : null;
}
