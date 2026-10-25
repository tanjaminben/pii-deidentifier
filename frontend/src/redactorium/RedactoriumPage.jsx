import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import Masthead from "@/redactorium/components/Masthead";
import Footer from "@/redactorium/components/Footer";
import FileDropZone from "@/redactorium/components/FileDropZone";
import DetectionView from "@/redactorium/components/DetectionView";
import ActionBar, { DownloadPanel } from "@/redactorium/components/ActionBar";
import CustomRulesPanel from "@/redactorium/components/CustomRulesPanel";
import PresetsBar from "@/redactorium/components/PresetsBar";
import BatchView from "@/redactorium/components/BatchView";
import { parseFile } from "@/redactorium/lib/parsers";
import { detectColumns } from "@/redactorium/lib/detector";
import { applyTransformations, makeHasher, newSyntheticSeed } from "@/redactorium/lib/transformers";
import { buildOutput, buildLogJSON, bytesSha256, cleanBaseName } from "@/redactorium/lib/exporters";
import { saveBlob } from "@/redactorium/lib/download";
import { compileRule } from "@/redactorium/lib/customRules";
import { planFor, fileNotice, isDocument } from "@/redactorium/lib/plan";
import { LoaderCircle } from "lucide-react";

const shortHash = (value) => (value && value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value || "—");
const stamp = (iso) => (iso ? iso.replace(/:\d{2}(?:\.\d+)?Z$/, "Z") : "—");
const count = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// Sample people are historical figures; every contact value is reserved for documentation or
// testing (example domains, 555-01xx and Ofcom drama numbers, documentation IP ranges, card
// test numbers), and the SSNs are ones the SSA has publicly voided.
const SAMPLE_CSV = `full_name,email,phone,dob,ssn,card_number,street_address,zip,ip,company,job_title
Ada Lovelace,ada.lovelace@analyticalengine.example,+1 415 555 0134,1985-12-10,078-05-1120,4111111111111111,12 Example Street,94107,192.0.2.10,Analytical Engine Inc,Chief Mathematician
Grace Hopper,grace.hopper@fleetworks.example,(202) 555-0119,1980-01-15,219-09-9999,5555555555554444,48 Sample Avenue,20500,198.51.100.4,Fleetworks Ltd,Rear Admiral
Alan Turing,alan.t@bletchley.example,+44 7700 900123,1978-06-23,123-45-6789,378282246310005,7 Fixture Lane,02139,203.0.113.7,Bletchley Park Co.,Cryptographer
Marie Curie,curie@radium.example,+1 617 555 0182,1990-11-07,078-05-1120,6011111111111117,90 Placeholder Road,75005,198.51.100.42,Radium GmbH,Physicist
Katherine Johnson,katherine.j@orbital.example,+1 212 555 0100,1975-08-26,219-09-9999,4242424242424242,300 Notreal Drive,20024,192.0.2.5,Orbital LLC,Aerospace Engineer`;

