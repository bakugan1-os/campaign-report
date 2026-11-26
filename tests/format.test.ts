import { describe, expect, it } from 'vitest';
import { formatMoney, formatRoi } from '../src/format.js';
import type { TotalRow } from '../src/aggregate.js';

/** ROI рахується з мінорних одиниць; roiDefined лише каже, чи він визначений. */
const roi = (spendMinor: number, revenueMinor: number): TotalRow => ({
  spendMinor,
  revenueMinor,
  roiDefined: spendMinor > 0,
});

describe('formatMoney', () => {
  it('два знаки після коми', () => {
    expect(formatMoney(120050)).toBe('1200.50');
    expect(formatMoney(75025)).toBe('750.25');
  });

  it('нуль і дрібні суми', () => {
    expect(formatMoney(0)).toBe('0.00');
    expect(formatMoney(5)).toBe('0.05');
    expect(formatMoney(99)).toBe('0.99');
  });

  it('мінусові суми', () => {
    expect(formatMoney(-5000)).toBe('-50.00');
    expect(formatMoney(-5)).toBe('-0.05');
  });

  it('великі суми без втрати точності', () => {
    expect(formatMoney(9999999999)).toBe('99999999.99');
  });
});

describe('formatRoi', () => {
  it('ROI не визначений - риска', () => {
    expect(formatRoi(roi(0, 90000))).toBe('-');
    expect(formatRoi(roi(0, 0))).toBe('-');
    expect(formatRoi(roi(-5000, 1000))).toBe('-');
  });

  it('округлює рівно .5 від нуля, а не вниз: 40.00 -> 40.03 це 0.08%', () => {
    // (4003 - 4000) / 4000 * 100 = 0.075%, toFixed(2) дає 0.07%
    expect(formatRoi(roi(4000, 4003))).toBe('0.08%');
  });

  it('округлює рівно -.5 від нуля, а не вгору: 8.00 -> 5.01 це -37.38%', () => {
    // (501 - 800) / 800 * 100 = -37.375%, Math.round дає -37.37%
    expect(formatRoi(roi(800, 501))).toBe('-37.38%');
  });

  it('мінусове рівно .5 на малому значенні: 40.00 -> 39.97 це -0.08%', () => {
    expect(formatRoi(roi(4000, 3997))).toBe('-0.08%');
  });

  it('рівні суми дають 0.00%', () => {
    expect(formatRoi(roi(20000, 20000))).toBe('0.00%');
  });

  it('дохід 0 дає -100.00%', () => {
    expect(formatRoi(roi(100000, 0))).toBe('-100.00%');
  });

  it('цілі відсотки з двома знаками', () => {
    expect(formatRoi(roi(50000, 200000))).toBe('300.00%');
    expect(formatRoi(roi(100000, 300000))).toBe('200.00%');
  });

  it('округлює вниз, коли залишок менше половини', () => {
    expect(formatRoi(roi(75025, 150000))).toBe('99.93%');
    expect(formatRoi(roi(99999, 150000))).toBe('50.00%');
  });

  it('округлює вгору, коли залишок більше половини', () => {
    expect(formatRoi(roi(120050, 240000))).toBe('99.92%');
    expect(formatRoi(roi(123450, 200000))).toBe('62.01%');
  });

  it('ROI рядка Total рахується від загальних сум, а не як середнє по кампаніях', () => {
    // кампанії 10000->30000 (200%) і 90000->90000 (0%): середнє дало б 100.00%
    expect(formatRoi(roi(100000, 120000))).toBe('20.00%');
  });

  it('відтворює числа з фікстур', () => {
    expect(formatRoi(roi(340000, 289075))).toBe('-14.98%');
    expect(formatRoi(roi(535075, 679075))).toBe('26.91%');
    expect(formatRoi(roi(223449, 350000))).toBe('56.64%');
    expect(formatRoi(roi(185000, 355000))).toBe('91.89%');
    expect(formatRoi(roi(45000, 156000))).toBe('246.67%');
    expect(formatRoi(roi(350000, 550000))).toBe('57.14%');
  });

  it('великі суми без втрати точності', () => {
    expect(formatRoi(roi(100000000, 300000000))).toBe('200.00%');
  });
});
