# Processing details

## What it reads

CSV, Excel (XLSX and XLS), Word (DOCX), PDF, text, Markdown, and log files. Single file, or a batch
that comes back as one zip: each clean file with its record, plus a manifest of every input and
output hash.

## How it finds things

Two ways, and the findings table says which one produced each row.

- **A spreadsheet column whose cells are personal data** (every cell an email address, a phone
  number, a name) is one row in the table. Its treatment rewrites every cell in the column.
- **Personal data inside text**: a sentence in a PDF, a paragraph in a Word file, a line in a log, a
  notes column in a spreadsheet. Each kind found there (email addresses, phone numbers, card and ID
  numbers) is its own row, with a count. Its treatment rewrites only the matched characters and
  leaves the rest of the sentence alone.

Inside text, card numbers, IBANs and NHS numbers must pass their checksums, and never-issued SSNs
are rejected. Kinds that only mean something next to a label (a date is a date of birth after "born" or
"DOB") need the label. Names are candidates after a label such as "Name:" or "Dear", or on
a short line of two to four capitalized words among a document's first five non-empty body lines.
The opening-line rule rejects common headings, roles and region words and carries a lower score;
it can still mistake a title for a name. Every exact, case-sensitive whole-name repeat of a found
name is then checked across that document, including Word headers and footers. Other names in
prose are not found. The rule does not learn names from another file or a spreadsheet.

**Place** finds shapes such as "Redlands, CA" or "Los Angeles, California", on their own or inside
a sentence. It checks the state against the 50 US states and DC, not the city against a directory.
The suggested treatment removes the whole place; Make less exact keeps only the state. Swap for
fakes uses named placeholders ending in `ZZ`, which is not a US state abbreviation. Free-form
regions such as "Greater Los Angeles Area" are outside this rule.

These patterns do not identify employers, schools or other organizations in running text.
PII De-identifier does not make a resume anonymous by itself; read the clean file before it goes out.

In a spreadsheet, three weak shapes count only in a column named for them: five digits in a ZIP
column, and six to nine letters and digits in a passport or driver's license column. Customer,
order and ticket IDs have the same shape, and would otherwise be read as passports.

The detectors live in [`frontend/src/redactorium/lib/`](../frontend/src/redactorium/lib/):

| File | What it holds |
|---|---|
| `piiPatterns.js` | The whole-cell detectors: name, pattern, checksum, and the plain rule shown in the table |
| `textScan.js` | The in-text patterns: where each kind sits inside a sentence, as exact character ranges |
| `places.js` | US city/state shapes, state extraction and fictional place placeholders |
| `detector.js` | Turns a parsed file into findings rows, whole-cell or in-text |
| `customRules.js` | Your own patterns, for the identifiers only your organization uses |
| `transformers.js` | The treatments: keep, redact, replace with a code (keyed hash), make less exact, swap for fakes |
| `parsers.js` | Turning each supported format into rows and text |
| `pdfText.js` | Separating PDF text items by line and column geometry |
| `docxHandler.js` | Word files: every text part, the cleaning, and a write-back that keeps formatting |
| `exporters.js` | The clean file and the record |

Nothing is changed until you apply the treatments, and every treatment can be changed first.

## Word, PDF and spreadsheet specifics

- **Word:** headers, footers, footnotes, endnotes, image alt text, hyperlink addresses and the
  document title are treated like the body. Comments, tracked changes (accepted as final), the
  author and company fields, content-control data and document variables are removed from the clean
  copy, and the record lists them. Pictures, embedded files and charts are not read and stay as
  they are; the page says so.
- **PDF:** the clean file is a new text-only PDF when its font supports the treated characters.
  Otherwise, it is a UTF-8 text file that preserves those characters. PDF output keeps the
  original page breaks. Layout, images,
  attachments and metadata stay behind. Text the original hid (white text, words under a black box,
  an invisible scan layer) is extracted with the rest and becomes ordinary visible text; the page
  says so. A scanned PDF with no text layer has nothing to read, and the page says that instead of
  returning an empty file.
  Text items on separate baselines or across large column gaps are read as separate lines even
  when the PDF omits a line-break marker, so a header name is not joined to a neighboring field.
- **Spreadsheets:** the first visible sheet is read, and the clean file contains only that sheet;
  the page names the sheets left out. A first row that holds data rather than column names is
  treated as data.

## Replace with a code

A keyed hash (HMAC-SHA-256, first 16 hex characters). With no key, each run makes a random one
and never stores it, so the same value gets the same code everywhere in the file (or the batch),
but nobody can rebuild the codes by hashing guesses. Enter a key under Advanced to get the same
codes across runs. Hashed data about people is still personal data under the GDPR.

## Make less exact and Swap for fakes

Make less exact keeps the rough part and drops the rest: a date of birth keeps its year, a ZIP code
its first three digits, an IP address its network, a phone number its country and area code.

Swap for fakes draws from reserved or published test ranges. This does not guarantee that the complete output is anonymous. The
same real value gets the same fake everywhere in the file (or the batch), and two different values
never share one while the range has room. Test card numbers, test IBANs and the NHS test number come
from short published lists, so they repeat.

## The record

Each run produces a JSON record: which detectors ran, what they found, the treatment applied to
each finding and how many values it changed, what was cleaned from a Word file, the SHA-256 of the
input and of the clean file, and timestamps. It holds no matched values and no key. The file name is scanned the
same way, and anything found in it is replaced before the name is used for the clean file or the
record.

