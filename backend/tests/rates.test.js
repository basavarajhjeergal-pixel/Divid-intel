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
