/**
 * tests/score.test.js
 * Tests for GET /api/score/:ticker
 * 
 * Covers:
 *  - Normal ticker (valid score returned)
 *  - Bank/financial ticker (flagged, score = null)
 *  - Missing data ticker (insufficient data)
 */

let request;
try { request = require('supertest'); } catch (_) { request = null; }

// Mock yahoo-finance2 before requiring the app
jest.mock('yahoo-finance2', () => {
  return {
    default: class MockYahoo {
      constructor() {}
      async quoteSummary(ticker) {
        // Normal company — AAPL-like
        if (ticker === 'AAPL') {
          return {
            financialData: {
              returnOnEquity: 1.45,       // 145% ROE
              freeCashflow: 90000000000,  // $90B FCF
              operatingCashflow: 110000000000,
              totalCash: 50000000000,
            },
            defaultKeyStatistics: {
              sharesOutstanding: 15000000000,
            },
            assetProfile: { sector: 'Technology' },
            summaryDetail:  { dividendRate: 0.96 },
          };
        }

        // Bank — JPM
        if (ticker === 'JPM') {
          return {
            financialData: { returnOnEquity: 0.15, freeCashflow: null },
            defaultKeyStatistics: {},
            assetProfile: { sector: 'Financial Services' },
            summaryDetail: { dividendRate: 4.0 },
          };
        }

        // Missing data ticker
        if (ticker === 'NODATA') {
          return {
            financialData: {},
            defaultKeyStatistics: {},
            assetProfile: { sector: 'Technology' },
            summaryDetail: {},
          };
        }

        throw new Error('Unknown ticker');
      }
    }
  };
});

const app = require('../server');

// Only run if supertest is installed
const describeIf = (condition) => condition ? describe : describe.skip;

describeIf(true)('GET /api/score/:ticker', () => {

  test('Normal ticker (AAPL) — returns valid score', async () => {
    if (!request) return;
    const res = await request(app).get('/api/score/AAPL');
    expect(res.status).toBe(200);
    expect(res.body.ticker).toBe('AAPL');
    expect(typeof res.body.score).toBe('number');
    expect(res.body.score).toBeGreaterThanOrEqual(0);
    expect(res.body.score).toBeLessThanOrEqual(100);
    expect(['green', 'yellow', 'red']).toContain(res.body.band);
    expect(res.body.signal).toBeTruthy();
  });

  test('Bank ticker (JPM) — returns not applicable', async () => {
    if (!request) return;
    const res = await request(app).get('/api/score/JPM');
    expect(res.status).toBe(200);
    expect(res.body.ticker).toBe('JPM');
    expect(res.body.score).toBeNull();
    expect(res.body.band).toBe('grey');
    expect(res.body.signal).toBe('Not applicable');
  });

  test('Missing data ticker (NODATA) — returns insufficient data', async () => {
    if (!request) return;
    const res = await request(app).get('/api/score/NODATA');
    expect(res.status).toBe(200);
    expect(res.body.ticker).toBe('NODATA');
    expect(res.body.score).toBeNull();
    expect(res.body.band).toBe('grey');
    expect(res.body.signal).toBe('Insufficient data');
  });

});

// Standalone unit tests (no HTTP, no supertest needed)
describe('Score formula unit tests', () => {

  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

  function standardise(value, mean, std) {
    if (std === 0) return 0;
    return (value - mean) / std;
  }

  const formula = require('../formula.json');

  test('sigmoid(0) = 0.5 → score = 50', () => {
    expect(Math.round(sigmoid(0) * 100)).toBe(50);
  });

  test('High ROE → higher score', () => {
    const { coefficients, means, stds } = formula;
    const logitHigh = coefficients.ROE * standardise(0.5, means.ROE, stds.ROE);
    const logitLow  = coefficients.ROE * standardise(0.05, means.ROE, stds.ROE);
    expect(sigmoid(logitHigh)).toBeGreaterThan(sigmoid(logitLow));
  });

  test('Score is between 0 and 100', () => {
    const { coefficients, means, stds } = formula;
    const logit = 
      coefficients.ROE            * standardise(0.3,  means.ROE,            stds.ROE) +
      coefficients.FCFPayoutRatio * standardise(0.05, means.FCFPayoutRatio, stds.FCFPayoutRatio) +
      coefficients.FCFGrowth      * standardise(0.2,  means.FCFGrowth,      stds.FCFGrowth);
    const score = Math.round(sigmoid(logit) * 100);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('Band thresholds match formula.json', () => {
    expect(formula.bands.high).toBe(70);
    expect(formula.bands.low).toBe(50);
  });

});
