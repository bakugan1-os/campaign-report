import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const CLI = 'dist/cli.js';

const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

/** Папки без помилок не мають expected-errors.txt: там stderr має бути порожній. */
const expectedErrors = (folder: string): string => {
  const path = `fixtures/${folder}/expected-errors.txt`;
  return existsSync(path) ? read(path) : '';
};

interface RunResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

function run(args: readonly string[]): RunResult {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status };
}

function runFolder(folder: string, format: 'csv' | 'md', extra: readonly string[] = []): RunResult {
  return run([
    '--spend',
    `fixtures/${folder}/spend.csv`,
    '--revenue',
    `fixtures/${folder}/revenue.csv`,
    '--format',
    format,
    ...extra,
  ]);
}

const workDir = mkdtempSync(join(tmpdir(), 'campaign-report-e2e-'));
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const folders = [
  'basic',
  'bom-crlf',
  'broken-rows',
  'commas-in-names',
  'duplicates',
  'empty-file',
  'only-in-one-file',
  'semicolon-decimal-comma',
  'zero-spend',
];

describe.each(folders)('e2e %s', (folder) => {
  it('csv у stdout, звіт помилок у stderr', () => {
    const result = runFolder(folder, 'csv');
    expect(result.stderr).toBe(expectedErrors(folder));
    expect(result.stdout).toBe(read(`fixtures/${folder}/expected.csv`));
    expect(result.status).toBe(0);
  });

  it('md у stdout', () => {
    const result = runFolder(folder, 'md');
    expect(result.stdout).toBe(read(`fixtures/${folder}/expected.md`));
    expect(result.status).toBe(0);
  });
});

describe('e2e missing-column', () => {
  it('фатальна помилка: код 1, stdout порожній, причина в stderr', () => {
    const result = runFolder('missing-column', 'csv');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(read('fixtures/missing-column/expected-errors.txt'));
  });

  it('при фатальній помилці не створює ні звіту, ні errors.csv', () => {
    const out = join(workDir, 'fatal.csv');
    const result = runFolder('missing-column', 'csv', ['--out', out]);
    expect(result.status).toBe(1);
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.errors.csv`)).toBe(false);
  });
});

describe('e2e --out', () => {
  it('пише звіт у файл, а не в stdout', () => {
    const out = join(workDir, 'basic.csv');
    const result = runFolder('basic', 'csv', ['--out', out]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(read(out)).toBe(read('fixtures/basic/expected.csv'));
  });

  it('у stderr короткий підсумок, а деталі у <out>.errors.csv', () => {
    const out = join(workDir, 'broken.csv');
    const result = runFolder('broken-rows', 'csv', ['--out', out]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Пропущено рядків: 7');
    expect(result.stderr).toContain('broken.csv.errors.csv');
    expect(read(`${out}.errors.csv`)).toBe(read('fixtures/broken-rows/expected-errors.csv'));
  });

  it('другий запуск без помилок не лишає старих помилок у <out>.errors.csv', () => {
    const out = join(workDir, 'twice.csv');
    const errorsPath = `${out}.errors.csv`;

    const first = runFolder('broken-rows', 'csv', ['--out', out]);
    expect(first.status).toBe(0);
    expect(read(errorsPath)).toBe(read('fixtures/broken-rows/expected-errors.csv'));

    const second = runFolder('basic', 'csv', ['--out', out]);
    expect(second.status).toBe(0);
    expect(read(out)).toBe(read('fixtures/basic/expected.csv'));
    expect(read(errorsPath)).toBe('file,line,type,message\n');
    expect(second.stderr).toBe('');
  });

  it('попередження теж доходять до errors.csv', () => {
    const out = join(workDir, 'merged.csv');
    const result = runFolder('duplicates', 'csv', ['--out', out]);
    expect(result.status).toBe(0);
    expect(read(`${out}.errors.csv`)).toBe(read('fixtures/duplicates/expected-errors.csv'));
    expect(result.stderr).toContain('Пропущено рядків: 0');
  });
});

describe('e2e битий CSV', () => {
  it('лапка в полі: exit 1 без stack trace, звіту немає', () => {
    const spend = join(workDir, 'quote-spend.csv');
    const revenue = join(workDir, 'quote-revenue.csv');
    writeFileSync(spend, 'campaign,spend\nAkcia "VIP",100\nwinter-sale,50.00\n', 'utf8');
    writeFileSync(revenue, 'campaign,revenue\nwinter-sale,100.00\n', 'utf8');

    const result = run(['--spend', spend, '--revenue', revenue, '--format', 'csv']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('at ');
    expect(result.stderr).not.toContain('CsvError');
    expect(result.stderr).toBe(
      'quote-spend.csv:2: помилка лапок (лапка всередині поля без лапок),' +
        ' виявлено в рядку 2; файл не прочитано\n',
    );
  });

  it('незакрита лапка: exit 1, без звіту і без errors.csv', () => {
    const spend = join(workDir, 'unclosed-spend.csv');
    const revenue = join(workDir, 'unclosed-revenue.csv');
    const out = join(workDir, 'unclosed.csv');
    writeFileSync(
      spend,
      'campaign,spend\nwinter-sale,50.00\n"Promo,100\nblack-friday,10.00\n',
      'utf8',
    );
    writeFileSync(revenue, 'campaign,revenue\nwinter-sale,100.00\n', 'utf8');

    const result = run(['--spend', spend, '--revenue', revenue, '--format', 'csv', '--out', out]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'unclosed-spend.csv:4: помилка лапок (лапка не закрита),' +
        ' виявлено в рядку 4; файл не прочитано\n',
    );
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.errors.csv`)).toBe(false);
  });

  it('зайва лапка не дає часткового звіту з тихо втраченими грошима', () => {
    const spend = join(workDir, 'swallow-spend.csv');
    const revenue = join(workDir, 'swallow-revenue.csv');
    writeFileSync(spend, 'campaign,spend\n"Akcia,100\nPromo,50\n"Other",30\nLast,10\n', 'utf8');
    writeFileSync(revenue, 'campaign,revenue\nLast,100.00\n', 'utf8');

    const result = run(['--spend', spend, '--revenue', revenue, '--format', 'csv']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('помилка лапок');
  });
});

