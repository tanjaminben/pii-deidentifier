# PII De-identifier

Find likely personal information in files, choose how to treat it, and download a cleaned copy with a record of the changes.

<p>
<a href="https://ben-tan.com/tools/pii-deidentifier/"><img src="docs/images/buttons/pii-deidentifier.svg" height="50" alt="Try the tool"></a>&nbsp; 
<a href="LICENSE"><img src="docs/images/buttons/mit-license.svg" height="50" alt="MIT license"></a>&nbsp; 
<a href="https://ko-fi.com/itsbent"><picture><source media="(prefers-reduced-motion: reduce)" srcset="docs/images/buttons/kofi-static.svg"><img src="docs/images/buttons/kofi.svg" height="50" alt="Throw money at me"></picture></a>&nbsp; 
</p>

[![pii-deidentifier illustrated repository banner.](docs/images/banner.png)](docs/images/banner.png)

*[Open at ben-tan.com](https://ben-tan.com/tools/pii-deidentifier/).*

## What it does

1. Add a CSV, Excel, Word, PDF, text, Markdown, or log file.
2. Review the detected fields and text matches. Keep, redact, hash, mask, or replace values with fake data.
3. Download the cleaned file and a JSON record of the treatments and file hashes. Batch mode returns a ZIP.

Parsing and transformations happen in the browser; file contents are not uploaded. Pattern detection can miss personal information. Always inspect the result before sharing it.

## Run locally

Use Node.js 22.13 or newer on the 22.x line, or Node.js 24 or newer. Run these commands from the repository root:

```sh
npm ci --prefix frontend
npm start --prefix frontend -- --host 127.0.0.1
```

Open the loopback URL printed by Vite. This starts the standalone engine interface; the hosted tool has a separate website presentation.

## Build and check

```sh
npm test --prefix frontend
npm run lint --prefix frontend
npm run build --prefix frontend
```

The static output is `frontend/build/`, including `THIRD-PARTY-LICENSES.txt`. The source directory retains `redactorium` identifiers for compatibility.

## Limitations

- **Detection:** known patterns, checksums, labels, and column shapes are clues, not a complete identification of people. Free-form organization names and text in images are outside the detectors.
- **Word:** supported text parts are processed; comments, tracked-change metadata, author/company fields, and other listed metadata are removed. Pictures, embedded files, and charts are not read and remain in the file.
- **PDF:** output is a new text-only PDF, or a UTF-8 text file when the PDF font cannot preserve the treated characters. Original layout, images, attachments, and metadata are not preserved. A scan without a text layer cannot be processed. Hidden source text may become visible in the new document.
- **Spreadsheets:** only the first visible sheet is processed and included in the output; the interface names sheets left out.
- **Hashing:** equal values receive equal codes within a run or batch. A supplied key can preserve those codes across runs; transformed data can still identify someone.

See [processing details](docs/PROCESSING.md) for detector rules, document handling, replacement ranges, and the change record. No treatment guarantees anonymity.

## License and credits

Engine code uses the [MIT license](LICENSE). Retain bundled dependency notices and font licenses. Artwork has its own applicable rights.

---

Made by [Ben Tan](https://ben-tan.com). [Report a security issue](SECURITY.md).
