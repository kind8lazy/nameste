/** Окончание по числу: plural(1, ['поездка','поездки','поездок']) → «поездка», 22 → «поездки», 11 → «поездок». */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}

export const TRIPS: [string, string, string] = ['поездка', 'поездки', 'поездок'];
