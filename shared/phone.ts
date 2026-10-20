/** Телефон в едином виде: только цифры, российские номера начинаются с 7. «8 (921) 123-45-67» → «79211234567». */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('8')) d = `7${d.slice(1)}`;
  if (d.length === 10) d = `7${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/** «79211234567» → «+7 921 123-45-67» */
export function formatPhone(raw: string | null | undefined): string {
  const d = normalizePhone(raw);
  if (!d) return raw ?? '';
  if (d.length === 11 && d.startsWith('7')) return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
  return `+${d}`;
}

/**
 * Телефон из Яндекс ID: он приходит в международном виде «+79211234567» и подтверждён SMS.
 * Здесь никаких догадок вроде «8 → 7» — иначе иностранный номер можно спутать с российским.
 */
export function strictIntlPhone(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim().startsWith('+')) return null;
  const d = raw.replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? d : null;
}
