# Source snapshot

This package contains the current standalone frontend, detection and transformation engine, tests, configurations, fonts, dependency lockfile, and license notices.
It is a clean source snapshot. Earlier repository history, internal integration records,
workstation paths, and private extraction receipts are excluded.

The included `IMPORT-MANIFEST.json` records this snapshot's exact files and hashes; it does
not claim to be the original extraction manifest. Run `node scripts/verify-source.mjs` from the
repository root to verify the packaged source. Generated build output and installed
dependencies are excluded from that source check.

The test suite uses fabricated example records. A hash or replacement treatment does not establish that a document is anonymous; retain the README limitations.

Keep the supplied licenses and third-party notices with redistributed code and fonts.
The README banner and control artwork have their own applicable rights.

The bundled `frontend/public/pdf.worker.min.mjs` is PDF.js 4.8.69. Its Apache 2.0
license is retained in `licenses/pdfjs-dist-Apache-2.0.txt`, alongside the worker's
Mozilla copyright and license notice.
