import { LEGEND, LEGEND_EXAMPLE } from "@/redactorium/lib/legend";

// One card above the findings: what each treatment does, shown on the same value.
export default function TreatmentLegend() {
  return (
    <section className="red-legend" aria-labelledby="red-legend-title" data-testid="treatment-legend">
      <h3 className="red-legend-title" id="red-legend-title">Four ways to anonymize a value</h3>
      <p className="red-legend-example">
        Here is what each one does to the phone number <span className="mono">{LEGEND_EXAMPLE}</span>
      </p>
      <dl className="red-legend-grid">
        {LEGEND.map((entry) => (
          <div key={entry.transform} className="red-legend-item">
            <dt>{entry.label}</dt>
            <dd className="red-legend-after mono">{entry.after}</dd>
            <dd className="red-legend-what">{entry.what}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
