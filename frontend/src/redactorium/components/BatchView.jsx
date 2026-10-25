import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import JSZip from "jszip";
import { parseFile } from "@/redactorium/lib/parsers";
import { detectColumns } from "@/redactorium/lib/detector";
import { applyTransformations, makeHasher, newSyntheticSeed } from "@/redactorium/lib/transformers";
import { buildOutput, buildLogJSON, bytesSha256, cleanBaseName } from "@/redactorium/lib/exporters";
import { saveBlob } from "@/redactorium/lib/download";
import { planFor, fileNotice } from "@/redactorium/lib/plan";
import FindingsTable from "@/redactorium/components/FindingsTable";
import TreatmentLegend from "@/redactorium/components/TreatmentLegend";
import { ACCEPT } from "@/redactorium/components/FileDropZone";

const VERSION = "0.2.0";
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export default function BatchView({ compiledCustom, invalidCustomRules = false, salt, seed, customRulesPanel = null }) {
  const [items, setItems] = useState([]); // { id, file, parsed, detection, plan, custom } or { id, file, error }
  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState("");
  const [outputWarnings, setOutputWarnings] = useState([]);
  const [drag, setDrag] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const fileRef = useRef(null);
  const folderRef = useRef(null);

  useEffect(() => {
    if (folderRef.current) {
      folderRef.current.setAttribute("webkitdirectory", "");
      folderRef.current.setAttribute("directory", "");
    }
  }, []);

  const addFiles = useCallback(async (list) => {
    if (invalidCustomRules) { toast.error("Delete and recreate invalid custom rules before processing."); return; }
    const files = Array.from(list || []).filter((f) => f.size > 0 || f.name);
    if (!files.length) return;
    setOutputWarnings([]);
    setBusy(true); setBusyMsg(`Reading ${plural(files.length, "file")}…`);
    const added = [];
    for (const f of files) {
      const id = `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 6)}`;
      try {
        const parsed = await parseFile(f);
        const detection = detectColumns(parsed, { customDetectors: compiledCustom });
        added.push({ id, file: f, parsed, detection, plan: planFor(detection), custom: compiledCustom });
      } catch (e) {
        added.push({ id, file: f, error: e.message || "This file couldn't be opened." });
      }
    }
    setItems((prev) => [...prev, ...added]);
    setBusy(false); setBusyMsg("");
  }, [compiledCustom, invalidCustomRules]);

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    addFiles(e.dataTransfer?.files);
  };

  const removeItem = (id) => {
    setOutputWarnings([]);
    setItems((list) => list.filter((it) => it.id !== id));
  };
  const updatePlan = (id, i, next) => setItems((list) => list.map((it) => {
    if (it.id !== id) return it;
    const plan = [...it.plan];
    plan[i] = next;
    return { ...it, plan };
  }));

  const usable = items.filter((it) => it.parsed);
  const failed = items.filter((it) => it.error);

  const applyAndBundle = async () => {
    if (invalidCustomRules) { toast.error("Delete and recreate invalid custom rules before processing."); return; }
    if (!usable.length) { toast.error("Add at least one file Redactorium can read."); return; }
    setOutputWarnings([]);
    setBusy(true); setBusyMsg("Applying treatments…");
    try {
      // One key and one set of fakes for the whole batch, so a person who appears in two
      // files gets the same code, or the same fake, in both.
      const hasher = await makeHasher(salt);
      const runSeed = seed || newSyntheticSeed();
      const fakes = new Map();
      const zip = new JSZip();
      const manifest = [];
      const warnings = [];
      const used = new Set();

      for (const it of usable) {
        const { parsed, plan, detection, file, custom } = it;
        const startedAt = new Date().toISOString();
        const inputHash = await bytesSha256(new Uint8Array(await file.arrayBuffer()));
        const { headers, rows, stats, edits, hashKey, reused } = await applyTransformations(parsed, plan, {
          hasher, fakes, seed: runSeed, extra: custom.filter((d) => d.find),
        });
        const output = await buildOutput({ ...parsed, headers, rows }, edits);
        const outputHash = await bytesSha256(new Uint8Array(await output.blob.arrayBuffer()));
        const log = buildLogJSON({
          inputFile: file, format: parsed.format, columnPlan: plan, stats, detectionResults: detection,
          inputHash, outputHash, hashKey, seed: runSeed, startedAt, finishedAt: new Date().toISOString(),
          outputFormat: output.ext, outputFallbackReason: output.fallbackReason,
          meta: parsed.meta, customDetectors: custom, reused,
        });

        const base = cleanBaseName(file.name, custom.filter((d) => d.find));
        let folder = base;
        for (let n = 2; used.has(folder); n++) folder = `${base}-${n}`;
        used.add(folder);
        zip.folder(folder).file(`${base}.redacted.${output.ext}`, output.blob);
        zip.folder(folder).file("redactorium-record.json", JSON.stringify(log, null, 2));
        if (output.warning) warnings.push({ fileName: file.name, warning: output.warning });
        manifest.push({
          folder,
          format: parsed.format,
          output_format: output.ext,
          ...(output.fallbackReason ? { fallback_reason: output.fallbackReason } : {}),
          rows: parsed.rows.length,
          changed: stats.reduce((s, c) => s + c.changed, 0),
          input_sha256: inputHash,
          output_sha256: outputHash,
        });
      }

      zip.file("MANIFEST.json", JSON.stringify({
        tool: "Redactorium",
        version: VERSION,
        mode: "batch",
        generated_at: new Date().toISOString(),
        files_processed: manifest.length,
        files: manifest,
        files_not_read: failed.map((it) => ({ name: `${cleanBaseName(it.file.name)}${it.file.name.includes(".") ? it.file.name.slice(it.file.name.lastIndexOf(".")) : ""}`, reason: it.error })),
      }, null, 2));

      const blob = await zip.generateAsync({ type: "blob", mimeType: "application/zip" });
      setOutputWarnings(warnings);
      saveBlob(blob, `redactorium-batch-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (e) {
      console.error(e);
      toast.error(e.message || "The batch could not be finished.");
    } finally { setBusy(false); setBusyMsg(""); }
  };

  return (
    <section className="max-w-6xl mx-auto px-4 md:px-6 mt-4" data-testid="batch-view">
      <h2 className="red-task-heading">Clean several files at once</h2>

      <div
        className={`red-drop-card dropzone red-batch-drop ${drag ? "is-drag" : ""}`}
        data-testid="batch-dropzone"
        onDragEnter={(e) => { e.preventDefault(); setDrag(true); }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <p className="red-drop-title">Drop files here</p>
        <p className="red-drop-formats">CSV · Excel · Word · PDF · text · Markdown · log files</p>
        <div className="red-upload-actions red-pair">
          <button data-testid="batch-add-files" className="btn-forest" onClick={() => fileRef.current?.click()}>
            Add files
          </button>
          <button data-testid="batch-add-folder" className="btn-ghost-ink" onClick={() => folderRef.current?.click()}>
            Add a folder
          </button>
        </div>
        <input ref={fileRef} type="file" multiple hidden accept={ACCEPT} data-testid="batch-file-input"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <input ref={folderRef} type="file" hidden data-testid="batch-folder-input"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      </div>

      {customRulesPanel && (
        <>
          <div className="red-under-zone">
            <button type="button" className="text-action" aria-expanded={rulesOpen} aria-controls="red-batch-rules" onClick={() => setRulesOpen((o) => !o)}>
              Custom rules
            </button>
          </div>
          <div id="red-batch-rules" className="red-under-panel" hidden={!rulesOpen}>{customRulesPanel}</div>
        </>
      )}

      {failed.length > 0 && (
        <p className="red-boundary" role="alert" data-testid="batch-errors">
          {failed.length === 1 ? "One file couldn't be read and is left out: " : `${failed.length} files couldn't be read and are left out: `}
          {failed.map((it, i) => (
            <span key={it.id}>{i > 0 ? "; " : ""}{it.file.name} ({it.error.replace(/\.$/, "")})</span>
          ))}.
        </p>
      )}

      {usable.some((it) => !(it.detection.length === 1 && it.detection[0].empty)) && <TreatmentLegend />}

      {usable.map((it) => (
        <div key={it.id} className="red-batch-item" data-testid="batch-item">
          <div className="red-findings-head">
            <h3 className="red-batch-name">{it.file.name}</h3>
            <button type="button" className="text-action" onClick={() => removeItem(it.id)} aria-label={`Remove ${it.file.name} from the batch`}>
              Remove
            </button>
          </div>
          {it.detection.length === 1 && it.detection[0].empty ? (
            <p className="red-empty-line">No personal data found. This file goes into the zip unchanged.</p>
          ) : (
            <FindingsTable
              detection={it.detection}
              columnPlan={it.plan}
              onPlanChange={(i, next) => updatePlan(it.id, i, next)}
              idPrefix={`batch-${it.id.replace(/[^A-Za-z0-9]/g, "")}`}
            />
          )}
          {fileNotice(it.parsed) && <p className="red-boundary">{fileNotice(it.parsed)}</p>}
        </div>
      ))}

      {usable.length > 0 && (
        <div className="red-apply-row red-batch-apply">
          <button data-testid="batch-apply-btn" onClick={applyAndBundle} aria-disabled={busy} className="btn-forest">
            {busy ? "Working…" : `Apply treatments to ${plural(usable.length, "file")}`}
          </button>
          <span className="red-apply-count">One zip: each clean file with its record.</span>
        </div>
      )}
      {busy && <p className="red-apply-count mt-3" role="status">{busyMsg}</p>}
      {outputWarnings.length > 0 && <div className="red-boundary" role="status" data-testid="batch-output-warnings">
        <p>{outputWarnings[0].warning}</p>
        <ul>{outputWarnings.map((item, i) => <li key={i}>{item.fileName}</li>)}</ul>
      </div>}
    </section>
  );
}
