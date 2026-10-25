// The legend above the findings shows what each treatment does to one phone number. These
// tests hold every example to what the tool actually produces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LEGEND, LEGEND_EXAMPLE } from "../src/redactorium/lib/legend.js";
import { generalize, redact, synthetic, makeRng } from "../src/redactorium/lib/transformers.js";

const by = Object.fromEntries(LEGEND.map((entry) => [entry.transform, entry]));

test("the legend covers the four treatments that change a value, by their menu names", () => {
  assert.deepEqual(LEGEND.map((entry) => entry.label), ["Redact", "Replace with a code", "Make less exact", "Swap for fakes"]);
});

test("each example is what that treatment really does to the example number", () => {
  assert.equal(by.redact.after, redact(LEGEND_EXAMPLE));
  assert.match(by.hash.after, /^[0-9a-f]{16}$/, "a code is 16 hex characters");
  assert.equal(by.generalize.after, generalize(LEGEND_EXAMPLE, "phone"));
  const shape = /^\+1 \d{3} 555 01\d{2}$/;
  assert.match(by.synthetic.after, shape);
  assert.match(synthetic("phone", makeRng(7)), shape, "the generator makes numbers of the same shape");
});
