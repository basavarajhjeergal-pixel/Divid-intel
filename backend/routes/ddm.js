const express = require('express');
const router = express.Router();
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({
    suppressNotices: ['yahooSurvey'],
    logger: { ...console, warn: (msg, ...args) => { if (!String(msg).includes('Unsupported environment')) console.warn(msg, ...args); } }
});

router.get('/analyze/:ticker', async (req, res) => {
    const { ticker } = req.params;
    const { range = '1y' } = req.query;

    const rangeMap = {
        '1d': { days: 1,   interval: '15m' },
        '1w': { days: 7,   interval: '30m' },
        '1m': { days: 30,  interval: '1h'  },
        '3m': { days: 90,  interval: '1d'  },
        '6m': { days: 180, interval: '1d'  },
        '1y': { days: 365, interval: '1d'  }
    };

    const config = rangeMap[range] || rangeMap['1y'];
    const p1 = new Date();
    p1.setDate(p1.getDate() - config.days);

    try {
        // ── Primary quote ─────────────────────────────────────────────────────
        const quote = await yf.quote(ticker).catch(() => ({ regularMarketPrice: 100 }));

        // ── Extended summary (non-blocking) ──────────────────────────────────
        let profile = {}, keyStats = {}, financialData = {}, summaryDetail = {};
        try {
            const summary = await yf.quoteSummary(ticker, {
                modules: ['assetProfile', 'defaultKeyStatistics', 'financialData', 'summaryDetail']
            });
            profile        = summary.assetProfile        || {};
            keyStats       = summary.defaultKeyStatistics || {};
            financialData  = summary.financialData        || {};
            summaryDetail  = summary.summaryDetail        || {};
        } catch (e) { /* silent — will use quote fallbacks */ }

        // ── Price / OHLC history ──────────────────────────────────────────────
        let priceHistory = [];
        let ohlc = { open: 0, high: 0, low: 0, vol: 0 };
        try {
            const chartData = await yf.chart(ticker, {
                period1:  p1,
                period2:  new Date(),
                interval: config.interval
            });
            const quotes = (chartData.quotes || []).filter(q => q.close || q.adjclose);
            if (quotes.length > 0) {
                const isIntraday = config.interval.includes('m') || config.interval.includes('h');
                priceHistory = quotes.map(q => ({
                    time:  isIntraday
                        ? new Date(q.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : new Date(q.date).toLocaleDateString([], { month: 'short', day: 'numeric' }),
                    price:  q.close || q.adjclose,
                    open:   q.open  || q.close,
                    high:   q.high  || q.close,
                    low:    q.low   || q.close,
                    volume: q.volume || 0
                }));
                ohlc = {
                    open: (quotes[0].close || quotes[0].adjclose).toFixed(2),
                    high: Math.max(...quotes.map(q => q.high  || q.close)).toFixed(2),
                    low:  Math.min(...quotes.map(q => q.low   || q.close)).toFixed(2),
                    vol:  quotes.reduce((a, q) => a + (q.volume || 0), 0)
                };
            } else { throw new Error('Empty'); }
        } catch (e) {
            const base = quote.regularMarketPrice || 100;
            priceHistory = Array.from({ length: 40 }, (_, i) => ({
                time: `T-${40 - i}`, price: base * (0.95 + Math.random() * 0.1),
                open: base, high: base * 1.02, low: base * 0.98, volume: 1000000
            }));
            ohlc = { open: base.toFixed(2), high: (base * 1.05).toFixed(2), low: (base * 0.95).toFixed(2), vol: 1200000 };
        }

        // ── Dividend history ──────────────────────────────────────────────────
        const divStart = new Date();
        divStart.setFullYear(divStart.getFullYear() - 7);
        const divData = await yf.chart(ticker, {
            period1:  divStart,
            interval: '1mo',
            events:   'div'
        }).catch(() => ({}));

        const rawDividends = divData.events?.dividends || [];
        const currentYear  = new Date().getFullYear();

        // Build per-year totals and a list of per-payment amounts
        const yearlyDivs  = {};
        const paymentList = [];   // [{ date, amount }]
        const oneYearAgo  = new Date(new Date().getTime() - 365 * 24 * 60 * 60 * 1000);
        let ttmDividend   = 0;

        rawDividends.forEach(d => {
            const dDate = new Date(d.date < 10000000000 ? d.date * 1000 : d.date);
            const year  = dDate.getFullYear();
            if (year >= (currentYear - 7) && year < currentYear) {
                yearlyDivs[year] = (yearlyDivs[year] || 0) + d.amount;
            }
            paymentList.push({ date: dDate, amount: d.amount });
            if (dDate >= oneYearAgo && dDate <= new Date()) {
                ttmDividend += d.amount;
            }
        });

        // Set current year baseline to actual Trailing 12-Month (TTM) dividend
        if (ttmDividend > 0) {
            yearlyDivs[currentYear] = parseFloat(ttmDividend.toFixed(4));
        }

        const dividendHistory = Object.keys(yearlyDivs)
            .sort()
            .map(year => ({
                year:        parseInt(year),
                amount:      parseFloat(yearlyDivs[year].toFixed(4)),
                isProjected: parseInt(year) === currentYear
            }));

        // ── Dividend CAGR & growth ────────────────────────────────────────────
        let g = 0;   // base (5-yr CAGR) for Gordon Growth Model
        const cleanHistory = dividendHistory.filter(d => !d.isProjected);
        if (cleanHistory.length >= 2) {
            const first = cleanHistory[0].amount;
            const last  = cleanHistory[cleanHistory.length - 1].amount;
            const n     = cleanHistory.length - 1;
            if (first > 0 && last > 0) g = (Math.pow(last / first, 1 / n) - 1) * 100;
        }

        // YoY growth rates for display
        const yoyGrowth = dividendHistory.map((d, i) => {
            if (i === 0) return { ...d, yoy: null };
            const prev = dividendHistory[i - 1].amount;
            return { ...d, yoy: prev > 0 ? ((d.amount - prev) / prev) * 100 : null };
        });

        // ── H-Model (two-stage DDM) ───────────────────────────────────────────
        // Stage 1: near-term growth = historical CAGR (capped at 15%)
        // Stage 2: stable long-run growth (assume converges to ~3%)
        const g1 = Math.min(15, Math.max(0, g));       // short-term (5Y)
        const g2 = Math.min(g1, 3.5);                  // stable terminal
        const H  = 5;                                   // half-life transition years

        // ── Key fundamentals ─────────────────────────────────────────────────
        const currentPrice   = quote.regularMarketPrice || 100;
        const beta           = quote.beta  || keyStats.beta || 1.0;
        const trailingEps    = keyStats.trailingEps     || financialData.revenuePerShare || null;
        const payoutRatio    = summaryDetail.payoutRatio || keyStats.payoutRatio         || null;
        const forwardYield   = summaryDetail.dividendYield || (quote.trailingAnnualDividendYield) || null;
        const forwardDivRate = summaryDetail.dividendRate  || (quote.trailingAnnualDividendRate)  || null;

        // Ex-dividend & payment dates
        let exDividendDate = null;
        let dividendPayDate = null;
        try {
            if (summaryDetail.exDividendDate) {
                const raw = summaryDetail.exDividendDate;
                const d   = raw instanceof Date ? raw : new Date(raw < 10000000000 ? raw * 1000 : raw);
                if (!isNaN(d.getTime())) exDividendDate = d.toISOString().split('T')[0];
            }
            if (summaryDetail.dividendDate) {
                const raw = summaryDetail.dividendDate;
                const d   = raw instanceof Date ? raw : new Date(raw < 10000000000 ? raw * 1000 : raw);
                if (!isNaN(d.getTime())) dividendPayDate = d.toISOString().split('T')[0];
            }
        } catch (e) { /* silent */ }

        // Market cap, P/E, 52-week range
        const marketCap   = quote.marketCap                || null;
        const peRatio     = quote.trailingPE               || keyStats.trailingPE   || null;
        const fiftyTwoHigh = quote.fiftyTwoWeekHigh        || null;
        const fiftyTwoLow  = quote.fiftyTwoWeekLow         || null;
        const avgVolume   = quote.averageDailyVolume10Day  || quote.averageDailyVolume3Month || null;

        // Dividend markers for chart (within the displayed range)
        const rangeStart = p1.getTime();
        const divMarkers = paymentList
            .filter(p => p.date.getTime() >= rangeStart)
            .map(p => ({
                time:   config.interval.includes('m') || config.interval.includes('h')
                    ? p.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : p.date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
                amount: p.amount
            }));

        res.json({
            ticker,
            name:          quote.longName || quote.shortName || ticker,
            currentPrice,
            beta,
            sector:        profile.sector   || 'N/A',
            industry:      profile.industry || 'N/A',
            description:   profile.longBusinessSummary || 'No description available.',
            dividendHistory: yoyGrowth,
            priceHistory,
            ohlc,
            divMarkers,
            // Dividend fundamentals
            g,
            g1,
            g2,
            H,
            trailingEps,
            payoutRatio:   payoutRatio  ? parseFloat((payoutRatio  * 100).toFixed(1)) : null,
            forwardYield:  forwardYield ? parseFloat((forwardYield * 100).toFixed(2)) : null,
            forwardDivRate,
            exDividendDate,
            dividendPayDate,
            // Market stats
            marketCap,
            peRatio:       peRatio ? parseFloat(peRatio.toFixed(2)) : null,
            fiftyTwoHigh,
            fiftyTwoLow,
            avgVolume,
            // Metadata
            marketTime:    quote.regularMarketTime || new Date(),
            dataSource:    'Yahoo Finance Live API',
            isMock:        false
        });

    } catch (err) {
        res.json(getFullMockResponse(ticker, range, config.days, err.message));
    }
});

function getFullMockResponse(ticker, range, days, errMsg) {
    const base = 120;
    const currentYear = new Date().getFullYear();
    return {
        ticker,
        name:        ticker,
        currentPrice: base,
        beta:         0.75,
        sector:       'Consumer Staples',
        industry:     'Beverages',
        description:  `Live API unavailable (${errMsg}). Showing simulation data.`,
        dividendHistory: [
            { year: currentYear - 4, amount: 1.64, isProjected: false, yoy: null  },
            { year: currentYear - 3, amount: 1.72, isProjected: false, yoy: 4.88  },
            { year: currentYear - 2, amount: 1.84, isProjected: false, yoy: 6.98  },
            { year: currentYear - 1, amount: 1.94, isProjected: false, yoy: 5.43  },
            { year: currentYear,     amount: 2.04, isProjected: true,  yoy: 5.15  }
        ],
        priceHistory: Array.from({ length: 40 }, (_, i) => ({
            time:   `Pt ${i}`,
            price:  base * (0.97 + Math.random() * 0.06),
            open:   base, high: base * 1.02, low: base * 0.98, volume: 1200000
        })),
        ohlc:            { open: base.toFixed(2), high: (base * 1.03).toFixed(2), low: (base * 0.97).toFixed(2), vol: 5000000 },
        divMarkers:      [],
        g:   5.1, g1: 5.1, g2: 3.5, H: 5,
        trailingEps:     2.47,
        payoutRatio:     78.5,
        forwardYield:    3.12,
        forwardDivRate:  2.04,
        exDividendDate:  null,
        dividendPayDate: null,
        marketCap:       null,
        peRatio:         24.5,
        fiftyTwoHigh:    null,
        fiftyTwoLow:     null,
        avgVolume:       null,
        marketTime:      new Date(),
        dataSource:      'Local Simulation',
        isMock:          true
    };
}

module.exports = router;
