// Test fixtures built in memory, so the repository carries no binary test files.
import JSZip from "jszip";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

// A Word document that hides personal data everywhere a naive redactor forgets to look.
export async function trickyDocx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/people.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/word/glossary/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml"/><Default Extension="jpeg" ContentType="image/jpeg"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/><Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2011/relationships/people" Target="people.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:grace.hopper@fleetworks.example" TargetMode="External"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/glossaryDocument" Target="glossary/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>`
    // An email split across three runs, the middle one bold.
    + `<w:p><w:r><w:t xml:space="preserve">Write to ada.</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>love</w:t></w:r><w:r><w:t xml:space="preserve">lace@analytical.example today.</w:t></w:r></w:p>`
    // A tracked deletion that still holds an SSN, and a tracked insertion to accept.
    + `<w:p><w:r><w:t xml:space="preserve">Status: </w:t></w:r><w:del w:id="1" w:author="Charles Babbage" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>SSN 123-45-6789 on file</w:delText></w:r></w:del><w:ins w:id="2" w:author="Charles Babbage" w:date="2026-01-01T00:00:00Z"><w:r><w:t>verified</w:t></w:r></w:ins></w:p>`
    // A comment anchored to a sentence with a phone number.
    + `<w:p><w:commentRangeStart w:id="0"/><w:r><w:t xml:space="preserve">Call (415) 555-0134 before noon.</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="0"/></w:r></w:p>`
    // A hyperlink whose address is in the relationships file.
    + `<w:p><w:hyperlink r:id="rId5"><w:r><w:t>Email Grace</w:t></w:r></w:hyperlink></w:p>`
    // A labeled name after a tab, and a paragraph with nothing personal (must be untouched).
    + `<w:p><w:r><w:t>Name:</w:t></w:r><w:r><w:tab/><w:t>Katherine Johnson</w:t></w:r></w:p>`
    + `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Nothing personal here.</w:t></w:r></w:p>`
    + `<w:p><w:r><w:t/></w:r></w:p>`
    + `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:docPr id="1" name="Picture 1" descr="Badge photo, Name: Hedy Lamarr, hedy@films.example"/></wp:inline></w:drawing></w:r></w:p>`
    // A simple field whose instruction carries a mailto address, and a hyperlink with hover text.
    + `<w:p><w:fldSimple w:instr=" HYPERLINK &quot;mailto:field@simple.example&quot; "><w:r><w:t>Write</w:t></w:r></w:fldSimple></w:p>`
    + `<w:p><w:hyperlink r:id="rId5" w:tooltip="Mail tooltip@hover.example now"><w:r><w:t>Hover me</w:t></w:r></w:hyperlink></w:p>`
    // A table cell deletion: a tracked change with an author, on an otherwise plain cell.
    + `<w:tbl><w:tr><w:tc><w:tcPr><w:cellDel w:id="9" w:author="Charles Babbage" w:date="2026-01-01T00:00:00Z"/></w:tcPr><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
    + `</w:body></w:document>`);
  zip.file("word/header1.xml", `<?xml version="1.0" encoding="UTF-8"?><w:hdr ${W}><w:p><w:r><w:t>Prepared for alan.turing@bletchley.example</w:t></w:r></w:p></w:hdr>`);
  zip.file("word/footnotes.xml", `<?xml version="1.0" encoding="UTF-8"?><w:footnotes ${W}><w:footnote w:id="1"><w:p><w:r><w:t>Source: card 4111 1111 1111 1111</w:t></w:r></w:p></w:footnote></w:footnotes>`);
  zip.file("word/comments.xml", `<?xml version="1.0" encoding="UTF-8"?><w:comments ${W}><w:comment w:id="0" w:author="Charles Babbage" w:initials="CB"><w:p><w:r><w:t>Ask Marie Curie, marie@radium.example</w:t></w:r></w:p></w:comment></w:comments>`);
  zip.file("word/people.xml", `<?xml version="1.0" encoding="UTF-8"?><w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:person w15:author="Charles Babbage"/></w15:people>`);
  zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Account notes, Name: Dorothy Vaughan</dc:title><dc:creator>Charles Babbage</dc:creator><cp:lastModifiedBy>Charles Babbage</cp:lastModifiedBy></cp:coreProperties>`);
  zip.file("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Company>Difference Engines Ltd</Company><Manager>Charles Babbage</Manager><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Title</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>Review of Emmy Noether</vt:lpstr></vt:vector></TitlesOfParts></Properties>`);
  zip.file("customXml/item1.xml", `<?xml version="1.0"?><employee><ssn>345-67-8901</ssn><name>Rosalind Franklin</name></employee>`);
  zip.file("customXml/itemProps1.xml", `<?xml version="1.0"?><ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="{00000000-0000-0000-0000-000000000001}"/>`);
  zip.file("docProps/custom.xml", `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Reviewer"><vt:lpwstr>Lise Meitner</vt:lpwstr></property></Properties>`);
  zip.file("word/settings.xml", `<?xml version="1.0"?><w:settings ${W}><w:attachedTemplate r:id="rId1"/><w:docVars><w:docVar w:name="client" w:val="Barbara McClintock"/></w:docVars></w:settings>`);
  zip.file("word/_rels/settings.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="file:///C:/Users/charles.babbage/Templates/Normal.dotm" TargetMode="External"/></Relationships>`);
  // Building blocks (AutoText) carry text like the body does; SmartArt keeps its text in a drawing part.
  zip.file("word/glossary/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:glossaryDocument ${W}><w:docParts><w:docPart><w:docPartBody><w:p><w:r><w:t>Signature: grace@autotext.example</w:t></w:r></w:p></w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>`);
  zip.file("word/diagrams/data1.xml", `<?xml version="1.0"?><dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst><dgm:pt modelId="1"><dgm:t><a:p><a:r><a:t>Org chart</a:t></a:r></a:p></dgm:t></dgm:pt></dgm:ptLst></dgm:dataModel>`);
  // A page thumbnail: a picture of page one.
  zip.file("docProps/thumbnail.jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  zip.file("word/media/image1.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  zip.file("word/embeddings/Microsoft_Excel_Worksheet.xlsx", "binary");
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return new File([bytes], "tricky.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

// Every personal value hidden in trickyDocx(), which must not survive a full redaction.
export const TRICKY_DOCX_SECRETS = [
  "ada.", "lovelace@analytical.example", "123-45-6789", "(415) 555-0134", "grace.hopper@fleetworks.example",
  "Katherine Johnson", "alan.turing@bletchley.example", "4111 1111 1111 1111", "Marie Curie", "marie@radium.example",
  "Charles Babbage", "Dorothy Vaughan", "Difference Engines Ltd",
  "Hedy Lamarr", "hedy@films.example", "345-67-8901", "Rosalind Franklin", "Lise Meitner", "Barbara McClintock",
  "Emmy Noether", "charles.babbage", "grace@autotext.example", "field@simple.example", "tooltip@hover.example",
];

export async function unzipText(blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const out = {};
  for (const [path, f] of Object.entries(zip.files)) if (!f.dir) out[path] = await f.async("string");
  return out;
}
