import type { Issue, ParsedRow } from './types.js';

export interface ReportRow {
  /** Написання назви, яке трапилось першим: спершу файл витрат, потім файл доходів. */
  campaign: string;
  spendMinor: number;
  revenueMinor: number;
  /** false коли витрати <= 0 - ROI не визначений, у виводі "-". Саме число рахує format. */
  roiDefined: boolean;
}

export type TotalRow = Omit<ReportRow, 'campaign'>;

export interface Report {
  rows: ReportRow[];
  total: TotalRow;
  issues: Issue[];
}

interface Bucket {
  /** Різні написання однієї назви, в порядку першої появи. */
  spellings: string[];
  spendMinor: number;
  revenueMinor: number;
}

/**
 * Ключ злиття назв. На вигляд однакові назви приходять по-різному:
 * NFD замість NFC, нерозривний пробіл, невидимі символи, три різні апострофи.
 * Саме написання лишаємо як є - у звіт іде те, що трапилось першим.
 */
function cleanName(name: string): string {
  return name
    .normalize('NFC')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function mergeKey(name: string): string {
  return cleanName(name).replace(/[\u0060\u02BC\u2018\u2019]/g, "'").toLowerCase();
}

/**
 * Невидиму різницю між написаннями показуємо кодом, інакше попередження
 * виглядає як "злито: Йога, Йога".
 */
function withVisibleCodes(name: string): string {
  return name.replace(
    /[\u00A0\u200B-\u200D\uFEFF\u0300-\u036F]/g,
    (char) => `<U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}>`,
  );
}

/** ROI визначений лише при додатних витратах: інакше ділення на нуль або безглуздий знак. */
function isRoiDefined(spendMinor: number): boolean {
  return spendMinor > 0;
}

export function aggregate(
  spendRows: readonly ParsedRow[],
  revenueRows: readonly ParsedRow[],
): Report {
  const buckets = new Map<string, Bucket>();

  const collect = (rows: readonly ParsedRow[], field: 'spendMinor' | 'revenueMinor'): void => {
    for (const parsed of rows) {
      const name = parsed.campaign.trim();
      const key = mergeKey(name);

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { spellings: [], spendMinor: 0, revenueMinor: 0 };
        buckets.set(key, bucket);
      }
      if (!bucket.spellings.includes(name)) bucket.spellings.push(name);
      bucket[field] += parsed.amountMinor;
    }
  };

  collect(spendRows, 'spendMinor');
  collect(revenueRows, 'revenueMinor');

  const entries = [...buckets.values()]
    .map((bucket) => ({
      bucket,
      row: {
        campaign: cleanName(bucket.spellings[0] ?? ''),
        spendMinor: bucket.spendMinor,
        revenueMinor: bucket.revenueMinor,
        roiDefined: isRoiDefined(bucket.spendMinor),
      } satisfies ReportRow,
    }))
    .sort((a, b) => a.row.campaign.localeCompare(b.row.campaign, 'uk'));

  const rows = entries.map((entry) => entry.row);

  const issues: Issue[] = entries
    .filter((entry) => entry.bucket.spellings.length > 1)
    .map((entry) => ({
      kind: 'попередження',
      message: `злито: ${entry.bucket.spellings.map(withVisibleCodes).join(', ')}`,
    }));

  const spendMinor = rows.reduce((sum, item) => sum + item.spendMinor, 0);
  const revenueMinor = rows.reduce((sum, item) => sum + item.revenueMinor, 0);

  return {
    rows,
    total: { spendMinor, revenueMinor, roiDefined: isRoiDefined(spendMinor) },
    issues,
  };
}
