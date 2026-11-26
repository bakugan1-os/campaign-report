/** Назва колонки з сумою: у файлі витрат - spend, у файлі доходів - revenue. */
export type AmountColumn = 'spend' | 'revenue';

/**
 * Помилка не дає використати рядок, попередження лишає звіт коректним
 * (порожній файл, злиті написання назви).
 */
export type IssueKind = 'помилка' | 'попередження';

export interface Issue {
  /** Імʼя файлу, як його показувати в звіті помилок. */
  file: string;
  /** Номер рядка у файлі, 1-based, заголовок = 1. Немає - проблема рівня файлу. */
  line?: number;
  kind: IssueKind;
  message: string;
}

/** Один прочитаний рядок CSV: назва з обрізаними краями і сума в мінорних одиницях. */
export interface ParsedRow {
  campaign: string;
  amountMinor: number;
}
