// The treatment legend above the findings (Ben, 2026-09-28: people could not tell the options
// apart). One phone number runs through all four, so the treatment is the only thing that
// changes. tests/legend.test.mjs checks each "after" against the real functions, so the legend
// cannot drift from what the tool does.

export const LEGEND_EXAMPLE = "+1 415 555 0134";

export const LEGEND = [
  { transform: "redact", label: "Redact", after: "[REDACTED]", what: "Removes the value." },
  { transform: "hash", label: "Replace with a code", after: "5f1c0a9e83b2d746", what: "The same value always gets the same code, and nobody can turn it back." },
  { transform: "generalize", label: "Make less exact", after: "+1 415 *** ****", what: "Keeps the rough part, like an area code or a birth year, and hides the rest." },
  { transform: "synthetic", label: "Swap for fakes", after: "+1 212 555 0187", what: "A realistic value from a range set aside for fiction, so it belongs to no one." },
];