export default function Redactorium({ embedded = false }) {
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);   // { kind, format, headers, rows, meta }
  const [detection, setDetection] = useState(null); // findings rows (detector.js)
  const [columnPlan, setColumnPlan] = useState([]);
  const [applied, setApplied] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState("");
  const [loadError, setLoadError] = useState("");
  const [salt, setSalt] = useState("");
  const [seed, setSeed] = useState("");
  const [customRules, setCustomRules] = useState([]);
  const [detCustom, setDetCustom] = useState([]); // the compiled rules detection ran with
  const [mode, setMode] = useState("single"); // "single" | "batch"

  const onRulesChange = useCallback((rules) => setCustomRules(rules), []);

  const compiledCustom = useMemo(() => {
    const out = [];
    for (const r of customRules) {
      try { out.push(compileRule(r)); } catch { /* skip broken */ }
    }
    return out;
  }, [customRules]);
  const invalidCustomRules = compiledCustom.length !== customRules.length;

  useEffect(() => {
    for (const rule of customRules) {
      try { compileRule(rule); }
      catch (error) { toast.error(`${error.message}. Delete and recreate this saved rule before processing.`); }
    }
  }, [customRules]);

  const findingsHeadingRef = useRef(null);
  const recordHeadingRef = useRef(null);
  const focusTarget = useRef(null); // "findings" | "record" | "drop"

  const handleFile = async (f) => {
    if (invalidCustomRules) { setLoadError("Delete and recreate invalid custom rules before processing."); return; }
    setBusy(true); setBusyMsg("Reading the file…"); setLoadError("");
    setApplied(null);
    try {
      const p = await parseFile(f);
      const det = detectColumns(p, { customDetectors: compiledCustom });
      focusTarget.current = "findings";
      setFile(f); setParsed(p); setDetection(det); setColumnPlan(planFor(det)); setDetCustom(compiledCustom);
      toast.success(isDocument(p) ? `Read ${f.name}` : `Read ${f.name} · ${count(p.rows.length, "row")}`);
    } catch (e) {
      console.error(e);
      setLoadError(e.message || "This file couldn't be opened. It may be damaged. Save a fresh copy and try again.");
    } finally { setBusy(false); setBusyMsg(""); }
  };

  const handleSample = async () => {
    const f = new File([SAMPLE_CSV], "sample-contacts.csv", { type: "text/csv" });
    await handleFile(f);
  };

  const handlePlanChange = (i, next) => {
    setColumnPlan(prev => { const cp = [...prev]; cp[i] = next; return cp; });
  };

  const handleReset = () => {
    focusTarget.current = "drop";
    setFile(null); setParsed(null); setDetection(null); setColumnPlan([]); setApplied(null); setLoadError("");
  };

  const handleBack = () => {
    focusTarget.current = "findings";
    setApplied(null);
  };

  // The Toolkit shell posts a reset when its rail item for this tool is chosen again.
  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data && event.data.toolkit === "reset") {
        setFile(null); setParsed(null); setDetection(null); setColumnPlan([]); setApplied(null); setLoadError(""); setMode("single");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // A file dropped outside a drop zone would make the browser open it and leave the tool.
  useEffect(() => {
    const stop = (e) => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files")) e.preventDefault(); };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => { window.removeEventListener("dragover", stop); window.removeEventListener("drop", stop); };
  }, []);

  const canApply = !!parsed && detection && columnPlan.some(p => p.transform !== "keep");

  const handleApply = async () => {
    if (!parsed) return;
    setBusy(true); setBusyMsg("Applying treatments…");
    const startedAt = new Date().toISOString();
    try {
      const inputBytes = await file.arrayBuffer();
      const inputHash = await bytesSha256(new Uint8Array(inputBytes));
      const hasher = await makeHasher(salt);
      const runSeed = seed || newSyntheticSeed();
      const { headers, rows, stats, edits, hashKey, reused } = await applyTransformations(parsed, columnPlan, {
        hasher, seed: runSeed, extra: detCustom.filter((d) => d.find),
      });

      // The whole parsed file with its rows swapped: the Word writer needs its structure and edits.
      const outputArtifact = await buildOutput({ ...parsed, headers, rows }, edits);
      const outputHash = await bytesSha256(new Uint8Array(await outputArtifact.blob.arrayBuffer()));
      const finishedAt = new Date().toISOString();

      const log = buildLogJSON({
        inputFile: file, format: parsed.format, columnPlan, stats,
        detectionResults: detection, inputHash, outputHash,
        outputFormat: outputArtifact.ext, outputFallbackReason: outputArtifact.fallbackReason,
        hashKey, seed: runSeed, startedAt, finishedAt, meta: parsed.meta, customDetectors: detCustom, reused,
      });

      focusTarget.current = "record";
      setApplied({ headers, rows, stats, log, outputArtifact, inputHash, outputHash, finishedAt });
    } catch (e) {
      console.error(e);
      toast.error(e.message || "Something went wrong applying the treatments");
    } finally { setBusy(false); setBusyMsg(""); }
  };

  // Focus follows the view: the findings heading after a file loads or on the way back, the
  // record heading after applying, the drop zone's first button after changing the file.
  useEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    focusTarget.current = null;
    const el = target === "findings" ? findingsHeadingRef.current
      : target === "record" ? recordHeadingRef.current
      : document.querySelector('[data-testid="choose-file-btn"]');
    el?.focus();
  }, [parsed, applied, file]);

  const cleanFilename = useMemo(() => {
    if (!file || !applied) return "cleaned-file";
    const ext = applied.outputArtifact.ext;
    return `${cleanBaseName(file.name, detCustom.filter((d) => d.find))}.redacted.${ext}`;
  }, [file, applied, detCustom]);

  const dlClean = () => saveBlob(applied.outputArtifact.blob, cleanFilename);
  const dlJson  = () => saveBlob(new Blob([JSON.stringify(applied.log, null, 2)], { type: "application/json" }), "redactorium-record.json");

  const doc = parsed && isDocument(parsed);
  const empty = detection && detection.length === 1 && detection[0].empty;
  const changedColumns = applied ? new Set(applied.stats.filter((c) => c.changed > 0).map((c) => c.index)).size : 0;

  return (
    <div className={embedded ? "min-h-0 pb-10" : "min-h-screen"}>
      {!embedded && <Masthead />}

      {/* The intro strip first, then the mode toggle: both only while choosing what to work on */}
      {!(mode === "single" && parsed) && (
      <section className="max-w-6xl mx-auto px-4 md:px-6 mt-4">
        <ol className="red-steps" aria-label="How it works">
          <li><span className="red-step-num">01</span><strong>Drop a file</strong><span>A spreadsheet, a Word file, a PDF, or a text or log file.</span></li>
          <li><span className="red-step-num">02</span><strong>Check what it found</strong><span>Each column, and each kind of data found in the text, with the rule behind it.</span></li>
          <li><span className="red-step-num">03</span><strong>Choose and download</strong><span>Pick what happens to each one, then get the clean file and a record of the changes.</span></li>
        </ol>
        <div className="tool-mode-switch" role="tablist" aria-label="File mode"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? "single" : event.key === "End" ? "batch" : mode === "single" ? "batch" : "single";
            setMode(next);
            event.currentTarget.querySelector(`#file-mode-${next}`)?.focus();
          }}>
          <button
            data-testid="mode-single-btn"
            id="file-mode-single"
            role="tab"
            aria-selected={mode === "single"}
            aria-controls="file-mode-panel"
            tabIndex={mode === "single" ? 0 : -1}
            onClick={() => setMode("single")}
            className={`px-3 md:px-4 py-2 text-xs md:text-sm font-semibold flex items-center gap-2 transition ${mode==="single" ? "bg-[hsl(var(--ink))] text-[hsl(var(--paper))]" : "hover:bg-[hsl(var(--paper-2))]"}`}
          >
            Single file
          </button>
          <button
            data-testid="mode-batch-btn"
            id="file-mode-batch"
            role="tab"
            aria-selected={mode === "batch"}
            aria-controls="file-mode-panel"
            tabIndex={mode === "batch" ? 0 : -1}
            onClick={() => setMode("batch")}
            className={`px-3 md:px-4 py-2 text-xs md:text-sm font-semibold flex items-center gap-2 transition ${mode==="batch" ? "bg-[hsl(var(--ink))] text-[hsl(var(--paper))]" : "hover:bg-[hsl(var(--paper-2))]"}`}
          >
            Batch
          </button>
        </div>
      </section>
      )}

      <div id="file-mode-panel" style={{ display: "contents" }}
        role={mode === "batch" || !parsed ? "tabpanel" : undefined}
        aria-labelledby={mode === "batch" || !parsed ? `file-mode-${mode}` : undefined}>
      {mode === "single" && !parsed && (
        <FileDropZone
          onFile={handleFile}
          onSample={handleSample}
          error={loadError}
          customRulesPanel={<CustomRulesPanel onRulesChange={onRulesChange} />}
        />
      )}

      {mode === "batch" && (
        <BatchView
          compiledCustom={compiledCustom}
          invalidCustomRules={invalidCustomRules}
          salt={salt}
          seed={seed}
          customRulesPanel={<CustomRulesPanel onRulesChange={onRulesChange} />}
        />
      )}

      {busy && (
        <div className="max-w-6xl mx-auto px-4 md:px-6 mt-6" role="status">
          <div className="paper-card--soft p-4 flex items-center gap-3 text-sm">
            <LoaderCircle className="w-4 h-4 animate-spin" aria-hidden="true" />
            <span>{busyMsg}</span>
          </div>
        </div>
      )}

      {mode === "single" && parsed && detection && !applied && (
        <>
          <DetectionView
            detection={detection}
            columnPlan={columnPlan}
            onPlanChange={handlePlanChange}
            fileMeta={{ name: file.name, noun: doc ? "document" : "file" }}
            onChangeFile={handleReset}
            notice={fileNotice(parsed)}
            headingRef={findingsHeadingRef}
          />
          {!empty && (
            <ActionBar
              onApply={handleApply}
              canApply={canApply}
              applying={busy}
              salt={salt} setSalt={setSalt}
              seed={seed} setSeed={setSeed}
              columnPlan={columnPlan}
            >
              <PresetsBar
                columnPlan={columnPlan}
                detection={detection}
                onPlanChange={(newPlan) => setColumnPlan(newPlan)}
              />
            </ActionBar>
          )}
        </>
      )}

      {mode === "single" && applied && (
        <section className="max-w-6xl mx-auto px-4 md:px-6 mt-8">
          <h2 className="red-task-heading" tabIndex={-1} ref={recordHeadingRef}>{cleanFilename}</h2>

          <div className="red-stat-band">
            {doc ? (
              <>
                <span><span className="field-label">Kinds of data</span><strong>{applied.stats.length.toLocaleString()}</strong></span>
                <span><span className="field-label">Matches found</span><strong>{applied.stats.reduce((s, c) => s + c.sampled, 0).toLocaleString()}</strong></span>
                <span><span className="field-label">Changed</span><strong>{applied.stats.reduce((s, c) => s + c.changed, 0).toLocaleString()}</strong></span>
                <span><span className="field-label">Kept</span><strong>{count(applied.stats.filter((c) => c.transform === "keep").length, "kind")}</strong></span>
              </>
            ) : (
              <>
                <span><span className="field-label">Rows</span><strong>{applied.rows.length.toLocaleString()}</strong></span>
                <span><span className="field-label">Columns changed</span><strong>{changedColumns.toLocaleString()}</strong></span>
                <span><span className="field-label">Cells changed</span><strong>{applied.rows.reduce((total, row, ri) => total + row.filter((value, ci) => value !== parsed.rows[ri][ci]).length, 0).toLocaleString()}</strong></span>
                <span><span className="field-label">Columns kept</span><strong>{(parsed.headers.length - changedColumns).toLocaleString()}</strong></span>
              </>
            )}
          </div>

          <p className="red-hash-line"><span title={applied.outputHash}>SHA-256 {shortHash(applied.outputHash)}</span> · {stamp(applied.finishedAt)}</p>

          <DownloadPanel
            outputWarning={applied.outputArtifact.warning}
            onDownloadClean={dlClean}
            onDownloadJson={dlJson}
            onBack={handleBack}
          />
        </section>
      )}

      </div>
      {!embedded && <Footer />}
    </div>
  );
}
