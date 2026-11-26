import type { TotalRow } from './aggregate.js';

/**
 * Ціле число сотих -> рядок з двома знаками після коми.
 * Працює і для грошей (мінорні одиниці), і для ROI (соті відсотка).
 */
export function formatMoney(hundredths: number): string {
  const sign = hundredths < 0 ? '-' : '';
  const abs = Math.abs(hundredths);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * ROI у сотих відсотка: (дохід - витрати) * 10000 / витрати.
 * Рахуємо цілими числами з мінорних одиниць і округлюємо half away from zero
 * (як ROUND в Excel), щоб рівно .5 не з'їжджало ні вниз, ні до +∞.
 */
function roiHundredths(spendMinor: number, revenueMinor: number): number {
  const numerator = (revenueMinor - spendMinor) * 10000;
  const sign = numerator < 0 ? -1 : 1;
  const absNumerator = Math.abs(numerator);

  const quotient = Math.floor(absNumerator / spendMinor);
  const remainder = absNumerator - quotient * spendMinor;
  const rounded = remainder * 2 >= spendMinor ? quotient + 1 : quotient;

  return sign * rounded;
}

/** ROI для клітинки звіту. "-" коли ROI не визначений (витрати <= 0). */
export function formatRoi(row: TotalRow): string {
  if (!row.roiDefined) return '-';
  return `${formatMoney(roiHundredths(row.spendMinor, row.revenueMinor))}%`;
}
