/**
 * Convert a 1-based column number to an Excel column letter (1 → "A", 27 → "AA", etc.).
 */
export function colLetter(col: number): string {
  let s = "";
  let c = col;
  while (c > 0) {
    c--;
    s = String.fromCharCode(65 + (c % 26)) + s;
    c = Math.floor(c / 26);
  }
  return s;
}
