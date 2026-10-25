# PII De-identifier frontend

This standalone React interface parses and transforms supported files in the browser.
See the [repository README](../README.md) for formats, limitations, and local commands.

Run `npm ci`, `npm test`, `npm run lint`, and `npm run build` in this directory.
The static output is `build/`, including `THIRD-PARTY-LICENSES.txt` from the modules
bundled by Vite. Preserve the bundled font notices in `public/fonts/OFL.txt`.
Asset URLs are relative, and the entry HTML carries the standalone Content Security Policy.

SheetJS installs from its pinned CDN tarball; the lockfile records its integrity.
The included PDF worker version must match the pinned `pdfjs-dist` dependency.
