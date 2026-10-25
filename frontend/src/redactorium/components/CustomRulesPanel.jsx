import { useEffect, useState } from "react";
import { toast } from "sonner";
import { loadCustomRules, saveCustomRules, compileRule } from "@/redactorium/lib/customRules";

const uid = () => Math.random().toString(36).slice(2, 10);
const blank = () => ({ id: uid(), name: "", pattern: "", flags: "", columnHint: "", category: "custom", base: 0.85 });

// The page opens this panel from its "Custom rules" text action, so the panel has no toggle
// of its own: one disclosure, not two.
export default function CustomRulesPanel({ onRulesChange }) {
  const [rules, setRules] = useState([]);
  const [draft, setDraft] = useState(blank);
  const [testValue, setTestValue] = useState("");
  const [testResult, setTestResult] = useState(null);

  useEffect(() => { setRules(loadCustomRules()); }, []);
  useEffect(() => { onRulesChange && onRulesChange(rules); }, [rules, onRulesChange]);

  const persist = (next) => { setRules(next); saveCustomRules(next); };

  const addRule = () => {
    if (!draft.name.trim() || !draft.pattern) { toast.error("Give the rule a name and a pattern."); return; }
    try { compileRule(draft); }
    catch (e) { toast.error(`That pattern has a typo: ${e.message.replace(/^Invalid regular expression: /, "")}`); return; }
    persist([...rules, { ...draft, name: draft.name.trim() }]);
    setDraft(blank()); setTestResult(null); setTestValue("");
  };

  const deleteRule = (id) => { persist(rules.filter((r) => r.id !== id)); };

  const runTest = () => {
    try { setTestResult(new RegExp(draft.pattern, (draft.flags || "").replace(/[gy]/g, "")).test(testValue)); }
    catch (e) { setTestResult(null); toast.error(`That pattern has a typo: ${e.message.replace(/^Invalid regular expression: /, "")}`); }
  };

  return (
    <div className="red-rules" data-testid="custom-rules-panel">
      <p className="red-rules-intro">
        For identifiers only your organization uses, like employee or ticket numbers. Rules are saved in this browser and run on every file.
      </p>

      {rules.length > 0 && (
        <ul className="red-rules-list" aria-label="Saved rules">
          {rules.map((r) => (
            <li key={r.id} data-testid={`custom-rule-${r.id}`}>
              <span className="red-rules-name">{r.name}</span>
              <span className="mono red-muted">{r.pattern}{r.flags && r.flags.includes("i") ? " (any case)" : ""}</span>
              <button
                type="button"
                data-testid={`delete-rule-${r.id}`}
                className="text-action"
                onClick={() => deleteRule(r.id)}
                aria-label={`Delete the rule ${r.name}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="red-rules-grid">
        <div className="red-rules-field">
          <label className="field-label" htmlFor="rule-name">Name</label>
          <input id="rule-name" data-testid="rule-name" className="red-adv-input red-adv-text" placeholder="Employee ID"
            value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        </div>
        <div className="red-rules-field">
          <label className="field-label" htmlFor="rule-pattern">Pattern (regular expression)</label>
          <input id="rule-pattern" data-testid="rule-pattern" className="red-adv-input" placeholder={"EMP-\\d{6}"}
            value={draft.pattern} spellCheck={false} autoComplete="off"
            onChange={(e) => setDraft((d) => ({ ...d, pattern: e.target.value }))} />
        </div>
        <div className="red-rules-field">
          <label className="field-label" htmlFor="rule-hint">Column names to look for (optional)</label>
          <input id="rule-hint" data-testid="rule-hint" className="red-adv-input" placeholder="employee|emp_id"
            value={draft.columnHint} spellCheck={false} autoComplete="off"
            onChange={(e) => setDraft((d) => ({ ...d, columnHint: e.target.value }))} />
        </div>
        <div className="red-rules-field red-rules-check">
          <label htmlFor="rule-case">
            <input id="rule-case" data-testid="rule-flags" type="checkbox"
              checked={(draft.flags || "").includes("i")}
              onChange={(e) => setDraft((d) => ({ ...d, flags: e.target.checked ? "i" : "" }))} />
            Ignore upper and lower case
          </label>
        </div>
      </div>

      <div className="red-rules-test">
        <label className="field-label" htmlFor="rule-test-value">Try it on a value</label>
        <div className="red-rules-test-row">
          <input id="rule-test-value" data-testid="rule-test-value" className="red-adv-input" placeholder="EMP-004211"
            value={testValue} spellCheck={false} autoComplete="off" onChange={(e) => setTestValue(e.target.value)} />
          <button type="button" data-testid="rule-run-test" onClick={runTest} className="btn-ghost-ink">Test</button>
          {testResult !== null && (
            <span className="red-rules-result" role="status">{testResult ? "Matches" : "No match"}</span>
          )}
        </div>
      </div>

      <div className="red-rules-save">
        <button type="button" data-testid="add-custom-rule-btn" onClick={addRule} className="btn-forest">Save rule</button>
      </div>
    </div>
  );
}
