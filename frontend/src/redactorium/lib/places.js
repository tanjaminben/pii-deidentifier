// US city/state shapes, not a city directory. State names and postal abbreviations are
// checked; a plausible city name can still be wrong and remains a reviewable heuristic.
// State abbreviations: https://pe.usps.com/text/pub28/28apb.htm (50 states and DC).
const STATES = [
  "Alabama|AL", "Alaska|AK", "Arizona|AZ", "Arkansas|AR", "California|CA", "Colorado|CO",
  "Connecticut|CT", "Delaware|DE", "Florida|FL", "Georgia|GA", "Hawaii|HI", "Idaho|ID",
  "Illinois|IL", "Indiana|IN", "Iowa|IA", "Kansas|KS", "Kentucky|KY", "Louisiana|LA",
  "Maine|ME", "Maryland|MD", "Massachusetts|MA", "Michigan|MI", "Minnesota|MN",
  "Mississippi|MS", "Missouri|MO", "Montana|MT", "Nebraska|NE", "Nevada|NV",
  "New Hampshire|NH", "New Jersey|NJ", "New Mexico|NM", "New York|NY", "North Carolina|NC",
  "North Dakota|ND", "Ohio|OH", "Oklahoma|OK", "Oregon|OR", "Pennsylvania|PA",
  "Rhode Island|RI", "South Carolina|SC", "South Dakota|SD", "Tennessee|TN", "Texas|TX",
  "Utah|UT", "Vermont|VT", "Virginia|VA", "Washington|WA", "West Virginia|WV",
  "Wisconsin|WI", "Wyoming|WY", "District of Columbia|DC",
].flatMap((pair) => pair.split("|"));

const state = STATES.sort((a, b) => b.length - a.length).join("|");
const word = "\\p{Lu}[\\p{L}\\p{M}'’.-]*";
const lead = "(?!(?:A|The|Then|From|In|At|To|Near|Visit|Contact|Customer|Based|Lives|Located)\\b)";
export const PLACE_SOURCE = `${lead}${word}(?:[ \\t]+${word}){0,4},[ \\t]*(?:${state})(?![\\p{L}\\p{M}])`;
const wholePlace = new RegExp(`^${PLACE_SOURCE}$`, "u");

export const isUSPlace = (value) => wholePlace.test(String(value).trim());
export function placeState(value) {
  const text = String(value).trim();
  return isUSPlace(text) ? text.slice(text.lastIndexOf(",") + 1).trim() : null;
}

// ZZ is deliberately not a US state abbreviation. These are obvious placeholders,
// not claims that a plausible place name is uninhabited.
export const FICTIONAL_PLACES = [
  "Exampleville, ZZ", "Sample Harbor, ZZ", "Fixture Falls, ZZ",
  "Placeholder Bay, ZZ", "Testfield, ZZ", "Mockford, ZZ",
];
