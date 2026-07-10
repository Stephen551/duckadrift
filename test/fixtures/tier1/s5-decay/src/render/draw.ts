// Fixture: a module that still exists, for contrast with the premises ADR-0001
// cites. The dependency `leftpad-classic` is absent from package.json and
// `src/pipeline/` does not exist — those two dead premises are what S5 must catch.
export function drawSwatch(hex: string): string {
  return `swatch:${hex}`;
}
