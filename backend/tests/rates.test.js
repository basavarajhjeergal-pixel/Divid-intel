const { ratesFor, requiredReturn } = require('../lib/rates');

describe('Required return (CAPM) assumptions', () => {
  test('Indian and US stocks use their own country rates', () => {
    expect(ratesFor('ITC.NS').rf).toBeCloseTo(7.2);
    expect(ratesFor('KO').rf).toBeCloseTo(5.0);
  });
  test('required return is always above the government bond yield', () => {
    expect(requiredReturn('KO', 0.27)).toBeGreaterThanOrEqual(0.08);
    expect(requiredReturn('ONGC.NS', 0.3)).toBeGreaterThanOrEqual(0.105);
  });
  test('higher beta means higher required return', () => {
    expect(requiredReturn('JPM', 1.5)).toBeGreaterThan(requiredReturn('JPM', 1.0));
  });
});

const { modelValue } = require('../lib/rates');
describe('Shared dividend valuation', () => {
  test('Coca-Cola: low yield vs 8% required return gives SELL', () => {
    const v = modelValue('KO', { price: 97.59, D0: 2.04, D1: 2.127, growthPct: 4.3, beta: 0.27 });
    expect(v.signal).toBe('SELL');
    expect(v.value).toBeGreaterThanOrEqual(97.59 * 0.55);
  });
  test('a high-yield stock priced low gives BUY', () => {
    const v = modelValue('COALINDIA.NS', { price: 300, D0: 26.5, D1: 26.68, growthPct: 0.7, beta: 0.8 });
    expect(['BUY', 'STRONG BUY']).toContain(v.signal);
  });
  test('Indian stocks use higher long-run growth than US stocks', () => {
    expect(modelValue('ITC.NS', { price: 400, D0: 14, D1: 14.5, growthPct: 3, beta: 1 }).g2)
      .toBeGreaterThan(modelValue('KO', { price: 97, D0: 2, D1: 2.1, growthPct: 3, beta: 1 }).g2);
  });
});

const { finalSignal } = require('../lib/rates');
describe('One recommendation for every tab', () => {
  test('cut risk caps the valuation signal', () => {
    expect(finalSignal('STRONG BUY', 'High')).toBe('HOLD');
    expect(finalSignal('STRONG BUY', 'Medium')).toBe('BUY');
    expect(finalSignal('BUY', 'Low')).toBe('BUY');
    expect(finalSignal('SELL', 'High')).toBe('SELL');
  });
});
