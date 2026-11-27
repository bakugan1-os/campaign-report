import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCampaignCsv, parseMoney } from '../src/parse.js';

function rowsOf(text: string, amountColumn: 'spend' | 'revenue' = 'spend') {
  const result = parseCampaignCsv(text, { file: 'spend.csv', amountColumn });
  if (!result.ok) throw new Error(`не очікував фатальної помилки: ${result.error.message}`);
  return result;
}

describe('parseMoney', () => {
  it('читає дріб через точку в мінорні одиниці', () => {
    expect(parseMoney('1200.50')).toEqual({ ok: true, minor: 120050 });
  });

  it('читає дріб через кому', () => {
    expect(parseMoney('1234,50')).toEqual({ ok: true, minor: 123450 });
  });

  it('читає цілі числа без дробової частини', () => {
    expect(parseMoney('750')).toEqual({ ok: true, minor: 75000 });
  });

  it('читає один знак після коми', () => {
    expect(parseMoney('10.5')).toEqual({ ok: true, minor: 1050 });
  });

  it('читає мінус і плюс', () => {
    expect(parseMoney('-50.00')).toEqual({ ok: true, minor: -5000 });
    expect(parseMoney('+10.00')).toEqual({ ok: true, minor: 1000 });
  });

  it('не губить точність на великих сумах', () => {
    expect(parseMoney('99999999.99')).toEqual({ ok: true, minor: 9999999999 });
  });

  it('обрізає пробіли по краях', () => {
    expect(parseMoney('  12.00  ')).toEqual({ ok: true, minor: 1200 });
  });

  it('порожня сума - помилка', () => {
    expect(parseMoney('')).toEqual({ ok: false, message: 'порожня сума' });
    expect(parseMoney('   ')).toEqual({ ok: false, message: 'порожня сума' });
  });

  it('не число - помилка з початковим значенням', () => {
    expect(parseMoney('abc')).toEqual({ ok: false, message: 'сума не число: "abc"' });
  });

  it('розділювач тисяч не підтримується', () => {
    expect(parseMoney('1 234.00')).toEqual({ ok: false, message: 'сума не число: "1 234.00"' });
    expect(parseMoney('1.234,50')).toEqual({ ok: false, message: 'сума не число: "1.234,50"' });
  });

  it('більше 2 знаків після коми - помилка, без тихого округлення', () => {
    expect(parseMoney('10.555')).toEqual({
      ok: false,
      message: 'більше 2 знаків після коми: "10.555"',
    });
  });
});

