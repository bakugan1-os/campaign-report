import { describe, expect, it } from 'vitest';
import { aggregate } from '../src/aggregate.js';
import type { ParsedRow } from '../src/types.js';

const row = (campaign: string, amountMinor: number): ParsedRow => ({ campaign, amountMinor });

describe('aggregate', () => {
  it('зводить витрати і доходи однієї кампанії', () => {
    const report = aggregate([row('winter-sale', 100000)], [row('winter-sale', 300000)]);
    expect(report.rows).toEqual([
      { campaign: 'winter-sale', spendMinor: 100000, revenueMinor: 300000, roiDefined: true },
    ]);
    expect(report.issues).toEqual([]);
  });

  it('кампанія лише у витратах: дохід 0, ROI визначений', () => {
    const report = aggregate([row('winter-sale', 100000)], []);
    expect(report.rows).toEqual([
      { campaign: 'winter-sale', spendMinor: 100000, revenueMinor: 0, roiDefined: true },
    ]);
  });

  it('кампанія лише в доходах: витрати 0, ROI не визначений', () => {
    const report = aggregate([], [row('referral-push', 30000)]);
    expect(report.rows).toEqual([
      { campaign: 'referral-push', spendMinor: 0, revenueMinor: 30000, roiDefined: false },
    ]);
  });

  it('додає суми дублікатів з обох файлів', () => {
    const report = aggregate(
      [row('black-friday', 100000), row('black-friday', 50000), row('black-friday', 25000)],
      [row('black-friday', 300000), row('black-friday', 50000)],
    );
    expect(report.rows).toEqual([
      { campaign: 'black-friday', spendMinor: 175000, revenueMinor: 350000, roiDefined: true },
    ]);
  });

  it('зливає назви без урахування регістру і показує перше написання', () => {
    const report = aggregate(
      [row('black-friday', 100000), row('BLACK-FRIDAY', 25000)],
      [row('Black-Friday', 300000)],
    );
    expect(report.rows).toEqual([
      { campaign: 'black-friday', spendMinor: 125000, revenueMinor: 300000, roiDefined: true },
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

  it('нерозривний пробіл у назві не створює другої кампанії', () => {
    const report = aggregate([row('Black Friday', 10000)], [row('Black Friday', 30000)]);
    expect(report.rows).toEqual([
      {
        campaign: 'Black Friday',
        spendMinor: 10000,
        revenueMinor: 30000,
        roiDefined: true,
      },
    ]);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]?.message).toContain('злито');
  });

  it('різні апострофи зводяться до одного', () => {
    expect(aggregate([row("П'ятниця", 10000)], [row('Пʼятниця', 30000)]).rows).toHaveLength(1);
    expect(aggregate([row('П’ятниця', 10000)], [row("П'ятниця", 30000)]).rows).toHaveLength(1);
    expect(aggregate([row('Пʼятниця', 10000)], [row('П’ятниця', 30000)]).rows).toHaveLength(1);
  });

  it('NFD і NFC - одна кампанія', () => {
    const report = aggregate(
      [row('Йога'.normalize('NFD'), 10000)],
      [row('Йога'.normalize('NFC'), 30000)],
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.revenueMinor).toBe(30000);
  });

  it('невидимі символи не створюють другої кампанії', () => {
    expect(aggregate([row('Promo​', 10000)], [row('Promo', 30000)]).rows).toHaveLength(1);
    expect(aggregate([row('Promo‍', 10000)], [row('Promo', 30000)]).rows).toHaveLength(1);
    expect(aggregate([row('Promo﻿', 10000)], [row('Promo', 30000)]).rows).toHaveLength(1);
  });

  it('різні кампанії все одно не зливаються', () => {
    const report = aggregate([row('Promo A', 10000), row('Promo B', 10000)], []);
    expect(report.rows.map((item) => item.campaign)).toEqual(['Promo A', 'Promo B']);
    expect(report.issues).toEqual([]);
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
    expect(report.issues).toEqual([{ kind: 'попередження', message: 'злито: promo, PROMO' }]);
  });

  it('Total тримає суми всіх кампаній, а не середні', () => {
    const report = aggregate(
      [row('small-win', 10000), row('big-flat', 90000)],
      [row('small-win', 30000), row('big-flat', 90000)],
    );
    // ROI по цих сумах рахує format: 20.00%, а не середнє 100.00% по кампаніях
    expect(report.total).toEqual({ spendMinor: 100000, revenueMinor: 120000, roiDefined: true });
  });

  it('Total підсумовує кампанії, яких немає в обох файлах', () => {
    const report = aggregate(
      [row('a', 50000), row('b', 25000)],
      [row('a', 100000), row('c', 10000)],
    );
    expect(report.total.spendMinor).toBe(75000);
    expect(report.total.revenueMinor).toBe(110000);
  });

  it('ROI не визначений, коли витрати кампанії 0', () => {
    const report = aggregate([row('dormant', 0)], [row('dormant', 0)]);
    expect(report.rows[0]?.roiDefined).toBe(false);
  });

  it('ROI не визначений, коли сумарні витрати кампанії мінусові', () => {
    const report = aggregate([row('refund-only', -5000)], [row('refund-only', 1000)]);
    expect(report.rows).toEqual([
      { campaign: 'refund-only', spendMinor: -5000, revenueMinor: 1000, roiDefined: false },
    ]);
  });

  it('мінус у рядку не ламає ROI, якщо сума витрат додатна', () => {
    const report = aggregate(
      [row('cashback-test', -15000), row('cashback-test', 35000)],
      [row('cashback-test', 20000)],
    );
    expect(report.rows).toEqual([
      { campaign: 'cashback-test', spendMinor: 20000, revenueMinor: 20000, roiDefined: true },
    ]);
  });

  it('ROI рядка Total не визначений, коли загальні витрати <= 0', () => {
    const report = aggregate([row('refund-only', -5000)], [row('refund-only', 100000)]);
    expect(report.total).toEqual({ spendMinor: -5000, revenueMinor: 100000, roiDefined: false });
  });

  it('сортує кампанії за назвою', () => {
    const report = aggregate(
      [row('winter-sale', 10000), row('black-friday', 10000), row('promo-mix', 10000)],
      [row('referral-push', 10000)],
    );
    expect(report.rows.map((item) => item.campaign)).toEqual([
      'black-friday',
      'promo-mix',
      'referral-push',
      'winter-sale',
    ]);
  });

  it('порожні входи: рядків немає, Total нульовий', () => {
    const report = aggregate([], []);
    expect(report.rows).toEqual([]);
    expect(report.total).toEqual({ spendMinor: 0, revenueMinor: 0, roiDefined: false });
    expect(report.issues).toEqual([]);
  });

  it('не змінює вхідні масиви', () => {
    const spend = [row('a', 10000)];
    const revenue = [row('a', 20000)];
    aggregate(spend, revenue);
    expect(spend).toEqual([row('a', 10000)]);
    expect(revenue).toEqual([row('a', 20000)]);
  });
});
