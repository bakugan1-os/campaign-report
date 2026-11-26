import { describe, expect, it } from 'vitest';
import { aggregate } from '../src/aggregate.js';
import type { ParsedRow } from '../src/types.js';

const row = (campaign: string, amountMinor: number): ParsedRow => ({ campaign, amountMinor });

describe('aggregate', () => {
  it('зводить витрати і доходи однієї кампанії', () => {
    const report = aggregate([row('winter-sale', 100000)], [row('winter-sale', 300000)]);
    expect(report.rows).toEqual([
      { campaign: 'winter-sale', spendMinor: 100000, revenueMinor: 300000, roiPercent: 200 },
    ]);
    expect(report.issues).toEqual([]);
  });

  it('кампанія лише у витратах: дохід 0, ROI -100%', () => {
    const report = aggregate([row('winter-sale', 100000)], []);
    expect(report.rows).toEqual([
      { campaign: 'winter-sale', spendMinor: 100000, revenueMinor: 0, roiPercent: -100 },
    ]);
  });

  it('кампанія лише в доходах: витрати 0, ROI не визначений', () => {
    const report = aggregate([], [row('referral-push', 30000)]);
    expect(report.rows).toEqual([
      { campaign: 'referral-push', spendMinor: 0, revenueMinor: 30000, roiPercent: null },
    ]);
  });

  it('додає суми дублікатів з обох файлів', () => {
    const report = aggregate(
      [row('black-friday', 100000), row('black-friday', 50000), row('black-friday', 25000)],
      [row('black-friday', 300000), row('black-friday', 50000)],
    );
    expect(report.rows).toEqual([
      { campaign: 'black-friday', spendMinor: 175000, revenueMinor: 350000, roiPercent: 100 },
    ]);
  });

  it('зливає назви без урахування регістру і показує перше написання', () => {
    const report = aggregate(
      [row('black-friday', 100000), row('BLACK-FRIDAY', 25000)],
      [row('Black-Friday', 300000)],
    );
    expect(report.rows).toEqual([
      { campaign: 'black-friday', spendMinor: 125000, revenueMinor: 300000, roiPercent: 140 },
    ]);
    expect(report.issues).toEqual([
      { kind: 'попередження', message: 'злито: black-friday, BLACK-FRIDAY, Black-Friday' },
    ]);
  });

  it('перше написання беремо з файлу витрат, потім з файлу доходів', () => {
    const report = aggregate([row('WINTER-sale', 100000)], [row('winter-sale', 300000)]);
    expect(report.rows[0]?.campaign).toBe('WINTER-sale');
    expect(report.issues).toEqual([
      { kind: 'попередження', message: 'злито: WINTER-sale, winter-sale' },
    ]);
  });

  it('однакові написання не дають попередження', () => {
    const report = aggregate(
      [row('black-friday', 100000), row('black-friday', 50000)],
      [row('black-friday', 300000)],
    );
    expect(report.issues).toEqual([]);
  });

  it('не повторює написання в попередженні', () => {
    const report = aggregate(
      [row('promo', 10000), row('PROMO', 10000), row('PROMO', 10000), row('promo', 10000)],
      [],
    );
    expect(report.issues).toEqual([
      { kind: 'попередження', message: 'злито: promo, PROMO' },
    ]);
  });

  it('ROI рядка Total рахуємо від загальних сум, а не як середнє по кампаніях', () => {
    const report = aggregate(
      [row('small-win', 10000), row('big-flat', 90000)],
      [row('small-win', 30000), row('big-flat', 90000)],
    );
    // по кампаніях: 200% і 0%, середнє дало б 100%
    expect(report.rows.map((r) => r.roiPercent)).toEqual([0, 200]);
    expect(report.total).toEqual({ spendMinor: 100000, revenueMinor: 120000, roiPercent: 20 });
  });

  it('Total підсумовує всі кампанії', () => {
    const report = aggregate(
      [row('a', 50000), row('b', 25000)],
      [row('a', 100000), row('c', 10000)],
    );
    expect(report.total.spendMinor).toBe(75000);
    expect(report.total.revenueMinor).toBe(110000);
  });

  it('ROI не визначений, коли витрати кампанії 0', () => {
    const report = aggregate([row('dormant', 0)], [row('dormant', 0)]);
    expect(report.rows[0]?.roiPercent).toBeNull();
  });

  it('ROI не визначений, коли сумарні витрати кампанії мінусові', () => {
    const report = aggregate([row('refund-only', -5000)], [row('refund-only', 1000)]);
    expect(report.rows).toEqual([
      { campaign: 'refund-only', spendMinor: -5000, revenueMinor: 1000, roiPercent: null },
    ]);
  });

  it('мінус у рядку не ламає ROI, якщо сума витрат додатна', () => {
    const report = aggregate(
      [row('cashback-test', -15000), row('cashback-test', 35000)],
      [row('cashback-test', 20000)],
    );
    expect(report.rows).toEqual([
      { campaign: 'cashback-test', spendMinor: 20000, revenueMinor: 20000, roiPercent: 0 },
    ]);
  });

  it('ROI рядка Total не визначений, коли загальні витрати <= 0', () => {
    const report = aggregate([row('refund-only', -5000)], [row('refund-only', 100000)]);
    expect(report.total).toEqual({ spendMinor: -5000, revenueMinor: 100000, roiPercent: null });
  });

  it('сортує кампанії за назвою', () => {
    const report = aggregate(
      [row('winter-sale', 10000), row('black-friday', 10000), row('promo-mix', 10000)],
      [row('referral-push', 10000)],
    );
    expect(report.rows.map((r) => r.campaign)).toEqual([
      'black-friday',
      'promo-mix',
      'referral-push',
      'winter-sale',
    ]);
  });

  it('порожні входи: рядків немає, Total нульовий', () => {
    const report = aggregate([], []);
    expect(report.rows).toEqual([]);
    expect(report.total).toEqual({ spendMinor: 0, revenueMinor: 0, roiPercent: null });
    expect(report.issues).toEqual([]);
  });

  it('не змінює вхідні масиви', () => {
    const spend = [row('a', 10000)];
    const revenue = [row('a', 20000)];
    aggregate(spend, revenue);
    expect(spend).toEqual([row('a', 10000)]);
    expect(revenue).toEqual([row('a', 20000)]);
  });

  it('рахує дробовий ROI без округлення - округлення робить format', () => {
    const report = aggregate([row('winter-sale', 123450)], [row('winter-sale', 200000)]);
    expect(report.rows[0]?.roiPercent).toBeCloseTo(62.00891, 5);
  });
});
