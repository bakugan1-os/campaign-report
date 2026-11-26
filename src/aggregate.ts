import type { Issue, ParsedRow } from './types.js';

export interface ReportRow {
  /** Написання назви, яке трапилось першим: спершу файл витрат, потім файл доходів. */
  campaign: string;
  spendMinor: number;
  revenueMinor: number;
  /** null коли витрати <= 0 - ROI не визначений, у виводі "-". */
  roiPercent: number | null;
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

/** ROI у відсотках, без округлення. Округлення - робота format. */
function roiPercent(spendMinor: number, revenueMinor: number): number | null {
  if (spendMinor <= 0) return null;
  return ((revenueMinor - spendMinor) / spendMinor) * 100;
}

export function aggregate(
  spendRows: readonly ParsedRow[],
  revenueRows: readonly ParsedRow[],
): Report {
  const buckets = new Map<string, Bucket>();

  const collect = (rows: readonly ParsedRow[], field: 'spendMinor' | 'revenueMinor'): void => {
    for (const parsed of rows) {
      const name = parsed.campaign.trim();
      const key = name.toLowerCase();

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
        campaign: bucket.spellings[0] ?? '',
        spendMinor: bucket.spendMinor,
        revenueMinor: bucket.revenueMinor,
        roiPercent: roiPercent(bucket.spendMinor, bucket.revenueMinor),
      } satisfies ReportRow,
    }))
    .sort((a, b) => a.row.campaign.localeCompare(b.row.campaign, 'uk'));

  const rows = entries.map((entry) => entry.row);

  const issues: Issue[] = entries
    .filter((entry) => entry.bucket.spellings.length > 1)
    .map((entry) => ({
      kind: 'попередження',
      message: `злито: ${entry.bucket.spellings.join(', ')}`,
    }));

  const spendMinor = rows.reduce((sum, item) => sum + item.spendMinor, 0);
  const revenueMinor = rows.reduce((sum, item) => sum + item.revenueMinor, 0);

  return {
    rows,
    total: { spendMinor, revenueMinor, roiPercent: roiPercent(spendMinor, revenueMinor) },
    issues,
  };
}
