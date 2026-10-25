import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Every third-party package the bundle actually contains, with its version, declared license
// and license text, written beside the build as THIRD-PARTY-LICENSES.txt. pdf.js and SheetJS
// are Apache-2.0, which asks for the license to travel with the code, and the inline legal
// comments alone do not carry it (the pdf chunk keeps none). The list comes from the modules
// Rollup put in the chunks, so a dependency that is installed but unused is not in it.
function thirdPartyLicenses() {
  return {
    name: "third-party-licenses",
    apply: "build",
    generateBundle(_options, bundle) {
      const packages = new Map(); // name -> package directory
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        for (const id of Object.keys(chunk.modules)) {
          const path = id.replace(/^\0/, "").split("?")[0];
          const parts = path.split(/[\\/]node_modules[\\/]/);
          if (parts.length < 2) continue;
          const segs = parts[parts.length - 1].split(/[\\/]/);
          const name = segs[0].startsWith("@") ? `${segs[0]}/${segs[1]}` : segs[0];
          const dir = join(parts.slice(0, -1).join("/node_modules/"), "node_modules", ...name.split("/"));
          if (!packages.has(name)) packages.set(name, dir);
        }
      }
      const blocks = [...packages.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, dir]) => {
        let pkg = {};
        try { pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); } catch { /* keep the name */ }
        const declared = typeof pkg.license === "string" ? pkg.license : pkg.license?.type || "not declared";
        const file = existsSync(dir) ? readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|-|$)/i.test(f)) : null;
        const text = file ? readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n").trim() : "(The package ships no license file; its package.json declares the license above.)";
        return `${"=".repeat(72)}\n${name}${pkg.version ? ` ${pkg.version}` : ""} — ${declared}\n${"-".repeat(72)}\n${text}\n`;
      });
      const head = "Redactorium bundles the third-party packages below. Each is listed with its version,\n"
        + "its declared license, and the license text it ships with. Redactorium itself is MIT\n"
        + "(see LICENSE in the source folder); its fonts are under the SIL Open Font License (fonts/OFL.txt).\n\n";
      this.emitFile({ type: "asset", fileName: "THIRD-PARTY-LICENSES.txt", source: head + blocks.join("\n") });
    },
  };
}

// Embed the standalone app's package-local icon in the built entry HTML.
function toolkitIcon() {
  const png = readFileSync(fileURLToPath(new URL("./public/favicon-32.png", import.meta.url))).toString("base64");
  const tag = `<link rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,${png}" />`;
  return {
    name: "toolkit-icon",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(/<link rel="icon"[^>]*>\s*/, "").replace("</title>", `</title>\n    ${tag}`);
    },
  };
}

// Standalone Vite build. Relative URLs allow hosting below a path prefix.
export default defineConfig({
  // Served from /tools/redactorium/, so every asset URL has to be relative. CRA's
  // `"homepage": "."` did the same job.
  base: "./",
  plugins: [react(), thirdPartyLicenses(), toolkitIcon()],
  resolve: {
    // The one alias the source uses: `@/` -> `src/` (was jsconfig `paths` plus a craco alias).
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    // Keep CRA's output folder so the staging script and .gitignore need no change.
    outDir: "build",
    emptyOutDir: true,
    // index.html ships a CSP with `script-src 'self'` and no 'unsafe-inline'. Vite's
    // module-preload polyfill is an inline <script>, which that CSP would refuse, and every
    // browser the site supports loads modules natively, so the polyfill is switched off.
    modulePreload: { polyfill: false },
    // pdfjs-dist is a dynamic import in lib/parsers.js and lands in its own chunk. The main
    // bundle still carries the spreadsheet and document libraries, so the default 500 kB
    // warning would fire on every build without telling anyone anything new.
    chunkSizeWarningLimit: 1500,
  },
  esbuild: {
    // Keep third-party license headers in the bundle as well, as webpack's LICENSE.txt
    // extraction did. THIRD-PARTY-LICENSES.txt (above) is the complete record.
    legalComments: "inline",
  },
});
