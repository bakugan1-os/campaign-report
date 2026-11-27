import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeUtf8, parseCampaignCsv, parseMoney } from '../src/parse.js';

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

  it('сума довша за 15 цифр - помилка рядка', () => {
    // 18-значний ID кампанії в колонці суми раніше тихо ставав 12345678901234567000.44
    expect(parseMoney('12345678901234567890')).toEqual({
      ok: false,
      message: 'сума довша за 15 цифр: "12345678901234567890"',
    });
    expect(parseMoney('12345678901234.56')).toEqual({
      ok: false,
      message: 'сума довша за 15 цифр: "12345678901234.56"',
    });
  });

  it('15 цифр з копійками ще читається точно', () => {
    expect(parseMoney('1234567890123.45')).toEqual({ ok: true, minor: 123456789012345 });
  });

  it('ведучі нулі не вважаються цифрами суми', () => {
    expect(parseMoney('00000000000000000001.00')).toEqual({ ok: true, minor: 100 });
  });

  it('15 цифр без копійок не влазять у точні цілі - помилка', () => {
    expect(parseMoney('999999999999999')).toEqual({
      ok: false,
      message: 'сума завелика для точного підрахунку: "999999999999999"',
    });
  });

  it('більше 2 знаків після коми - помилка, без тихого округлення', () => {
    expect(parseMoney('10.555')).toEqual({
      ok: false,
      message: 'більше 2 знаків після коми: "10.555"',
    });
  });
});

