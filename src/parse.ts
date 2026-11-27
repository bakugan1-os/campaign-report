import { parse, type Info } from 'csv-parse/sync';
import type { AmountColumn, Issue, ParsedRow } from './types.js';

export type MoneyResult = { ok: true; minor: number } | { ok: false; message: string };

export interface ParseOptions {
  /** Імʼя файлу для звіту помилок. */
  file: string;
  amountColumn: AmountColumn;
}

export type ParseResult =
  | { ok: true; rows: ParsedRow[]; issues: Issue[] }
  | { ok: false; error: Issue };

/** Ціла частина, необовʼязкова дробова через "." або ",". Пробіли всередині не допускаються. */
const AMOUNT_PATTERN = /^([+-]?)(\d+)(?:[.,](\d+))?$/;

/** Сума з CSV у мінорні одиниці. Округлення немає: зайві знаки - помилка. */
export function parseMoney(raw: string): MoneyResult {
  const text = raw.trim();
  if (text === '') return { ok: false, message: 'порожня сума' };

  const match = AMOUNT_PATTERN.exec(text);
  if (!match) return { ok: false, message: `сума не число: "${text}"` };

  const fraction = match[3] ?? '';
  if (fraction.length > 2) {
    return { ok: false, message: `більше 2 знаків після коми: "${text}"` };
  }

  const minor = Number(match[2] ?? '0') * 100 + Number(fraction.padEnd(2, '0'));
  return { ok: true, minor: match[1] === '-' ? -minor : minor };
}

/**
 * Розділювач визначаємо по заголовку: що частіше поза лапками, те й розділювач.
 * Далі весь файл читає csv-parse.
 */
function sniffDelimiter(text: string): ',' | ';' {
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;

  for (const char of text) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (char === '\n') break;
    if (char === ',') commas += 1;
    else if (char === ';') semicolons += 1;
  }

  return semicolons > commas ? ';' : ',';
}

interface RawRecord {
  record: string[];
  info: Info;
}

/** Назви, під якими у вивантаженнях приходить рядок підсумку, а не кампанія. */
const TOTAL_ROW_NAMES = new Set(['total', 'разом', 'всього', 'итого']);

/** Коди csv-parse людською мовою. Невідомий код лишаємо в тексті для діагностики. */
const CSV_ERROR_MESSAGES: Record<string, string> = {
  INVALID_OPENING_QUOTE: 'лапка всередині поля без лапок',
  CSV_QUOTE_NOT_CLOSED: 'лапка не закрита',
  CSV_INVALID_CLOSING_QUOTE: 'лапка в полі не продубльована',
};

function csvErrorLine(error: unknown): number | undefined {
  const lines = (error as { lines?: unknown } | null | undefined)?.lines;
  return typeof lines === 'number' ? lines : undefined;
}

function csvErrorText(error: unknown): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code !== 'string') return 'битий рядок CSV';
  return CSV_ERROR_MESSAGES[code] ?? `битий рядок CSV: ${code}`;
}

export function parseCampaignCsv(text: string, options: ParseOptions): ParseResult {
  const { file, amountColumn } = options;

  if (text.replace(/^﻿/, '').trim() === '') {
    return {
      ok: true,
      rows: [],
      issues: [{ file, kind: 'попередження', message: 'порожній файл' }],
    };
  }

  // Биті лапки не повинні валити запуск: csv-parse пропускає такий запис,
  // ми кладемо його в звіт помилок і читаємо файл далі.
  const broken: Issue[] = [];
  let records: RawRecord[];
  try {
    records = parse(text, {
      delimiter: sniffDelimiter(text),
      bom: true,
      info: true,
      relax_column_count: true,
      skip_empty_lines: true,
      skip_records_with_error: true,
      on_skip: (error) => {
        const issue: Issue = {
          file,
          line: csvErrorLine(error),
          kind: 'помилка',
          message: csvErrorText(error),
        };
        // csv-parse інколи скаржиться на той самий запис двічі.
        const last = broken.at(-1);
        const repeat =
          last !== undefined && last.line === issue.line && last.message === issue.message;
        if (!repeat) broken.push(issue);
        return undefined;
      },
      // Типи csv-parse не описують info: true в режимі масивів, звідси приведення.
    }) as unknown as RawRecord[];
  } catch (error) {
    return {
      ok: false,
      error: { file, kind: 'помилка', message: `не можу прочитати CSV: ${csvErrorText(error)}` },
    };
  }

  const header = records[0];
  if (!header) {
    return {
      ok: true,
      rows: [],
      issues: [{ file, kind: 'попередження', message: 'немає рядків з даними' }],
    };
  }

  const columns = header.record.map((name) => name.trim().toLowerCase());
  const campaignIndex = columns.indexOf('campaign');
  if (campaignIndex === -1) {
    return { ok: false, error: { file, kind: 'помилка', message: 'немає колонки "campaign"' } };
  }
  const amountIndex = columns.indexOf(amountColumn);
  if (amountIndex === -1) {
    return {
      ok: false,
      error: { file, kind: 'помилка', message: `немає колонки "${amountColumn}"` },
    };
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length === 0) {
    // Якщо всі рядки з даними були биті, це не "немає рядків", а звіт помилок.
    return {
      ok: true,
      rows: [],
      issues:
        broken.length > 0
          ? broken
          : [{ file, kind: 'попередження', message: 'немає рядків з даними' }],
    };
  }

  const rows: ParsedRow[] = [];
  const issues: Issue[] = [];

  for (const { record, info } of dataRecords) {
    const line = info.lines;

    // Зайве поле найчастіше означає дріб через кому у файлі з розділювачем кома.
    if (record.length > columns.length) {
      issues.push({
        file,
        line,
        kind: 'помилка',
        message:
          `забагато полів: ${record.length}, у заголовку ${columns.length}` +
          ' (дріб через кому треба брати в лапки)',
      });
      continue;
    }

    if (record.length < columns.length) {
      issues.push({
        file,
        line,
        kind: 'помилка',
        message: `замало полів: ${record.length}, у заголовку ${columns.length}`,
      });
      continue;
    }

    const campaign = (record[campaignIndex] ?? '').trim();
    if (campaign === '') {
      issues.push({ file, line, kind: 'помилка', message: 'порожня назва кампанії' });
      continue;
    }

    // Підсумок з вивантаження не кампанія: інакше він подвоїв би загальну суму.
    if (TOTAL_ROW_NAMES.has(campaign.toLowerCase())) {
      issues.push({
        file,
        line,
        kind: 'попередження',
        message: `пропущено рядок підсумку: "${campaign}"`,
      });
      continue;
    }

    const amount = parseMoney(record[amountIndex] ?? '');
    if (!amount.ok) {
      issues.push({ file, line, kind: 'помилка', message: amount.message });
      continue;
    }

    rows.push({ campaign, amountMinor: amount.minor });
  }

  return { ok: true, rows, issues: sortByLine([...broken, ...issues]) };
}

/** Проблеми в порядку рядків файлу: биті записи приходять від csv-parse окремо від решти. */
function sortByLine(issues: readonly Issue[]): Issue[] {
  return [...issues].sort((first, second) => (first.line ?? 0) - (second.line ?? 0));
}
