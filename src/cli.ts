#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { aggregate } from './aggregate.js';
import {
  countSkippedRows,
  formatIssuesCsv,
  formatIssuesText,
  formatReport,
  type ReportFormat,
} from './format.js';
import { parseCampaignCsv } from './parse.js';
import type { Issue } from './types.js';

const USAGE =
  'Використання: node dist/cli.js --spend <file> --revenue <file> --format md|csv [--out <file>]';

const FLAGS = ['--spend', '--revenue', '--format', '--out'] as const;
type Flag = (typeof FLAGS)[number];

interface Args {
  spend: string;
  revenue: string;
  format: ReportFormat;
  out?: string;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv: readonly string[]): Args {
  const values = new Map<Flag, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? '';

    if (flag === '--help' || flag === '-h') {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    }
    if (!FLAGS.includes(flag as Flag)) fail(`невідомий аргумент: ${flag}\n${USAGE}`);

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(`аргумент ${flag} без значення\n${USAGE}`);
    }

    values.set(flag as Flag, value);
    index += 1;
  }

  const spend = values.get('--spend');
  const revenue = values.get('--revenue');
  const format = values.get('--format');

  if (spend === undefined) fail(`немає обовʼязкового аргументу --spend\n${USAGE}`);
  if (revenue === undefined) fail(`немає обовʼязкового аргументу --revenue\n${USAGE}`);
  if (format === undefined) fail(`немає обовʼязкового аргументу --format\n${USAGE}`);
  if (format !== 'csv' && format !== 'md') {
    fail(`--format має бути csv або md, а не "${format}"\n${USAGE}`);
  }

  return { spend, revenue, format, out: values.get('--out') };
}

function readFile(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return fail(`не можу прочитати файл: ${path}`);
  }
}

function writeFile(path: string, content: string): void {
  try {
    writeFileSync(path, content, 'utf8');
  } catch {
    fail(`не можу записати файл: ${path}`);
  }
}

const args = parseArgs(process.argv.slice(2));

const spend = parseCampaignCsv(readFile(args.spend), {
  file: basename(args.spend),
  amountColumn: 'spend',
});
const revenue = parseCampaignCsv(readFile(args.revenue), {
  file: basename(args.revenue),
  amountColumn: 'revenue',
});

// Не той файл - це не битий рядок: звіту не буде взагалі, щоб не лишити півстану.
if (!spend.ok || !revenue.ok) {
  const fatal: Issue[] = [];
  if (!spend.ok) fatal.push(spend.error);
  if (!revenue.ok) fatal.push(revenue.error);
  process.stderr.write(formatIssuesText(fatal));
  process.exit(1);
}

const report = aggregate(spend.rows, revenue.rows);
const issues = [...spend.issues, ...revenue.issues, ...report.issues];
const text = formatReport(report, args.format);

if (args.out === undefined) {
  process.stdout.write(text);
  process.stderr.write(formatIssuesText(issues));
} else {
  const errorsPath = `${args.out}.errors.csv`;
  writeFile(args.out, text);
  writeFile(errorsPath, formatIssuesCsv(issues));
  if (issues.length > 0) {
    process.stderr.write(`Пропущено рядків: ${countSkippedRows(issues)}, деталі: ${errorsPath}\n`);
  }
}
