// Saving a file from the browser. Kept apart from exporters.js because file-saver only runs
// in a browser, and the exporters are tested in Node.
import { saveAs } from "file-saver";

export function saveBlob(blob, filename) { saveAs(blob, filename); }
