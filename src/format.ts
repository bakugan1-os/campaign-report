import type { Report, TotalRow } from './aggregate.js';
import type { Issue, IssueKind } from './types.js';

export type ReportFormat = 'csv' | 'md';

/** Усі видимі підписи звіту живуть тут, щоб перейменування не чіпало логіку. */
const COLUMNS = ['campaign', 'spend', 'revenue', 'ROI'] as const;
const TOTAL_LABEL = 'Total';
const MD_ALIGNMENT = ['---', '---:', '---:', '---:'] as const;
const ISSUE_COLUMNS = ['file', 'line', 'type', 'message'] as const;
const ISSUE_TYPE: Record<IssueKind, string> = { помилка: 'error', попередження: 'warning' };

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

/** RFC 4180: лапки лише коли в полі є кома, лапка або перевід рядка. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Excel виконує клітинку, що починається з = + @ або -, як формулу.
 * Префікс апострофом лишає її текстом. Тільки для назв: суми й ROI чіпати не можна,
 * інакше "-50.00" перетвориться на "'-50.00".
 */
function csvSafeName(name: string): string {
  return /^[=+@-]/.test(name) ? `'${name}` : name;
}

function csvLine(fields: readonly string[]): string {
  return fields.map(csvField).join(',');
}

function mdLine(fields: readonly string[]): string {
  return `| ${fields.map((field) => field.replace(/\|/g, '\\|')).join(' | ')} |`;
}

function cells(campaign: string, row: TotalRow): string[] {
  return [campaign, formatMoney(row.spendMinor), formatMoney(row.revenueMinor), formatRoi(row)];
}

function document(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

export function formatReport(report: Report, format: ReportFormat): string {
  const body = [
    ...report.rows.map((row) => cells(row.campaign, row)),
    cells(TOTAL_LABEL, report.total),
  ];

  if (format === 'csv') {
    const safe = body.map(([name, ...rest]) => [csvSafeName(name ?? ''), ...rest]);
    return document([csvLine(COLUMNS), ...safe.map(csvLine)]);
  }
  return document([mdLine(COLUMNS), `| ${MD_ALIGNMENT.join(' | ')} |`, ...body.map(mdLine)]);
}

function issueLine(issue: Issue): string {
  if (issue.file === undefined) return issue.message;
  if (issue.line === undefined) return `${issue.file}: ${issue.message}`;
  return `${issue.file}:${issue.line}: ${issue.message}`;
}

/**
 * Проблеми без рядка-підсумку: для фатальної помилки, коли файл покинуто цілком,
 * а не пропущено окремі рядки.
 */
export function formatIssueLines(issues: readonly Issue[]): string {
  if (issues.length === 0) return '';
  return document(issues.map(issueLine));
}

/** Звіт помилок для stderr. Порядок проблем не змінюємо. */
export function formatIssuesText(issues: readonly Issue[]): string {
  if (issues.length === 0) return '';

  const lines = issues.map(issueLine);
  const skipped = countSkippedRows(issues);
  if (skipped > 0) lines.push(`Пропущено рядків: ${skipped}`);

  return document(lines);
}

/**
 * Пропущений рядок - будь-яка проблема, привʼязана до номера рядка: і битий рядок,
 * і пропущений рядок підсумку. Проблема рівня файлу (без номера) рядків не їсть.
 */
export function countSkippedRows(issues: readonly Issue[]): number {
  return issues.filter((issue) => issue.line !== undefined).length;
}

/**
 * Звіт помилок для <out>.errors.csv. Заголовок пишемо завжди, навіть без проблем:
 * інакше після чистого запуску поверх лишився б старий файл з неактуальними помилками.
 */
export function formatIssuesCsv(issues: readonly Issue[]): string {
  const lines = issues.map((issue) =>
    csvLine([
      issue.file ?? '',
      issue.line === undefined ? '' : String(issue.line),
      ISSUE_TYPE[issue.kind],
      issue.message,
    ]),
  );

  return document([csvLine(ISSUE_COLUMNS), ...lines]);
}
