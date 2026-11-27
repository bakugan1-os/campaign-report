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

  // У колонку суми інколи потрапляє довгий ID кампанії: Number() тихо загубив би
  // молодші цифри, а не поскаржився.
  const whole = (match[2] ?? '0').replace(/^0+(?=\d)/, '');
  if (whole.length + fraction.length > 15) {
    return { ok: false, message: `сума довша за 15 цифр: "${text}"` };
  }

  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  // 15 цифр без копійок дають 17 цифр мінорних одиниць - це вже за межею точних цілих.
  if (!Number.isSafeInteger(minor)) {
    return { ok: false, message: `сума завелика для точного підрахунку: "${text}"` };
  }

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

/**
 * Декодуємо строго. Excel з українською локаллю зберігає CSV у Windows-1251,
 * а нестроге читання зробило б з кирилиці ромбики і зліпило різні кампанії в одну
 * з однаковою назвою - тобто тихо неправильні цифри без жодного попередження.
 */
export function decodeUtf8(
  bytes: Uint8Array,
): { ok: true; text: string } | { ok: false; message: string } {
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, message: 'файл не в UTF-8, збережіть як CSV UTF-8' };
  }
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

/**
 * Excel \u0456\u043D\u043A\u043E\u043B\u0438 \u043F\u0438\u0448\u0435 \u043F\u0435\u0440\u0435\u0434 \u0442\u0430\u0431\u043B\u0438\u0446\u0435\u044E \u0440\u044F\u0434\u043E\u043A sep=; - \u0442\u043E\u0434\u0456 \u0440\u043E\u0437\u0434\u0456\u043B\u044E\u0432\u0430\u0447 \u043E\u0433\u043E\u043B\u043E\u0448\u0435\u043D\u0438\u0439,
 * \u0430 \u043D\u0435 \u0432\u0433\u0430\u0434\u0430\u043D\u0438\u0439. \u0421\u0430\u043C \u0440\u044F\u0434\u043E\u043A \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u0454\u043C\u043E \u0447\u0435\u0440\u0435\u0437 from_line, \u0449\u043E\u0431 \u043D\u043E\u043C\u0435\u0440\u0438 \u0440\u044F\u0434\u043A\u0456\u0432
 * \u0443 \u0437\u0432\u0456\u0442\u0456 \u043F\u043E\u043C\u0438\u043B\u043E\u043A \u043B\u0438\u0448\u0438\u043B\u0438\u0441\u044C \u0442\u0430\u043A\u0438\u043C\u0438, \u044F\u043A \u0443 \u0444\u0430\u0439\u043B\u0456.
 */
const SEP_PREAMBLE = /^sep=([,;])\r?\n/i;

function readDelimiter(body: string): { delimiter: ',' | ';'; fromLine: number } {
  const declared = SEP_PREAMBLE.exec(body)?.[1];
  if (declared === ',' || declared === ';') return { delimiter: declared, fromLine: 2 };
  return { delimiter: sniffDelimiter(body), fromLine: 1 };
}

export function parseCampaignCsv(text: string, options: ParseOptions): ParseResult {
  const { file, amountColumn } = options;
  const body = text.replace(/^\uFEFF/, '');

  if (body.trim() === '') {
    return {
      ok: true,
      rows: [],
      issues: [{ file, kind: 'попередження', message: 'порожній файл' }],
    };
  }

  // Биті лапки не повинні валити запуск: csv-parse пропускає такий запис,
  // ми кладемо його в звіт помилок і читаємо файл далі.
  const broken: Issue[] = [];
  // Незакрита лапка з'їдає файл до кінця - далі читати нічого, це фатально.
  let quoteNotClosed = false;
  const { delimiter, fromLine } = readDelimiter(body);
  let records: RawRecord[];
  try {
    records = parse(text, {
      delimiter,
      from_line: fromLine,
      bom: true,
      info: true,
      relax_column_count: true,
      skip_empty_lines: true,
      skip_records_with_error: true,
      on_skip: (error) => {
        if ((error as { code?: unknown } | null | undefined)?.code === 'CSV_QUOTE_NOT_CLOSED') {
          quoteNotClosed = true;
          return undefined;
        }
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

  if (quoteNotClosed) {
    // Рядок обриву не кажемо: він у кінці файлу. Кажемо, де лапка відкрилась.
    const lastGoodLine = records.at(-1)?.info.lines ?? 0;
    return {
      ok: false,
      error: {
        file,
        line: lastGoodLine + 1,
        kind: 'помилка',
        message: 'лапка не закрита, файл далі не читається',
      },
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

  // Дубль потрібної колонки - це не вибір "беремо першу", а невідомо який файл.
  for (const name of ['campaign', amountColumn]) {
    if (columns.indexOf(name) !== columns.lastIndexOf(name)) {
      return {
        ok: false,
        error: { file, kind: 'помилка', message: `колонка "${name}" у заголовку двічі` },
      };
    }
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
