import { useEffect, useState } from "react";
import { toast } from "sonner";
import { loadPresets, savePresets, makePresetFromPlan, applyPresetToPlan } from "@/redactorium/lib/presets";

export default function PresetsBar({ columnPlan, detection, onPlanChange }) {
  const [presets, setPresets] = useState([]);
  const [name, setName] = useState("");
  useEffect(() => { setPresets(loadPresets()); }, []);
  const persist = (next) => { setPresets(next); savePresets(next); };

  const savePreset = () => {
    if (!name.trim()) { toast.error("Give the preset a name."); return; }
    const p = makePresetFromPlan(name.trim(), columnPlan, detection);
    persist([...presets, p]);
    setName("");
  };

  const applyPreset = (p) => {
    const { plan, matches } = applyPresetToPlan(p, columnPlan, detection);
    onPlanChange(plan);
    toast.success(matches > 0 ? `“${p.name}” changed ${matches} treatment${matches === 1 ? "" : "s"}` : `“${p.name}” matches nothing in this file`);
  };

  const deletePreset = (id) => persist(presets.filter((p) => p.id !== id));

  return (
    <div className="red-presets">
      <label className="field-label" htmlFor="red-preset-name">Save these choices as a preset</label>
      <div className="red-presets-row">
        <input
          id="red-preset-name"
          data-testid="preset-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. HR export"
          className="red-adv-input"
          autoComplete="off"
        />
        <button data-testid="save-preset-btn" onClick={savePreset} className="btn-ghost-ink">
          Save preset
        </button>
      </div>

      {presets.length > 0 && (
        <div className="red-preset-list" data-testid="preset-list">
          {presets.map((p) => (
            <span key={p.id} data-testid={`preset-${p.id}`} className="red-preset-chip">
              <button
                data-testid={`apply-preset-${p.id}`}
                onClick={() => applyPreset(p)}
                className="text-action"
                aria-label={`Use the preset ${p.name}`}
              >
                {p.name}
              </button>
              <button
                data-testid={`delete-preset-${p.id}`}
                onClick={() => deletePreset(p.id)}
                className="red-preset-delete"
                aria-label={`Delete the preset ${p.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
