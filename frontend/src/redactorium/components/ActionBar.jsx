import { TID } from "@/redactorium/constants/testIds";

export default function ActionBar({ onApply, canApply, applying, salt, setSalt, seed, setSeed, columnPlan = [], children }) {
  const changing = columnPlan.filter((c) => c.transform !== "keep").length;
  const kept = columnPlan.length - changing;
  return (
    <section className="max-w-6xl mx-auto px-4 md:px-6 mt-6">
      <div className="red-apply-row">
        <button
          data-testid={TID.applyBtn}
          onClick={() => {
            if (applying) return;
            if (!canApply) {
              // Nothing to change yet: hand focus to the first treatment the reader can see.
              const selects = [...document.querySelectorAll('[data-testid^="transform-select-"]')];
              selects.find((el) => el.offsetParent !== null)?.focus();
              return;
            }
            onApply();
          }}
          aria-disabled={!canApply || applying}
          className="btn-forest"
        >
          {applying ? "Applying…" : "Apply treatments"}
        </button>
        <span className="red-apply-count">{changing.toLocaleString()} to change · {kept.toLocaleString()} kept</span>
      </div>

      <details className="red-advanced">
        <summary>Advanced: code key, fake values, presets</summary>
        <div className="red-advanced-grid">
          <div className="flex flex-col">
            <label className="field-label mb-1" htmlFor="red-salt">Code key (optional)</label>
            <input
              id="red-salt"
              data-testid={TID.saltInput}
              value={salt}
              onChange={(e) => setSalt(e.target.value)}
              className="red-adv-input"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="red-adv-help">Empty: a new random key each run, so the codes can't be traced back. The same key gives the same codes in every file.</span>
          </div>
          <div className="flex flex-col">
            <label className="field-label mb-1" htmlFor="red-seed">Fake-value seed</label>
            <input
              id="red-seed"
              data-testid={TID.seedInput}
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              className="red-adv-input"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="red-adv-help">The same seed gives the same fake values.</span>
          </div>
        </div>
        {children}
      </details>
    </section>
  );
}

export function DownloadPanel({ onDownloadClean, onDownloadJson, onBack, outputWarning }) {
  return (
    <div className="red-record-actions">
      {outputWarning && <p className="red-boundary" role="status">{outputWarning}</p>}
      <div className="red-pair">
        <button data-testid={TID.downloadCleanBtn} onClick={onDownloadClean} className="btn-forest">
          Download clean file
        </button>
        <button data-testid={TID.downloadJsonLogBtn} onClick={onDownloadJson} className="btn-ghost-ink">
          Download record
        </button>
      </div>
      <button data-testid={TID.resetBtn} onClick={onBack} className="text-action">
        Back to treatments
      </button>
    </div>
  );
}
