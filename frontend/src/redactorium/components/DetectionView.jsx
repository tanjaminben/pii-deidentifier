import FindingsTable from "@/redactorium/components/FindingsTable";
import TreatmentLegend from "@/redactorium/components/TreatmentLegend";

export default function DetectionView({ detection, columnPlan, onPlanChange, fileMeta, onChangeFile, notice, headingRef }) {
  const empty = detection.length === 1 && detection[0].empty;
  return (
    <section className="max-w-6xl mx-auto px-4 md:px-6 mt-8 md:mt-12">
      <div className="red-findings-head">
        <h2 className="red-task-heading" tabIndex={-1} ref={headingRef}>{fileMeta.name}</h2>
        <button type="button" className="text-action" onClick={onChangeFile}>Change file</button>
      </div>

      {empty ? (
        <p className="red-empty-line" data-testid="no-findings">
          No personal data found. Nothing in this {fileMeta.noun} matched a detector, so there is nothing to change.
        </p>
      ) : (
        <>
          <TreatmentLegend />
          <FindingsTable detection={detection} columnPlan={columnPlan} onPlanChange={onPlanChange} />
        </>
      )}

      {notice && <p className="red-boundary" data-testid="file-notice">{notice}</p>}
    </section>
  );
}
