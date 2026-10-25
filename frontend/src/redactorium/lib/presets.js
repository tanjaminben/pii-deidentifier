/**
 * Presets — reusable plans, saved to localStorage.
 *
 * A preset maps a column name, or a kind of data, to a treatment. Loading a new file, a
 * column takes its column-name match first, then its kind; a kind found inside text takes
 * the treatment saved for that kind. So one preset fits both a CSV with the same headers and
 * an unrelated document that happens to hold the same kinds of data.
 */

const KEY = "redactorium.presets.v1";

export function loadPresets() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function savePresets(p) { localStorage.setItem(KEY, JSON.stringify(p)); }

export function makePresetFromPlan(name, columnPlan, detection) {
  const byHeader = {};
  const byDetector = {};
  const byText = {};
  columnPlan.forEach((p, i) => {
    const detId = detection?.[i]?.top?.detectorId;
    if (p.mode === "text") {
      if (detId) byText[detId] = p.transform;
      return;
    }
    // A generated name (a file with no header row) says nothing about the next file.
    if (p.header && !/^column_\d+$/.test(p.header)) byHeader[p.header.toLowerCase()] = p.transform;
    if (detId) byDetector[detId] = p.transform;
  });
  return {
    id: Math.random().toString(36).slice(2, 10),
    name,
    createdAt: new Date().toISOString(),
    byHeader,
    byDetector,
    byText,
  };
}

/**
 * Apply a preset to a fresh plan. Returns { plan, matches }: how many rows changed.
 * "Swap for fakes" needs a detected kind, so a saved fake lands only on a row that has one.
 */
export function applyPresetToPlan(preset, columnPlan, detection) {
  let matches = 0;
  const plan = columnPlan.map((p, i) => {
    const detId = detection?.[i]?.top?.detectorId;
    let want = null;
    if (p.mode === "text") want = detId ? preset.byText?.[detId] : null;
    else {
      const h = (p.header || "").toLowerCase();
      want = (h && preset.byHeader?.[h]) || (detId && preset.byDetector?.[detId]) || null;
    }
    if (!want || want === p.transform) return p;
    if (want === "synthetic" && (!detId || String(detId).startsWith("custom:"))) return p;
    matches++;
    return { ...p, transform: want };
  });
  return { plan, matches };
}
