// Simulated Yahoo data: the screener must use the hybrid model and never rank fake prices
jest.mock('../lib/yahoo', () => ({
    quote: async t => (t === 'ITC.NS' ? {} : { regularMarketPrice: 100, beta: 0.8, longName: t + ' Corp' }),
    quoteSummary: async () => ({ summaryDetail: { payoutRatio: 0.5, dividendYield: 0.03 }, assetProfile: { sector: 'Test' } }),
    chart: async () => ({ events: { dividends: [
        { date: new Date('2021-06-01'), amount: 2 }, { date: new Date('2022-06-01'), amount: 2.1 },
        { date: new Date('2023-06-01'), amount: 2.2 }, { date: new Date('2024-06-01'), amount: 2.3 } ] } })
}));

const express = require('express');
const screener = require('../routes/screener');

let server, base;
beforeAll(done => {
    const app = express(); app.use('/api/screener', screener);
    server = app.listen(0, () => { base = `http://localhost:${server.address().port}/api/screener`; done(); });
});
afterAll(done => { server.close(done); });

test('screens only the hybrid universe, with hybrid forecast and cut risk', async () => {
    const j = await (await fetch(base)).json();
    expect(j.model).toBe('Hybrid ML model');
    const tickers = j.stocks.map(s => s.ticker);
    expect(tickers).not.toContain('MRK');                 // removed extended stocks
    expect(tickers).not.toContain('ITC.NS');              // no live quote -> skipped, not a fake price
    expect(j.stocks.length).toBe(15);
    j.stocks.forEach(s => {
        expect(s.hybrid).not.toBeNull();
        expect(['Low', 'Medium', 'High']).toContain(s.hybrid.cutRiskLevel);
        if (s.hybrid.cutRiskLevel === 'High') expect(s.signal).not.toBe('BUY');
    });
    expect(j.stocks.find(s => s.ticker === 'ONGC.NS').currency).toBe('INR');
});