describe('decodeUtf8', () => {
  it('читає UTF-8 з кирилицею', () => {
    expect(decodeUtf8(new TextEncoder().encode('Акція,100'))).toEqual({
      ok: true,
      text: 'Акція,100',
    });
  });

  it('не-UTF-8 (Windows-1251) - помилка, а не ромбики', () => {
    // "Акція" у cp1251: з fatal: false вийшло б "?????" і дві кампанії злились би в одну.
    const cp1251 = new Uint8Array([0xc0, 0xea, 0xf6, 0xb3, 0xff]);
    expect(decodeUtf8(cp1251)).toEqual({
      ok: false,
      message: 'файл не в UTF-8, збережіть як CSV UTF-8',
    });
  });

  it('зрізає BOM', () => {
    expect(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toEqual({ ok: true, text: 'a' });
  });

  it('порожній файл - порожній текст', () => {
    expect(decodeUtf8(new Uint8Array([]))).toEqual({ ok: true, text: '' });
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

  it('дубль колонки суми - фатальна помилка', () => {
    // Раніше мовчки бралась перша: campaign,spend,spend / Promo,0,100 давало 0.00.
    const result = parseCampaignCsv('campaign,spend,spend\nPromo,0,100\n', {
      file: 'spend.csv',
      amountColumn: 'spend',
    });
    expect(result).toEqual({
      ok: false,
      error: { file: 'spend.csv', kind: 'помилка', message: 'колонка "spend" у заголовку двічі' },
    });
  });

  it('дубль колонки через різний регістр теж фатальний', () => {
    const result = parseCampaignCsv('campaign,Spend,spend\nPromo,0,100\n', {
      file: 'spend.csv',
      amountColumn: 'spend',
    });
    expect(result.ok).toBe(false);
  });

  it('дубль колонки campaign - фатальна помилка', () => {
    const result = parseCampaignCsv('campaign,campaign,spend\nA,B,100\n', {
      file: 'spend.csv',
      amountColumn: 'spend',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('колонка "campaign" у заголовку двічі');
  });

  it('дубль колонки, яка нам не потрібна, не чіпаємо', () => {
    const result = rowsOf('campaign,spend,note,note\nPromo,100.00,a,b\n');
    expect(result.rows).toEqual([{ campaign: 'Promo', amountMinor: 10000 }]);
    expect(result.issues).toEqual([]);
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

  it('читає преамбулу sep=; від Excel', () => {
    const result = rowsOf('sep=;\ncampaign;spend\nPromo;100,50\n');
    expect(result.rows).toEqual([{ campaign: 'Promo', amountMinor: 10050 }]);
    expect(result.issues).toEqual([]);
  });

  it('читає преамбулу sep=,', () => {
    const result = rowsOf('sep=,\ncampaign,spend\nPromo,100.50\n');
    expect(result.rows).toEqual([{ campaign: 'Promo', amountMinor: 10050 }]);
    expect(result.issues).toEqual([]);
  });

  it('преамбула sep= не зсуває номери рядків у звіті помилок', () => {
    const result = rowsOf('sep=;\ncampaign;spend\nPromo;abc\n');
    expect(result.issues).toEqual([
      { file: 'spend.csv', line: 3, kind: 'помилка', message: 'сума не число: "abc"' },
    ]);
  });

  it('преамбула sep= разом з BOM і CRLF', () => {
    const result = rowsOf('﻿sep=;\r\ncampaign;spend\r\nPromo;100,50\r\n');
    expect(result.rows).toEqual([{ campaign: 'Promo', amountMinor: 10050 }]);
  });

  it('SEP= у будь-якому регістрі', () => {
    const result = rowsOf('SEP=;\ncampaign;spend\nPromo;100,50\n');
    expect(result.rows).toEqual([{ campaign: 'Promo', amountMinor: 10050 }]);
  });

  it('рядок підсумку з вивантаження пропускається з попередженням', () => {
    const result = rowsOf('campaign,spend\nPromo,100.00\nTotal,100.00\n');
    expect(result.rows).toEqual([{ campaign: 'Promo', amountMinor: 10000 }]);
    expect(result.issues).toEqual([
      {
        file: 'spend.csv',
        line: 3,
        kind: 'попередження',
        message: 'пропущено рядок підсумку: "Total"',
      },
    ]);
  });

  it('усі варіанти підсумку, регістр і пробіли не важливі', () => {
    const result = rowsOf(
      'campaign,spend\nTOTAL,1.00\nРазом,1.00\nвсього,1.00\nИТОГО,1.00\n  total  ,1.00\n',
    );
    expect(result.rows).toEqual([]);
    expect(result.issues.map((issue) => issue.line)).toEqual([2, 3, 4, 5, 6]);
    expect(result.issues.every((issue) => issue.kind === 'попередження')).toBe(true);
  });

  it('назва, що лише містить total, не пропускається', () => {
    const result = rowsOf('campaign,spend\ntotal-sale,100.00\nsubtotal,50.00\n');
    expect(result.rows).toEqual([
      { campaign: 'total-sale', amountMinor: 10000 },
      { campaign: 'subtotal', amountMinor: 5000 },
    ]);
    expect(result.issues).toEqual([]);
  });

  it('рядок підсумку з битою сумою теж іде як підсумок, а не як не-число', () => {
    const result = rowsOf('campaign,spend\nTotal,abc\n');
    expect(result.issues).toEqual([
      {
        file: 'spend.csv',
        line: 2,
        kind: 'попередження',
        message: 'пропущено рядок підсумку: "Total"',
      },
    ]);
  });

  const parseSpend = (text: string) =>
    parseCampaignCsv(text, { file: 'spend.csv', amountColumn: 'spend' });

  it('лапка всередині поля без лапок - фатальна помилка лапок', () => {
    expect(parseSpend('campaign,spend\nAkcia "VIP",100\nwinter-sale,50.00\n')).toEqual({
      ok: false,
      error: {
        file: 'spend.csv',
        line: 2,
        kind: 'помилка',
        message:
          'помилка лапок (лапка всередині поля без лапок), виявлено в рядку 2; файл не прочитано',
      },
    });
  });

  it('незакрита лапка: рядок виявлення, без обіцянки де вона відкрилась', () => {
    // Лапка з'їдає все до кінця файлу, тому csv-parse спиняється на рядку 4.
    const result = parseSpend('campaign,spend\nwinter,50\n"Promo,100\nblack,10\n');
    expect(result).toEqual({
      ok: false,
      error: {
        file: 'spend.csv',
        line: 4,
        kind: 'помилка',
        message: 'помилка лапок (лапка не закрита), виявлено в рядку 4; файл не прочитано',
      },
    });
  });

  it('сміття після закритої лапки - фатальна помилка лапок', () => {
    const result = parseSpend('campaign,spend\n"Akcia"x,100\n');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe(
        'помилка лапок (лапка в полі не продубльована), виявлено в рядку 2; файл не прочитано',
      );
    }
  });

  it('зайва лапка, що зʼїдає кілька рядків, не дає часткового звіту', () => {
    // Раніше звіт містив лише Last,10.00, а 180 тихо зникали.
    const result = parseSpend('campaign,spend\n"Akcia,100\nPromo,50\n"Other",30\nLast,10\n');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('помилка лапок');
  });

  it('бита лапка в заголовку не маскується під "немає колонки campaign"', () => {
    const result = parseSpend('campaign,sp"end"\nPromo,100\n');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.line).toBe(1);
      expect(result.error.message).toContain('помилка лапок');
    }
  });

  it('пробіл перед лапкою - фатальна помилка лапок', () => {
    const result = parseSpend('campaign;spend\nPromo; "100,5"\nwinter-sale;50,00\n');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('помилка лапок');
  });

  it('порожнє зайве поле в кінці рядка - не помилка', () => {
    // Деякі системи ставлять розділювач у кінці кожного рядка з даними.
    const result = rowsOf('campaign,spend\nPromo,100.00,\nOther,50.00,\n');
    expect(result.rows).toEqual([
      { campaign: 'Promo', amountMinor: 10000 },
      { campaign: 'Other', amountMinor: 5000 },
    ]);
    expect(result.issues).toEqual([]);
  });

  it('кілька порожніх зайвих полів у кінці - не помилка', () => {
    const result = rowsOf('campaign,spend\nPromo,100.00,,,\n');
    expect(result.rows).toEqual([{ campaign: 'Promo', amountMinor: 10000 }]);
    expect(result.issues).toEqual([]);
  });

  it('порожнє зайве поле з пробілами теж не помилка', () => {
    const result = rowsOf('campaign;spend\nPromo;100,00;   \n');
    expect(result.rows).toEqual([{ campaign: 'Promo', amountMinor: 10000 }]);
    expect(result.issues).toEqual([]);
  });

  it('зайве непорожнє поле після порожнього - помилка', () => {
    const result = rowsOf('campaign,spend\nPromo,100.00,,x\n');
    expect(result.rows).toEqual([]);
    expect(result.issues[0]?.message).toContain('забагато полів');
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