describe('e2e кодування', () => {
  it('файл не в UTF-8: exit 1 з підказкою, без ромбиків у звіті', () => {
    const spend = join(workDir, 'cp1251-spend.csv');
    const revenue = join(workDir, 'cp1251-revenue.csv');
    writeFileSync(
      spend,
      Buffer.concat([
        Buffer.from('campaign,spend\n'),
        Buffer.from([0xc0, 0xea, 0xf6, 0xb3, 0xff]),
        Buffer.from(',100\n'),
      ]),
    );
    writeFileSync(revenue, 'campaign,revenue\nPromo,200.00\n', 'utf8');

    const result = run(['--spend', spend, '--revenue', revenue, '--format', 'csv']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('cp1251-spend.csv: файл не в UTF-8, збережіть як CSV UTF-8\n');
  });
});

describe('e2e аргументи', () => {
  it('немає файлу - код 1', () => {
    const result = run([
      '--spend',
      'fixtures/basic/nope.csv',
      '--revenue',
      'fixtures/basic/revenue.csv',
      '--format',
      'csv',
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('nope.csv');
  });

  it('невідомий формат - код 1', () => {
    const result = runFolder('basic', 'xlsx' as 'csv');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
  });

  it('немає --spend - код 1', () => {
    const result = run(['--revenue', 'fixtures/basic/revenue.csv', '--format', 'csv']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--spend');
  });

  it('невідомий прапорець - код 1', () => {
    const result = runFolder('basic', 'csv', ['--verbose', 'yes']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--verbose');
  });

  it('прапорець без значення - код 1', () => {
    const result = run(['--spend', 'fixtures/basic/spend.csv', '--revenue']);
    expect(result.status).toBe(1);
  });

  it('--help - код 0 і підказка', () => {
    const result = run(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--spend');
    expect(result.stdout).toContain('--format md|csv');
  });
});
