function position(item) {
  const t = item.transform;
  if (!Array.isArray(t) || t.length < 6 || !t.every(Number.isFinite) || item.dir === "ttb") return null;
  const advance = Math.hypot(t[0], t[1]);
  const height = Math.hypot(t[2], t[3]);
  if (!advance || !height) return null;
  return { x: t[4], y: t[5], ux: t[0] / advance, uy: t[1] / advance, height, width: item.width || 0 };
}

/**
 * Assemble one page in content order. PDF.js can omit hasEOL between independently placed
 * header fields. Use their baselines and large column gaps as additional boundaries, or a
 * name can become part of a neighboring place/title and escape the document name detector.
 * Ordinary adjacent runs and spaces stay together; whitespace-only items never move the last
 * visible glyph's position (PDF.js can synthesize a space spanning an entire column gap).
 */
export function pdfTextLines(items) {
  const lines = [];
  let line = "";
  let previous = null;
  const flush = () => { lines.push(line.trimEnd()); line = ""; previous = null; };
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const current = item.str.trim() ? position(item) : null;
    let gap = 0;
    if (previous && current) {
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      gap = dx * previous.ux + dy * previous.uy - previous.width;
      const baseline = Math.abs(-dx * previous.uy + dy * previous.ux);
      const direction = current.ux * previous.ux + current.uy * previous.uy;
      if (direction < 0.99 || baseline > 0.5 * Math.min(previous.height, current.height)
        || Math.abs(gap) > 4 * Math.max(previous.height, current.height)) flush();
    }
    if (line && gap > 1 && !/\s$/.test(line) && !/^\s/.test(item.str)) line += " ";
    line += item.str;
    if (item.str.trim()) previous = current;
    if (item.hasEOL) flush();
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}
