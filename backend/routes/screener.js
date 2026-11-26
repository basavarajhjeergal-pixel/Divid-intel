const express = require('express');
const router  = express.Router();
const yf = require('../lib/yahoo');                     // shared, cached Yahoo client
const { loadAll, getHybrid } = require('../lib/hybrid');
const { modelValue, finalSignal } = require('../lib/rates');

// Screener universe = the 16 companies the hybrid model covers (11 India, 5 US)
function screenerUniverse() {
    return Object.keys(loadAll()?.stocks || {});
}

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

        if (!q.regularMarketPrice) throw new Error('No live quote for ' + ticker);   // never rank a fake price
        const currentPrice   = q.regularMarketPrice;
        const h = getHybrid(ticker);
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
        let histCagr = 0;
        if (hist.length >= 2) {
            const n = hist.length - 1;
            if (hist[0] > 0 && hist[n] > 0) histCagr = (Math.pow(hist[n] / hist[0], 1 / n) - 1) * 100;
        }
        // Growth = the hybrid model's forecast growth (capped for the perpetual-growth valuation)
        let g = h ? h.changePct : histCagr;
        g = Math.min(10, Math.max(-5, g));

        // Valuation: two-stage dividend model fed by the hybrid forecast
        // Same valuation as the ML Analysis tab (lib/rates.js), starting from the hybrid's base dividend
        const D0  = h && h.lastDividend > 0 ? h.lastDividend
                  : hist.length > 0 ? hist[hist.length - 1] : currentPrice * (forwardYield / 100);
        const D1  = h ? h.forecastDividend : D0 * (1 + g / 100);
        const mv  = modelValue(ticker, { price: currentPrice, D0, D1, growthPct: h ? h.changePct : g, beta });
        const rawP = mv.raw, P = mv.value, gap = mv.gap;

        // AI score (simplified)
        let valScore    = gap > 30 ? 35 : gap > 0 ? 17.5 + (gap / 30) * 17.5 : Math.max(0, 17.5 + (gap / 30) * 17.5);
        let growthScore = g >= 10 ? 20 : g > 0 ? (g / 10) * 20 : 0;
        let yieldScore  = forwardYield >= 2.5 && forwardYield <= 6 ? 20 : forwardYield > 6 ? Math.max(8, 20 - (forwardYield - 6) * 3) : (forwardYield / 2.5) * 20;
        let betaScore   = beta <= 0.7 ? 15 : beta > 1.5 ? 2 : 15 - ((beta - 0.7) / 0.8) * 13;
        // Dividend safety = the hybrid model's cut risk (Low 10, Medium 5, High 0)
        let payoutScore = h ? (h.cutRiskLevel === 'Low' ? 10 : h.cutRiskLevel === 'Medium' ? 5 : 0)
                            : (payoutRatio !== null ? (payoutRatio < 40 ? 10 : payoutRatio < 60 ? 8 : payoutRatio < 80 ? 5 : payoutRatio < 100 ? 2 : 0) : 5);
        // Cap score at 90 max (never 100 to avoid false certainty)
        const aiScore = Math.min(90, Math.max(10, Math.round(valScore + growthScore + yieldScore + betaScore + payoutScore)));
        const aiScoreRange = `${aiScore}`;   // plain score: no invented range

        // Determine company-specific affected factors
        const affectedFactors = [];

        // Factor 1: Valuation Gap
        if (gap > 15) {
            affectedFactors.push({ factor: 'Valuation Gap', impact: 'positive', label: rawP > P ? `Undervalued (+65% or more, capped)` : `Undervalued (+${gap.toFixed(0)}%)`, desc: rawP > P ? `Model value exceeds the 1.65× price limit; treat with caution` : `Model value is ${gap.toFixed(0)}% above the price` });
        } else if (gap < -10) {
            affectedFactors.push({ factor: 'Valuation Gap', impact: 'negative', label: rawP < P ? `Overvalued (−45% or more, capped)` : `Overvalued (${gap.toFixed(0)}%)`, desc: `Price is above the model value` });
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

        // Factor: Hybrid model cut risk
        if (h) {
            const imp = h.cutRiskLevel === 'Low' ? 'positive' : h.cutRiskLevel === 'High' ? 'negative' : 'neutral';
            affectedFactors.push({ factor: 'Cut Risk (Hybrid)', impact: imp, label: `${h.cutRiskLevel} cut risk (${h.cutRiskPct}%)`,
                                   desc: `Hybrid model's chance that the next dividend is lower` });
        }

        // Factor 3: Growth Trajectory (hybrid forecast for next year)
        if (g >= 6) {
            affectedFactors.push({ factor: 'Dividend Growth', impact: 'positive', label: `Strong Growth (+${g.toFixed(1)}%)`, desc: h ? `Hybrid model forecasts ${h.changePct >= 0 ? '+' : ''}${h.changePct}% for ${h.forecastYear}` : `High historical dividend expansion rate` });
        } else if (g < 1) {
            affectedFactors.push({ factor: 'Dividend Growth', impact: 'negative', label: `Stagnant Growth (${g.toFixed(1)}%)`, desc: h ? `Hybrid model forecasts ${h.changePct >= 0 ? '+' : ''}${h.changePct}% for ${h.forecastYear}` : `Limited dividend expansion capacity` });
        } else {
            affectedFactors.push({ factor: 'Dividend Growth', impact: 'neutral', label: `Moderate Growth (+${g.toFixed(1)}%)`, desc: h ? `Hybrid model forecasts ${h.changePct >= 0 ? '+' : ''}${h.changePct}% for ${h.forecastYear}` : `Steady dividend progression` });
        }

        // Factor 4: Market Beta
        if (beta <= 0.85) {
            affectedFactors.push({ factor: 'Market Beta', impact: 'positive', label: `Defensive (β ${beta.toFixed(2)})`, desc: `Low systematic risk dampens discount rate` });
        } else if (beta >= 1.25) {
            affectedFactors.push({ factor: 'Market Beta', impact: 'negative', label: `High Volatility (β ${beta.toFixed(2)})`, desc: `Higher required market return increases hurdle rate` });
        }

        const topTailwind = affectedFactors.find(f => f.impact === 'positive')?.label || 'Steady Dividends';
        const topDrag     = affectedFactors.find(f => f.impact === 'negative')?.label || 'Market Risk';

        const signal = finalSignal(mv.signal, h && h.cutRiskLevel);   // same answer as ML Analysis and AI Advisor

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
            currency:       /\.(NS|BO)$/.test(ticker) ? 'INR' : 'USD',
            hybrid: h ? {
                forecastYear: h.forecastYear, forecastDividend: h.forecastDividend, changePct: h.changePct,
                range80Low: h.range80Low, range80High: h.range80High,
                cutRiskPct: h.cutRiskPct, cutRiskLevel: h.cutRiskLevel
            } : null,
            ok: true
        };
    } catch (err) {
        return { ticker, name: ticker, currentPrice: 0, forwardYield: 0, growth: 0, payoutRatio: null, beta: 1, aiScore: 50, signal: 'HOLD', sector: 'N/A', intrinsicValue: 0, valuationGap: 0, ok: false };
    }
}

// GET /api/screener
router.get('/', async (req, res) => {
    const rfRate = null, rmRate = null;   // each stock uses its own country's rates (lib/rates.js)

    try {
        // Fetch all in parallel with a concurrency limit (5 at a time)
        const results = [];
        const chunkSize = 5;
        const universe = screenerUniverse();
        for (let i = 0; i < universe.length; i += chunkSize) {
            const chunk = universe.slice(i, i + chunkSize);
            const chunkResults = await Promise.all(chunk.map(t => fetchTickerStats(t, rfRate, rmRate)));
            results.push(...chunkResults);
        }

        const stocks = results.filter(r => r.ok).sort((a, b) => b.aiScore - a.aiScore);
        res.json({ stocks, count: stocks.length, model: 'Hybrid ML model', timestamp: new Date() });
    } catch (err) {
        console.error('Screener error:', err.message);
        res.status(500).json({ error: 'Screener failed', message: err.message });
    }
});

module.exports = router;
