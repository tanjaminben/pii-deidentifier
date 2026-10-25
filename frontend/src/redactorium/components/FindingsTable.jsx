import { TID } from "@/redactorium/constants/testIds";
import { ChevronDown } from "lucide-react";

export const TRANSFORM_OPTIONS = [
  { v: "keep",       label: "Keep" },
  { v: "redact",     label: "Redact" },
  { v: "hash",       label: "Replace with a code" },
  { v: "generalize", label: "Make less exact" },
  { v: "synthetic",  label: "Swap for fakes" },
];

// Fakes exist only for the built-in kinds; a custom rule's matches can be kept, redacted,
// replaced with a code, or made less exact.
export const canFake = (top) => !!top && !String(top.detectorId).startsWith("custom:");

// What the row is about, for the select's accessible name ("Treatment for email").
const subject = (row) => (row.mode === "text" && row.top ? `${row.top.name} in ${row.header}` : row.header || "unnamed column");

// A row found inside text says, on its own line, how many matches its treatment will change.
export const detectedLabel = (row) => {
  const t = row.top;
  const name = `${t.name}${t.isCustom ? " (custom rule)" : ""}`;
  if (row.mode !== "text") return name;
  return (
    <>
      {name}
      <span className="red-count">{t.matches.toLocaleString()} {t.matches === 1 ? "match" : "matches"} in the text</span>
    </>
  );
};

function TransformSelect({ testId, row, plan, onChange }) {
  return (
    <div className="red-treatment">
      <select
        data-testid={testId}
        value={plan.transform}
        aria-label={`Treatment for ${subject(row)}`}
        onChange={(e) => onChange({ ...plan, transform: e.target.value })}
      >
        {TRANSFORM_OPTIONS.filter((o) => o.v !== "synthetic" || canFake(row.top)).map((o) => (
          <option key={o.v} value={o.v}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="red-treatment-chevron" aria-hidden="true" />
    </div>
  );
}

/**
 * The findings table (DESIGN-SYSTEM §3): Column, Detected, Confidence, Citation, Treatment.
 * Cards below the width where the table fits whole (a frame of 1074px), so no select is
 * ever clipped. `idPrefix` keeps test ids unique when batch mode shows several files.
 */
export default function FindingsTable({ detection, columnPlan, onPlanChange, idPrefix = "" }) {
  const sel = (i) => (idPrefix ? `${idPrefix}-transform-${i}` : TID.transformSelect(i));
  const rowId = (i) => (idPrefix ? `${idPrefix}-row-${i}` : TID.detectionRow(i));
  return (
    <>
      <div className="red-cards mt-6">
        {detection.map((row, i) => {
          const t = row.top;
          return (
            <div key={row.key} data-testid={rowId(i)} className="red-finding-card">
              <div className="red-finding-card-head">
                <span className="mono text-sm">{row.header || <em className="red-muted">(unnamed)</em>}</span>
                {t && <span data-testid={idPrefix ? undefined : TID.confidencePill(i)} className="mono text-sm" aria-label={`Confidence ${t.confidence.toFixed(2)}`}>{t.confidence.toFixed(2)}</span>}
              </div>
              <p className="red-finding-card-line">
                {t ? (
                  <>
                    <span data-testid={idPrefix ? undefined : TID.detectorBadge(i)}>{detectedLabel(row)}</span> <span className="red-card-citation">{t.citation}</span>
                  </>
                ) : "—"}
              </p>
              <TransformSelect testId={sel(i)} row={row} plan={columnPlan[i]} onChange={(np) => onPlanChange(i, np)} />
            </div>
          );
        })}
      </div>

      <div className="red-table mt-4">
        <div className="overflow-x-auto">
          <table data-testid={idPrefix ? `${idPrefix}-table` : TID.detectionTable} className="editorial-table" style={{ minWidth: 780 }}>
            <thead>
              <tr>
                <th style={{ width: 180 }}>Column</th>
                <th style={{ width: 190 }}>Detected</th>
                <th style={{ width: 110 }}>Confidence</th>
                <th>Citation</th>
                <th style={{ width: 220 }}>Treatment</th>
              </tr>
            </thead>
            <tbody>
              {detection.map((row, i) => {
                const t = row.top;
                return (
                  <tr key={row.key} data-testid={rowId(i)}>
                    <td className="mono">{row.header || <em className="red-muted">(unnamed)</em>}</td>
                    <td>
                      {t ? (
                        <span data-testid={idPrefix ? undefined : TID.detectorBadge(i)}>{detectedLabel(row)}</span>
                      ) : <span className="red-muted">—</span>}
                    </td>
                    <td>
                      {t ? (
                        <span data-testid={idPrefix ? undefined : TID.confidencePill(i)} className="mono">{t.confidence.toFixed(2)}</span>
                      ) : <span className="red-muted">—</span>}
                    </td>
                    <td className="red-muted">{t ? t.citation : "—"}</td>
                    <td>
                      <TransformSelect testId={sel(i)} row={row} plan={columnPlan[i]} onChange={(np) => onPlanChange(i, np)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
