const express = require('express');
const router  = express.Router();
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({
    suppressNotices: ['yahooSurvey'],
    logger: { ...console, warn: (msg, ...args) => { if (!String(msg).includes('Unsupported environment')) console.warn(msg, ...args); } }
});

// Empirical Research Universe (divfor) + Top Dividend Stocks
const SCREENER_UNIVERSE = [
    // ── Researched Universe (divfor) ──
    'KO','PEP','PG','MSFT','JPM',
    'ONGC.NS','NTPC.NS','COALINDIA.NS','POWERGRID.NS','IOC.NS','GAIL.NS','TCS.NS','INFY.NS','ITC.NS','HDFCBANK.NS','RELIANCE.NS',
    // ── Additional US Aristocrats & Bluechips ──
    'JNJ','ABBV','MRK','PFE','XOM','CVX','VZ','T','AAPL','IBM','CSCO','MMM','HON','NEE','D','DUK','BAC','USB','WMT','HD'
];

async function fetchTickerStats(ticker, rfRate, rmRate) {
    try {
        const [quoteRes, summaryRes] = await Promise.allSettled([
            yf.quote(ticker),
            yf.quoteSummary(ticker, { modules: ['summaryDetail', 'defaultKeyStatistics', 'assetProfile'] })
        ]);

        const q  = quoteRes.status  === 'fulfilled' ? quoteRes.value  : {};
        const sm = summaryRes.status === 'fulfilled' ? summaryRes.value : {};
        const sd = sm.summaryDetail        || {};
        const ks = sm.defaultKeyStatistics || {};
        const ap = sm.assetProfile         || {};

        const currentPrice   = q.regularMarketPrice || 100;
        const beta           = q.beta || ks.beta || 1.0;
        const payoutRatio    = sd.payoutRatio   ? +(sd.payoutRatio   * 100).toFixed(1) : null;
        const forwardYield   = sd.dividendYield ? +(sd.dividendYield * 100).toFixed(2)
                             : q.trailingAnnualDividendYield ? +(q.trailingAnnualDividendYield * 100).toFixed(2) : 0;

        // Get 5yr dividend history for CAGR
        const divStart = new Date();
        divStart.setFullYear(divStart.getFullYear() - 6);
        const divData = await yf.chart(ticker, { period1: divStart, interval: '1mo', events: 'div' }).catch(() => ({}));
        const rawDivs = divData.events?.dividends || [];
        const yearlyDivs = {};
        rawDivs.forEach(d => {
            const dDate = new Date(d.date < 10000000000 ? d.date * 1000 : d.date);
            const year  = dDate.getFullYear();
            if (year > 2000 && year < 2100) yearlyDivs[year] = (yearlyDivs[year] || 0) + d.amount;
        });

        const hist = Object.keys(yearlyDivs).sort().map(y => yearlyDivs[y]);
        let g = 0;
        if (hist.length >= 2) {
            const n = hist.length - 1;
            if (hist[0] > 0 && hist[n] > 0) g = (Math.pow(hist[n] / hist[0], 1 / n) - 1) * 100;
        }
        g = Math.min(20, Math.max(-5, g));

        // ML-calibrated Valuation Engine
        const R_val = (rfRate / 100) + beta * ((rmRate / 100) - (rfRate / 100));
        const D0  = hist.length > 0 ? hist[hist.length - 1] : currentPrice * (forwardYield / 100);
        const D1  = D0 * (1 + g / 100);
        const P   = R_val > (g / 100) + 0.001 ? D1 / (R_val - g / 100) : currentPrice * 1.05;
        const gap = ((P - currentPrice) / currentPrice) * 100;

        // AI score (simplified)
        let valScore    = gap > 30 ? 35 : gap > 0 ? 17.5 + (gap / 30) * 17.5 : Math.max(0, 17.5 + (gap / 30) * 17.5);
        let growthScore = g >= 10 ? 20 : g > 0 ? (g / 10) * 20 : 0;
        let yieldScore  = forwardYield >= 2.5 && forwardYield <= 6 ? 20 : forwardYield > 6 ? Math.max(8, 20 - (forwardYield - 6) * 3) : (forwardYield / 2.5) * 20;
        let betaScore   = beta <= 0.7 ? 15 : beta > 1.5 ? 2 : 15 - ((beta - 0.7) / 0.8) * 13;
        let payoutScore = payoutRatio !== null ? (payoutRatio < 40 ? 10 : payoutRatio < 60 ? 8 : payoutRatio < 80 ? 5 : payoutRatio < 100 ? 2 : 0) : 5;
        // Cap score at 90 max (never 100 to avoid false certainty)
        const aiScore = Math.min(90, Math.max(10, Math.round(valScore + growthScore + yieldScore + betaScore + payoutScore)));
        const aiScoreRange = `${Math.max(10, aiScore - 3)} – ${Math.min(90, aiScore + 3)}`;

        // Determine company-specific affected factors
        const affectedFactors = [];

        // Factor 1: Valuation Gap
        if (gap > 15) {
            affectedFactors.push({ factor: 'Valuation Gap', impact: 'positive', label: `Undervalued (+${gap.toFixed(0)}%)`, desc: `Trades at a ${gap.toFixed(0)}% discount to ML fair value` });
        } else if (gap < -10) {
            affectedFactors.push({ factor: 'Valuation Gap', impact: 'negative', label: `Overvalued (${gap.toFixed(0)}%)`, desc: `Trades at a ${Math.abs(gap).toFixed(0)}% premium above ML fair value` });
        } else {
            affectedFactors.push({ factor: 'Valuation Gap', impact: 'neutral', label: `Fairly Priced (${gap >= 0 ? '+' : ''}${gap.toFixed(0)}%)`, desc: `Trading close to modeled intrinsic target` });
        }

        // Factor 2: Payout Stress
        if (payoutRatio !== null) {
            if (payoutRatio < 55) {
                affectedFactors.push({ factor: 'Payout Coverage', impact: 'positive', label: `Safe Payout (${payoutRatio}%)`, desc: `Strong earnings cushion protecting dividend payouts` });
            } else if (payoutRatio > 80) {
                affectedFactors.push({ factor: 'Payout Coverage', impact: 'negative', label: `High Payout (${payoutRatio}%)`, desc: `Elevated earnings payout increases cut risk` });
            } else {
                affectedFactors.push({ factor: 'Payout Coverage', impact: 'neutral', label: `Balanced Payout (${payoutRatio}%)`, desc: `Standard payout coverage ratio` });
            }
        }

        // Factor 3: Growth Trajectory
        if (g >= 6) {
            affectedFactors.push({ factor: 'Dividend Growth', impact: 'positive', label: `Strong Growth (+${g.toFixed(1)}%)`, desc: `High historical dividend expansion rate` });
        } else if (g < 1) {
            affectedFactors.push({ factor: 'Dividend Growth', impact: 'negative', label: `Stagnant Growth (${g.toFixed(1)}%)`, desc: `Limited dividend expansion capacity` });
        } else {
            affectedFactors.push({ factor: 'Dividend Growth', impact: 'neutral', label: `Moderate Growth (+${g.toFixed(1)}%)`, desc: `Steady dividend progression` });
        }

        // Factor 4: Market Beta
        if (beta <= 0.85) {
            affectedFactors.push({ factor: 'Market Beta', impact: 'positive', label: `Defensive (β ${beta.toFixed(2)})`, desc: `Low systematic risk dampens discount rate` });
        } else if (beta >= 1.25) {
            affectedFactors.push({ factor: 'Market Beta', impact: 'negative', label: `High Volatility (β ${beta.toFixed(2)})`, desc: `Higher required market return increases hurdle rate` });
        }

        const topTailwind = affectedFactors.find(f => f.impact === 'positive')?.label || 'Steady Dividends';
        const topDrag     = affectedFactors.find(f => f.impact === 'negative')?.label || 'Market Risk';

        let signal = 'HOLD';
        if      (gap >  15) signal = 'BUY';
        else if (gap < -15) signal = 'SELL';

        return {
            ticker,
            name:         q.longName || q.shortName || ticker,
            currentPrice: +currentPrice.toFixed(2),
            forwardYield,
            growth:       +g.toFixed(2),
            payoutRatio,
            beta:         +beta.toFixed(2),
            aiScore,
            aiScoreRange,
            signal,
            sector:       ap.sector || 'N/A',
            intrinsicValue: +P.toFixed(2),
            valuationGap:   +gap.toFixed(1),
            affectedFactors,
            topTailwind,
            topDrag,
            ok: true
        };
    } catch (err) {
        return { ticker, name: ticker, currentPrice: 0, forwardYield: 0, growth: 0, payoutRatio: null, beta: 1, aiScore: 50, signal: 'HOLD', sector: 'N/A', intrinsicValue: 0, valuationGap: 0, ok: false };
    }
}

// GET /api/screener
router.get('/', async (req, res) => {
    const rfRate = parseFloat(req.query.rf) || 4.5;
    const rmRate = parseFloat(req.query.rm) || 10.0;

    try {
        // Fetch all in parallel with a concurrency limit (5 at a time)
        const results = [];
        const chunkSize = 5;
        for (let i = 0; i < SCREENER_UNIVERSE.length; i += chunkSize) {
            const chunk = SCREENER_UNIVERSE.slice(i, i + chunkSize);
            const chunkResults = await Promise.all(chunk.map(t => fetchTickerStats(t, rfRate, rmRate)));
            results.push(...chunkResults);
        }

        const stocks = results.filter(r => r.ok).sort((a, b) => b.aiScore - a.aiScore);
        res.json({ stocks, count: stocks.length, timestamp: new Date() });
    } catch (err) {
        console.error('Screener error:', err.message);
        res.status(500).json({ error: 'Screener failed', message: err.message });
    }
});

module.exports = router;
