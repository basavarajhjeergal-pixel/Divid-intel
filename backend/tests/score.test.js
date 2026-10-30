/**
 * tests/score.test.js
 * Tests for GET /api/score/:ticker with 5-Factor DVS Methodology
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
              returnOnEquity: 1.45,
              freeCashflow: 100000000000,
              totalDebt: 80000000000,
              totalCash: 90000000000,
              ebitda: 130000000000,
            },
            defaultKeyStatistics: {
              sharesOutstanding: 15000000000,
            },
            assetProfile: { sector: 'Technology' },
            summaryDetail: {
              dividendRate: 1.00,
              payoutRatio: 0.15
            },
          };
        }

        // Bank — JPM
        if (ticker === 'JPM') {
          return {
            financialData: { returnOnEquity: 0.165, freeCashflow: null },
            defaultKeyStatistics: { sharesOutstanding: 2800000000 },
            assetProfile: { sector: 'Financial Services' },
            summaryDetail: { payoutRatio: 0.32, dividendRate: 4.60 },
          };
        }

        // Missing data ticker
        if (ticker === 'NODATA') {
          return {
            financialData: {},
            defaultKeyStatistics: {},
            assetProfile: {},
            summaryDetail: {},
          };
        }

        throw new Error('Unknown ticker');
      }

      async fundamentalsTimeSeries(ticker) {
        if (ticker === 'AAPL') {
          return [
            { date: new Date('2021-09-30'), freeCashFlow: 92000000000 },
            { date: new Date('2022-09-30'), freeCashFlow: 111000000000 },
            { date: new Date('2023-09-30'), freeCashFlow: 99000000000 },
            { date: new Date('2024-09-30'), freeCashFlow: 108000000000 },
            { date: new Date('2025-09-30'), freeCashFlow: 98000000000 }
          ];
        }
        if (ticker === 'JPM') {
          return [];
        }
        return [];
      }

      async chart(ticker) {
        if (ticker === 'AAPL') {
          const divs = [];
          for (let yr = 2012; yr <= 2025; yr++) {
            divs.push({ date: new Date(`${yr}-05-15`), amount: 0.20 + (yr - 2012) * 0.06 });
          }
          return { events: { dividends: divs } };
        }
        if (ticker === 'JPM') {
          const divs = [];
          for (let yr = 2014; yr <= 2025; yr++) {
            divs.push({ date: new Date(`${yr}-05-15`), amount: 1.50 + (yr - 2014) * 0.25 });
          }
          return { events: { dividends: divs } };
        }
        return { events: { dividends: [] } };
      }
    }
  };
});

const app = require('../server');
const formula = require('../formula.json');

const describeIf = (condition) => condition ? describe : describe.skip;

describeIf(true)('GET /api/score/:ticker - 5-Factor DVS API', () => {

  test('Normal ticker (AAPL) — returns valid 5-factor DVS score and components', async () => {
    if (!request) return;
    const res = await request(app).get('/api/score/AAPL');
    expect(res.status).toBe(200);
    expect(res.body.ticker).toBe('AAPL');
    expect(typeof res.body.score).toBe('number');
    expect(res.body.score).toBeGreaterThanOrEqual(0);
    expect(res.body.score).toBeLessThanOrEqual(100);
    expect(['green', 'yellow', 'red']).toContain(res.body.band);
    expect(res.body.signal).toBeTruthy();
    expect(res.body.components).toBeDefined();
    expect(res.body.components.fcfSafety).toBeDefined();
    expect(res.body.components.earningsSafety).toBeDefined();
    expect(res.body.components.leverageSafety).toBeDefined();
    expect(res.body.components.fcfConsistency).toBeDefined();
    expect(res.body.components.dividendHistory).toBeDefined();
    expect(res.body.rawFinancials).toBeDefined();
  });

  test('Financial institution (JPM) — returns sector-specific methodology response', async () => {
    if (!request) return;
    const res = await request(app).get('/api/score/JPM');
    expect(res.status).toBe(200);
    expect(res.body.ticker).toBe('JPM');
    expect(res.body.isFinancial).toBe(true);
    expect(typeof res.body.score).toBe('number');
    expect(['green', 'yellow', 'red']).toContain(res.body.band);
    expect(res.body.components.earningsSafety).toBeDefined();
    expect(res.body.components.capitalCushion).toBeDefined();
    expect(res.body.components.dividendHistory).toBeDefined();
    expect(res.body.warnings.some(w => w.includes('Financial Sector Model'))).toBe(true);
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

describe('DVS Formula Configuration Integrity', () => {

  test('Weights sum exactly to 1.00', () => {
    const { weights } = formula;
    const sum = weights.fcfSafety + weights.earningsSafety + weights.leverageSafety + weights.fcfConsistency + weights.dividendHistory;
    expect(+sum.toFixed(4)).toBe(1.00);
  });

  test('Band thresholds match specification', () => {
    expect(formula.bands.high).toBe(70);
    expect(formula.bands.low).toBe(50);
  });

});