describe('parseCampaignCsv', () => {
  it('читає розділювач "," і дріб через точку', () => {
    const result = rowsOf('campaign,spend\nwinter-sale,1200.50\nblack-friday,3400.00\n');
    expect(result.rows).toEqual([
      { campaign: 'winter-sale', amountMinor: 120050 },
      { campaign: 'black-friday', amountMinor: 340000 },
    ]);
    expect(result.issues).toEqual([]);
  });

  it('читає розділювач ";" і дріб через кому', () => {
    const result = rowsOf('campaign;spend\nwinter-sale;1234,50\nblack-friday;999,99\n');
    expect(result.rows).toEqual([
      { campaign: 'winter-sale', amountMinor: 123450 },
      { campaign: 'black-friday', amountMinor: 99999 },
    ]);
  });

  it('читає BOM і CRLF (експорт з Excel на Windows)', () => {
    const result = rowsOf('﻿campaign;spend\r\nwinter-sale;1500,00\r\nblack-friday;2000,00\r\n');
    expect(result.rows).toEqual([
      { campaign: 'winter-sale', amountMinor: 150000 },
      { campaign: 'black-friday', amountMinor: 200000 },
    ]);
    expect(result.issues).toEqual([]);
  });

  it('читає фікстуру з BOM і CRLF з диска', () => {
    const text = readFileSync(new URL('../fixtures/bom-crlf/spend.csv', import.meta.url), 'utf8');
    const result = rowsOf(text);
    expect(result.rows).toEqual([
      { campaign: 'winter-sale', amountMinor: 150000 },
      { campaign: 'black-friday', amountMinor: 200000 },
    ]);
    expect(result.issues).toEqual([]);
  });

  it('зрізає BOM, навіть коли заголовок у лапках', () => {
    const result = rowsOf('﻿"campaign";"spend"\r\n"winter-sale";"1500,00"\r\n');
    expect(result.rows).toEqual([{ campaign: 'winter-sale', amountMinor: 150000 }]);
    expect(result.issues).toEqual([]);
  });

  it('тримає коми і лапки в назвах', () => {
    const result = rowsOf(
      'campaign,spend\n"Autumn, Winter",100.00\n"Brand ""Hero"" push",200.00\npromo | retargeting,300.00\n',
    );
    expect(result.rows.map((r) => r.campaign)).toEqual([
      'Autumn, Winter',
      'Brand "Hero" push',
      'promo | retargeting',
    ]);
  });

  it('обрізає пробіли по краях назви, але не всередині', () => {
    const result = rowsOf('campaign,spend\n  black  friday  ,100.00\n');
    expect(result.rows).toEqual([{ campaign: 'black  friday', amountMinor: 10000 }]);
  });

  it('не зводить дублікати - це робота aggregate', () => {
    const result = rowsOf('campaign,spend\nblack-friday,100.00\nblack-friday,250.00\n');
    expect(result.rows).toEqual([
      { campaign: 'black-friday', amountMinor: 10000 },
      { campaign: 'black-friday', amountMinor: 25000 },
    ]);
  });

  it('знаходить колонки за назвою, не за позицією', () => {
    const result = rowsOf('spend,currency,campaign\n1000.00,UAH,winter-sale\n');
    expect(result.rows).toEqual([{ campaign: 'winter-sale', amountMinor: 100000 }]);
  });

  it('ігнорує регістр і пробіли в заголовку та зайві колонки', () => {
    const result = rowsOf('  Campaign , SPEND ,currency\nwinter-sale,1000.00,UAH\n');
    expect(result.rows).toEqual([{ campaign: 'winter-sale', amountMinor: 100000 }]);
    expect(result.issues).toEqual([]);
  });

  it('читає колонку revenue у файлі доходів', () => {
    const result = parseCampaignCsv('campaign,revenue\nwinter-sale,2400.00\n', {
      file: 'revenue.csv',
      amountColumn: 'revenue',
    });
    expect(result).toEqual({
      ok: true,
      rows: [{ campaign: 'winter-sale', amountMinor: 240000 }],
      issues: [],
    });
  });

  it('пропускає порожні рядки, не збиваючи нумерацію', () => {
    const result = rowsOf('campaign,spend\nwinter-sale,1000.00\n\nblack-friday,abc\n');
    expect(result.rows).toEqual([{ campaign: 'winter-sale', amountMinor: 100000 }]);
    expect(result.issues).toEqual([
      { file: 'spend.csv', line: 4, kind: 'помилка', message: 'сума не число: "abc"' },
    ]);
  });

  it('немає потрібної колонки - фатальна помилка з назвою файлу', () => {
    expect(parseCampaignCsv('campaign,cost\nwinter-sale,100.00\n', {
      file: 'spend.csv',
      amountColumn: 'spend',
    })).toEqual({
      ok: false,
      error: { file: 'spend.csv', kind: 'помилка', message: 'немає колонки "spend"' },
    });
  });

  it('немає колонки campaign - фатальна помилка', () => {
    expect(parseCampaignCsv('name,spend\nwinter-sale,100.00\n', {
      file: 'spend.csv',
      amountColumn: 'spend',
    })).toEqual({
      ok: false,
      error: { file: 'spend.csv', kind: 'помилка', message: 'немає колонки "campaign"' },
    });
  });

  it('порожній файл - попередження, не помилка', () => {
    const result = rowsOf('');
    expect(result.rows).toEqual([]);
    expect(result.issues).toEqual([
      { file: 'spend.csv', kind: 'попередження', message: 'порожній файл' },
    ]);
  });

  it('тільки заголовок - попередження', () => {
    const result = rowsOf('campaign,spend\n');
    expect(result.rows).toEqual([]);
    expect(result.issues).toEqual([
      { file: 'spend.csv', kind: 'попередження', message: 'немає рядків з даними' },
    ]);
  });

  it('збирає биті рядки з номерами рядків як у фікстурі broken-rows', () => {
    const text = readFileSync(
      new URL('../fixtures/broken-rows/spend.csv', import.meta.url),
      'utf8',
    );
    const result = rowsOf(text);

    expect(result.rows).toEqual([
      { campaign: 'winter-sale', amountMinor: 100000 },
      { campaign: 'winter-sale', amountMinor: 25000 },
    ]);
    expect(result.issues).toEqual([
      { file: 'spend.csv', line: 3, kind: 'помилка', message: 'порожня сума' },
      { file: 'spend.csv', line: 4, kind: 'помилка', message: 'сума не число: "abc"' },
      { file: 'spend.csv', line: 5, kind: 'помилка', message: 'порожня назва кампанії' },
      { file: 'spend.csv', line: 6, kind: 'помилка', message: 'порожня назва кампанії' },
      {
        file: 'spend.csv',
        line: 7,
        kind: 'помилка',
        message: 'більше 2 знаків після коми: "10.555"',
      },
      {
        file: 'spend.csv',
        line: 9,
        kind: 'помилка',
        message: 'замало полів: 1, у заголовку 2',
      },
    ]);
  });

  it('збирає биті рядки з файлу доходів broken-rows', () => {
    const text = readFileSync(
      new URL('../fixtures/broken-rows/revenue.csv', import.meta.url),
      'utf8',
    );
    const result = parseCampaignCsv(text, { file: 'revenue.csv', amountColumn: 'revenue' });
    expect(result).toEqual({
      ok: true,
      rows: [
        { campaign: 'winter-sale', amountMinor: 300000 },
        { campaign: 'brand-awareness', amountMinor: 200000 },
      ],
      issues: [
        { file: 'revenue.csv', line: 3, kind: 'помилка', message: 'сума не число: "1 234.00"' },
      ],
    });
  });

  it('лапка всередині поля без лапок: битий рядок у звіт, решта файлу читається', () => {
    const result = rowsOf('campaign,spend\nAkcia "VIP",100\nwinter-sale,50.00\n');
    expect(result.rows).toEqual([{ campaign: 'winter-sale', amountMinor: 5000 }]);
    expect(result.issues).toEqual([
      { file: 'spend.csv', line: 2, kind: 'помилка', message: 'лапка всередині поля без лапок' },
    ]);
  });

  it('незакрита лапка не валить запуск', () => {
    const result = rowsOf('campaign,spend\n"Promo,100\n');
    expect(result.rows).toEqual([]);
    // Незакрита лапка з'їдає файл до кінця, тому номер рядка - там, де обірвалось.
    expect(result.issues).toEqual([
      { file: 'spend.csv', line: 2, kind: 'помилка', message: 'лапка не закрита' },
    ]);
  });

  it('незакрита лапка не з\'їдає рядки до себе', () => {
    const result = rowsOf('campaign,spend\nwinter-sale,50.00\n"Promo,100\n');
    expect(result.rows).toEqual([{ campaign: 'winter-sale', amountMinor: 5000 }]);
    expect(result.issues).toEqual([
      { file: 'spend.csv', line: 3, kind: 'помилка', message: 'лапка не закрита' },
    ]);
  });

  it('пробіл перед лапкою не валить запуск', () => {
    const result = rowsOf('campaign;spend\nPromo; "100,5"\nwinter-sale;50,00\n');
    expect(result.rows).toEqual([{ campaign: 'winter-sale', amountMinor: 5000 }]);
    expect(result.issues).toEqual([
      { file: 'spend.csv', line: 2, kind: 'помилка', message: 'лапка всередині поля без лапок' },
    ]);
  });

  it('не дублює помилку, коли csv-parse скаржиться на рядок двічі', () => {
    const result = rowsOf('campaign,spend\nAkcia "VIP",100\n');
    expect(result.issues).toHaveLength(1);
  });

  it('биті лапки і биті суми лишаються в порядку рядків', () => {
    const result = rowsOf('campaign,spend\nA,abc\nB "x",100\nC,50.00\n');
    expect(result.rows).toEqual([{ campaign: 'C', amountMinor: 5000 }]);
    expect(result.issues.map((issue) => issue.line)).toEqual([2, 3]);
  });

  it('забагато полів - помилка з підказкою про дріб через кому', () => {
    const result = rowsOf('campaign,spend\nPromo,1,5\n');
    expect(result.rows).toEqual([]);
    expect(result.issues).toEqual([
      {
        file: 'spend.csv',
        line: 2,
        kind: 'помилка',
        message: 'забагато полів: 3, у заголовку 2 (дріб через кому треба брати в лапки)',
      },
    ]);
  });

  it('забагато полів: назва кампанії не зсувається, коли колонка суми перша', () => {
    const result = rowsOf('spend,campaign\n1,5,Promo\n');
    expect(result.rows).toEqual([]);
    expect(result.issues[0]?.message).toContain('забагато полів: 3, у заголовку 2');
  });

  it('дозволяє мінусові суми в рядках', () => {
    const result = rowsOf('campaign,spend\ncashback-test,-150.00\ncashback-test,350.00\n');
    expect(result.rows).toEqual([
      { campaign: 'cashback-test', amountMinor: -15000 },
      { campaign: 'cashback-test', amountMinor: 35000 },
    ]);
  });
});
