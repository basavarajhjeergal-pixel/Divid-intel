const express = require('express');
const forecast = require('../routes/forecast');
const { getHybrid } = require('../lib/hybrid');

let server, base;
beforeAll(done => {
    const app = express(); app.use('/api/forecast', forecast);
    server = app.listen(0, () => { base = `http://localhost:${server.address().port}/api/forecast`; done(); });
}, 10000);
afterAll(done => { server.close(done); });

test('forecast for a known stock has a forecast, an 80% range and a cut risk', async () => {
    const r = await fetch(`${base}/KO`); const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.forecastDividend).toBeGreaterThan(0);
    expect(j.range80Low).toBeLessThanOrEqual(j.forecastDividend);
    expect(j.range80High).toBeGreaterThanOrEqual(j.forecastDividend);
    expect(['Low', 'Medium', 'High']).toContain(j.cutRiskLevel);
    expect(j.backtest.accuracyPct).toBeGreaterThan(j.backtest.baselineAccuracyPct);
});

test('Indian tickers and lower case work', async () => {
    expect((await fetch(`${base}/ongc.ns`)).status).toBe(200);
});

test('unknown stock -> 404 with the covered list', async () => {
    const r = await fetch(`${base}/ZZZZ`); const j = await r.json();
    expect(r.status).toBe(404);
    expect(j.available.length).toBe(16);
});

test('summary lists every company and the trust weights', async () => {
    const j = await (await fetch(base)).json();
    expect(j.stocks.length).toBe(16);
    expect(Object.keys(j.trustInML).length).toBeGreaterThan(0);
});

test('getHybrid returns null for stocks the model does not cover', () => {
    expect(getHybrid('MRK')).toBeNull();
    expect(getHybrid('KO')).not.toBeNull();
});
