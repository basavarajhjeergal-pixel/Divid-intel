const express = require('express');
const router = express.Router();
const { getHybrid } = require('../lib/hybrid');
const { requiredReturn, modelValue, finalSignal } = require('../lib/rates');
const currSym = t => /\.(NS|BO)$/i.test(String(t || '')) ? '₹' : '$';   // Indian stocks in rupees   // hybrid model predictions (offline-trained)
const yf = require('../lib/yahoo'); // shared, cached client
const Groq = require('groq-sdk');
const mlRoute = require('./ml');

// ── Comprehensive stock stats for AI scoring ──────────────────────────────────
async function getStockStats(ticker, rfRate, rmRate) {
    try {
        const [quote, summaryRaw] = await Promise.allSettled([
            yf.quote(ticker),
            yf.quoteSummary(ticker, {
                modules: ['defaultKeyStatistics', 'financialData', 'summaryDetail', 'assetProfile']
            })
        ]);

        if (quote.status !== 'fulfilled' || !quote.value?.regularMarketPrice) {
            throw new Error('No live quote for ' + ticker);
        }
        const q  = quote.value;
        const sm = summaryRaw.status === 'fulfilled' ? summaryRaw.value     : {};
        const ks = sm.defaultKeyStatistics || {};
        const fd = sm.financialData        || {};
        const sd = sm.summaryDetail        || {};
        const ap = sm.assetProfile         || {};

        const beta         = q.beta || ks.beta || 1.0;
        const currentPrice = q.regularMarketPrice || 100;
        const trailingEps  = ks.trailingEps || null;
        const payoutRatio  = sd.payoutRatio   || ks.payoutRatio     || null;
        const freeCashflow = fd.freeCashflow  || null;
        const currentYieldRaw = sd.dividendYield || q.trailingAnnualDividendYield || 0;

        // ── Dividend history ──────────────────────────────────────────────────
        const divStart = new Date();
        divStart.setFullYear(divStart.getFullYear() - 7);
        const divData = await yf.chart(ticker, {
            period1:  divStart,
            interval: '1mo',
            events:   'div'
        }).catch(() => ({}));

        const rawDividends = divData.events?.dividends || [];
        const yearlyDivs   = {};
        const currentYear  = new Date().getFullYear();
        const oneYearAgo   = new Date(new Date().getTime() - 365 * 24 * 60 * 60 * 1000);
        let ttmDividend    = 0;

        rawDividends.forEach(d => {
            const dDate = new Date(d.date < 10000000000 ? d.date * 1000 : d.date);
            const year  = dDate.getFullYear();
            if (year >= (currentYear - 7) && year < currentYear) {
                yearlyDivs[year] = (yearlyDivs[year] || 0) + d.amount;
            }
            if (dDate >= oneYearAgo && dDate <= new Date()) {
                ttmDividend += d.amount;
            }
        });
        if (ttmDividend > 0) {
            yearlyDivs[currentYear] = parseFloat(ttmDividend.toFixed(4));
        }

        const dividendHistory = Object.keys(yearlyDivs)
            .sort()
            .map(year => ({ year: parseInt(year), amount: yearlyDivs[year] }));

        // ── Growth rate (CAGR) ────────────────────────────────────────────────
        let g = 0;
        const cleanHist = dividendHistory.filter((_, idx, arr) => idx < arr.length - 1 || !yearlyDivs[currentYear]);
        if (cleanHist.length >= 2) {
            const first = cleanHist[0].amount, last = cleanHist[cleanHist.length - 1].amount;
            const n     = cleanHist.length - 1;
            if (first > 0 && last > 0) g = (Math.pow(last / first, 1 / n) - 1) * 100;
        } else if (dividendHistory.length === 1) { g = 2.0; }
        g = Math.min(20, Math.max(-5, g));

        const R_pct = requiredReturn(ticker, beta) * 100;
        const hy    = getHybrid(ticker);
        const D0    = hy && hy.lastDividend > 0 ? hy.lastDividend
                    : dividendHistory.length > 0 ? dividendHistory[dividendHistory.length - 1].amount : 0;
        const D1    = hy ? hy.forecastDividend : D0 * (1 + g / 100);
        const mv    = modelValue(ticker, { price: currentPrice, D0, D1, growthPct: hy ? hy.changePct : g, beta });
        const P = mv.value, valuationGap = mv.gap;   // same valuation as the ML Analysis tab
        const currentYield = currentYieldRaw * 100 || (currentPrice > 0 && D0 > 0 ? (D0 / currentPrice) * 100 : 0);
        const payoutPct = payoutRatio ? payoutRatio * 100 : null;

        return {
            ticker,
            name:          q.longName || q.shortName || ticker,
            currentPrice,
            beta,
            sector:        ap.sector   || 'N/A',
            industry:      ap.industry || 'N/A',
            g, R_pct,
            intrinsicValue: P,
            valuationGap,
            currentYield,
            payoutPct,
            trailingEps,
            freeCashflow,
            dividendHistory,
            isMock: false
        };
    } catch (err) {
        return {
            isMock: true, error: err.message,
            ticker, name: ticker, currentPrice: 100, beta: 1.0,
            sector: 'N/A', industry: 'N/A',
            g: 3.5, R_pct: 10.0, intrinsicValue: 108.0, valuationGap: 8.0,
            currentYield: 2.5, payoutPct: 60, trailingEps: null, freeCashflow: null,
            dividendHistory: [{ year: 2023, amount: 2.4 }, { year: 2024, amount: 2.5 }]
        };
    }
}


// ── Sector peer map ───────────────────────────────────────────────────────────
function getPeers(ticker) {
    const map = {
        'AAPL': ['MSFT', 'CSCO', 'IBM'],    'MSFT': ['AAPL', 'CSCO', 'IBM'],
        'CSCO': ['AAPL', 'MSFT', 'IBM'],    'IBM':  ['AAPL', 'MSFT', 'CSCO'],
        'KO':   ['PEP', 'PG', 'MO'],        'PEP':  ['KO', 'PG', 'MO'],
        'PG':   ['KO', 'PEP', 'CL'],        'MMM':  ['HON', 'EMR', 'GE'],
        'JNJ':  ['ABBV', 'MRK', 'PFE'],     'ABBV': ['JNJ', 'MRK', 'PFE'],
        'CVX':  ['XOM', 'BP', 'COP'],       'XOM':  ['CVX', 'BP', 'COP'],
        'VZ':   ['T', 'TMUS', 'CMCSA'],     'T':    ['VZ', 'TMUS', 'CMCSA'],
        'WBA':  ['CVS', 'JNJ', 'MCK'],      'MO':   ['PM', 'BTI', 'KO'],
        'HD':   ['LOW', 'TGT', 'WMT'],      'WMT':  ['TGT', 'COST', 'HD'],
        'JPM':  ['BAC', 'WFC', 'C'],        'BAC':  ['JPM', 'WFC', 'USB'],
        'NEE':  ['D', 'DUK', 'SO'],         'D':    ['NEE', 'DUK', 'SO'],
    };
    return map[ticker] || ['KO', 'PEP', 'PG'];
}

// ── 5-factor ML-Driven AI Score ──────────────────────────────────────────────
function calculateMLScore(stats, mlMape, mlReliable, mlGrowthRate) {
    // 1. ML Valuation Margin of Safety (0 - 35)
    let valScore = 17.5;
    if (stats.valuationGap > 25) valScore = 35;
    else if (stats.valuationGap > 0) valScore = 17.5 + (stats.valuationGap / 25) * 17.5;
    else if (stats.valuationGap > -25) valScore = 17.5 + (stats.valuationGap / 25) * 17.5;
    else valScore = 5;

    // 2. ML Projected Dividend Growth (0 - 25)
    const gEff = mlGrowthRate != null ? mlGrowthRate : stats.g;
    let growthScore = 12.5;
    if (gEff >= 8) growthScore = 25;
    else if (gEff > 0) growthScore = Math.min(25, (gEff / 8) * 25);
    else growthScore = Math.max(0, 10 + gEff * 2);

    // 3. ML Model Reliability & Accuracy (0 - 20)
    let accuracyScore = 15;
    if (mlMape != null) {
        if (mlMape <= 3.5) accuracyScore = 20;
        else if (mlMape <= 7) accuracyScore = 16;
        else if (mlMape <= 12) accuracyScore = 12;
        else accuracyScore = 8;
        if (!mlReliable) accuracyScore = Math.max(5, accuracyScore - 5);
    }

    // 4. Dividend Safety & Payout Health (0 - 20)
    let safetyScore = 12;
    if (stats.payoutPct !== null) {
        if (stats.payoutPct < 50) safetyScore = 20;
        else if (stats.payoutPct < 70) safetyScore = 16;
        else if (stats.payoutPct < 85) safetyScore = 10;
        else safetyScore = 4;
    }
    if (stats.beta > 1.2) safetyScore = Math.max(2, safetyScore - 4);
    else if (stats.beta < 0.8) safetyScore = Math.min(20, safetyScore + 2);

    const breakdown = {
        valuation: Math.round(Math.max(0, Math.min(35, valScore))),
        growth:    Math.round(Math.max(0, Math.min(25, growthScore))),
        accuracy:  Math.round(Math.max(0, Math.min(20, accuracyScore))),
        safety:    Math.round(Math.max(0, Math.min(20, safetyScore))),
    };

    // Cap at realistic range (10 - 92). Never 100 / out of out to avoid misleading certainty
    const total = Math.min(92, Math.max(10, breakdown.valuation + breakdown.growth + breakdown.accuracy + breakdown.safety));
    return { total, breakdown };
}

// ── DSI (Dividend Safety Index) ──────────────────────────────────────────────
function calculateDsi(stats) {
    let score = 100;
    if (stats.beta > 1.0) score -= (stats.beta - 1.0) * 20;
    if (stats.currentYield > 7) score -= (stats.currentYield - 7) * 15;
    if (stats.g < 3) score -= (3 - stats.g) * 8;
    if (stats.payoutPct !== null) {
        if      (stats.payoutPct > 100) score -= 30;
        else if (stats.payoutPct >  80) score -= (stats.payoutPct - 80) * 1.5;
    }
    // Cap at 94 max (never 100 / out of out)
    return Math.min(94, Math.max(10, Math.round(score)));
}

// ── ML-Based Quantitative Response Generator ─────────────────────────────────
// ── ML-Based Quantitative Response Generator ─────────────────────────────────
function generateOfflineAIResponse(ticker, question, context) {
    const cs = currSym(ticker);
    const q = (question || '').toLowerCase();
    const c = context || {};
    const name = c.name || ticker;
    const f = c.mlForecast || {};
    const hy = f.hybrid || null;
    const n = (v, d = 2) => (v === null || v === undefined || isNaN(Number(v))) ? null : Number(v).toFixed(d);
    const money = (v, d = 2) => n(v, d) !== null ? `${cs}${n(v, d)}` : 'not available';
    const pct = (v, d = 1) => n(v, d) !== null ? `${Number(v) >= 0 ? '+' : ''}${n(v, d)}%` : 'not available';
    const lines = [];

    if (!c.action) {
        return `I don't have an analysis for **${ticker}** yet. Click **Analyze** first, then ask again.`;
    }
    const forecastLine = `- **Next-year dividend forecast (${f.model || 'ML model'}):** ${money(f.mlPrediction, 4)} (${pct(f.mlGrowthRate)})` +
        (f.confidenceLow && f.confidenceHigh ? `, ${f.rangeLevel ? f.rangeLevel + '% range' : 'approximate range'} ${money(f.confidenceLow)} – ${money(f.confidenceHigh)}` : '');
    const accuracyLine = hy
        ? `- **How accurate it has been:** ${hy.backtestAccuracyPct}% average accuracy in a 2005–2025 walk-forward backtest across 16 companies (each year predicted from earlier years only).`
        : `- **How accurate it has been:** ${f.mlMape ? n(f.mlMape, 1) + '% average error for this stock' : 'no backtest available for this stock'}.`;
    const valueLine = `- **Valuation:** two-stage dividend model value ${money(c.intrinsicValue)} vs price ${money(c.currentPrice)} (${pct(c.valuationGap)}).`;
    const riskLine = `- **Cut risk:** ${c.cutRisk || 'not available'}` + (hy ? ` (hybrid model: ${hy.cutRiskPct}% chance the next dividend is lower)` : '') +
        `; DSI ${c.dsi ?? 'n/a'}/100 (rule-based index).`;
    const recLine = `- **Recommendation:** **${c.action}** (composite score ${c.aiScore ?? 'n/a'}/100, a rule-based points total).`;

    if (q.includes('accura') || q.includes('confidence') || q.includes('mape') || q.includes('reliab')) {
        lines.push(`### How reliable is the forecast for **${name}**?`, forecastLine, accuracyLine,
            hy ? `- **Trust in ML for this company's group:** ${Math.round((hy.trustInML ?? 0) * 100)}% (the rest is "same as last year").` : '');
    } else if (q.includes('dsi') || q.includes('safety') || q.includes('cut')) {
        lines.push(`### Dividend safety for **${name}**`, riskLine,
            `- **Payout ratio:** ${c.payoutPct != null ? n(c.payoutPct, 0) + '%' : 'not available'}.`,
            `- The DSI deducts points for high beta, very high yield, low growth and payout above 80%; it is not a probability.`);
    } else if (q.includes('peer') || q.includes('compare')) {
        const peers = (c.peers || []).map(p => `- **${p.ticker}**: yield ${n(p.yield)}%, beta ${n(p.beta)}, score ${p.aiScore}/100`);
        lines.push(`### Peers of **${ticker}**`, recLine, ...(peers.length ? peers : ['- No peer data available.']),
            `- Peer scores use the same rule-based formula with historical growth.`);
    } else {
        lines.push(`### Summary for **${name}** (${ticker})`, recLine, forecastLine, accuracyLine, valueLine, riskLine);
    }
    lines.push('', '*Offline summary built only from the numbers above. Not financial advice.*');
    return lines.filter(Boolean).join('\n');
}

// ── GET /api/ai/recommend/:ticker ────────────────────────────────────────────
router.get('/recommend/:ticker', async (req, res) => {
    const cs = currSym(req.params.ticker);
    const { ticker } = req.params;
    const rfRate = null, rmRate = null;   // each stock uses its own country's rates (lib/rates.js)

    try {
        // Run ML pipeline and basic stock stats in parallel
        const [targetStats, mlResultSettled, ...peersStats] = await Promise.all([
            getStockStats(ticker, rfRate, rmRate),
            mlRoute.runMLPipeline ? mlRoute.runMLPipeline(ticker.toUpperCase(), rfRate, rmRate).catch(err => {
                console.warn(`ML pipeline in AI route warning for ${ticker}:`, err.message);
                return null;
            }) : Promise.resolve(null),
            ...getPeers(ticker).map(t => getStockStats(t, rfRate, rmRate))
        ]);

        if (targetStats.isMock) {
            return res.status(502).json({ error: `Live market data for ${ticker} is unavailable right now. Please try again shortly.`, isMock: true });
        }

        const mlData = mlResultSettled || null;

        // Extract ML forecasts
        const D0 = targetStats.dividendHistory.length > 0 ? targetStats.dividendHistory[targetStats.dividendHistory.length - 1].amount : (targetStats.currentPrice * (targetStats.currentYield / 100));
        const mlFuture = mlData?.futureForecast;
        let mlPredDiv = mlFuture?.mlPrediction || null;
        let confidenceLow = mlFuture?.confidenceLow || (mlPredDiv ? mlPredDiv * 0.95 : null);
        let confidenceHigh = mlFuture?.confidenceHigh || (mlPredDiv ? mlPredDiv * 1.05 : null);
        const mlMape = mlData?.metrics?.ml?.mape || null;
        const mlReliable = mlData?.mlReliable ?? true;
        let mlGrowthRate = mlFuture?.mlGrowthRate != null
            ? mlFuture.mlGrowthRate
            : ((mlPredDiv && D0 > 0) ? ((mlPredDiv - D0) / D0) * 100 : targetStats.g);

        // Prefer the hybrid model where it covers this stock: backtested 2005-2025,
        // with an honest 80% range instead of a fixed +/-5% band.
        const hybrid = getHybrid(ticker);
        if (hybrid) {
            mlPredDiv      = hybrid.forecastDividend;
            confidenceLow  = hybrid.range80Low;
            confidenceHigh = hybrid.range80High;
            mlGrowthRate   = hybrid.changePct;
        }
        const rangeLabel = hybrid ? '80% range from past forecast errors' : 'approximate range (old model)';
        const modelLabel = hybrid ? 'Hybrid model (backtested 2005-2025)' : 'Per-stock Random Forest (old model)';

        // Two-stage dividend valuation: same formula and limits as the ML Analysis tab (lib/rates.js)
        const D1 = mlPredDiv || (D0 * (1 + targetStats.g / 100));
        const valuation    = modelValue(ticker, { price: targetStats.currentPrice, D0: (hybrid && hybrid.lastDividend) || D0, D1,
                                                  growthPct: mlGrowthRate, beta: targetStats.beta });
        const mlIntrinsic  = valuation.value;
        const valuationGap = ((mlIntrinsic - targetStats.currentPrice) / targetStats.currentPrice) * 100;

        // Update targetStats with ML values
        targetStats.intrinsicValue = parseFloat(mlIntrinsic.toFixed(2));
        targetStats.valuationGap   = parseFloat(valuationGap.toFixed(1));

        // Compute ML-based score and breakdown
        const { total: targetScore, breakdown: scoreBreakdown } = calculateMLScore(targetStats, mlMape, mlReliable, mlGrowthRate);
        const dsi = calculateDsi(targetStats);

        let cutRisk = 'Low', cutRiskColor = 'text-emerald-400';
        if      (dsi < 50) { cutRisk = 'High';   cutRiskColor = 'text-rose-400';  }
        else if (dsi < 75) { cutRisk = 'Medium'; cutRiskColor = 'text-amber-400'; }

        // One answer across the app: the same valuation signal as the ML Analysis tab (lib/rates.js),
        // capped by the hybrid cut risk below. The points score is shown as supporting detail only.
        const ACTION_COLORS = {
            'STRONG BUY': 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5',
            'BUY':        'text-teal-400 border-teal-500/30 bg-teal-500/5',
            'HOLD':       'text-amber-400 border-amber-500/30 bg-amber-500/5',
            'SELL':       'text-rose-400 border-rose-500/30 bg-rose-500/5',
        };
        let action = valuation.signal, actionColor = ACTION_COLORS[action];

        // The hybrid model's cut risk overrides an optimistic label:
        // High cut risk -> at most HOLD, Medium -> at most BUY. Cut risk shown = the worse of DSI and hybrid.
        let riskCapNote = null;
        if (hybrid) {
            const order = ['Low', 'Medium', 'High'];
            if (order.indexOf(hybrid.cutRiskLevel) > order.indexOf(cutRisk)) {
                cutRisk = hybrid.cutRiskLevel;
                cutRiskColor = cutRisk === 'High' ? 'text-rose-400' : 'text-amber-400';
            }
            const capTo = hybrid.cutRiskLevel === 'High' ? 'HOLD' : hybrid.cutRiskLevel === 'Medium' ? 'BUY' : null;
            if (capTo && finalSignal(action, hybrid.cutRiskLevel) !== action) {
                riskCapNote = `Valuation alone suggests ${action}, but the hybrid model gives a ${hybrid.cutRiskPct}% (${hybrid.cutRiskLevel}) chance of a dividend cut, so the recommendation is capped at ${capTo}.`;
                action = capTo;
                actionColor = ACTION_COLORS[capTo];
            }
        }

        // ML Insights
        const insights = [];
        if (riskCapNote) insights.push({ type: 'risk', title: 'Cut Risk Caps the Recommendation', text: riskCapNote, impact: 'negative' });

        // 1. ML Valuation Insight
        if (targetStats.valuationGap > 12) {
            insights.push({
                type: 'valuation',
                title: 'Below Model Value',
                text: `Two-stage dividend model value is ${cs}${targetStats.intrinsicValue.toFixed(2)}, ${targetStats.valuationGap.toFixed(1)}% above the price of ${cs}${targetStats.currentPrice.toFixed(2)}. The value depends on the growth forecast and the required return used.`,
                impact: 'positive'
            });
        } else if (targetStats.valuationGap < -12) {
            insights.push({
                type: 'valuation',
                title: 'Above Model Value',
                text: `The price of ${cs}${targetStats.currentPrice.toFixed(2)} is ${Math.abs(targetStats.valuationGap).toFixed(1)}% above the two-stage dividend model value of ${cs}${targetStats.intrinsicValue.toFixed(2)}.`,
                impact: 'negative'
            });
        } else {
            insights.push({
                type: 'valuation',
                title: 'Near Model Value',
                text: `The price of ${cs}${targetStats.currentPrice.toFixed(2)} is within 12% of the two-stage dividend model value of ${cs}${targetStats.intrinsicValue.toFixed(2)} (${targetStats.valuationGap >= 0 ? '+' : ''}${targetStats.valuationGap.toFixed(1)}%).`,
                impact: 'neutral'
            });
        }

        // 2. ML Dividend Growth Forecast Insight
        const nextDivStr = mlPredDiv ? `${cs}${mlPredDiv.toFixed(4)}` : `${cs}${(D0 * (1 + mlGrowthRate/100)).toFixed(4)}`;
        insights.push({
            type: 'growth',
            title: 'Next-Year Dividend Forecast',
            text: `${modelLabel} predicts next annual dividend of ${nextDivStr} (${mlGrowthRate >= 0 ? '+' : ''}${mlGrowthRate.toFixed(1)}% YoY growth). ${rangeLabel}: ${cs}${(confidenceLow || D1*0.95).toFixed(2)} – ${cs}${(confidenceHigh || D1*1.05).toFixed(2)}.${hybrid ? ` Model cut risk: ${hybrid.cutRiskPct}% (${hybrid.cutRiskLevel}).` : ''}`,
            impact: mlGrowthRate >= 4 ? 'positive' : 'neutral'
        });

        // 3. ML Risk & Factor Attribution Insight
        const topDriver = mlData?.companyFactorAttribution?.[0];
        const driverName = topDriver ? (topDriver.title || topDriver.feature || 'Payout Coverage') : (targetStats.payoutPct > 80 ? 'Payout Coverage' : 'Defensive Beta');
        const driverImpact = topDriver ? (topDriver.impact || 'positive') : (targetStats.payoutPct > 80 ? 'negative' : 'positive');
        insights.push({
            type: 'risk',
            title: `Key Input: ${driverName}`,
            text: `${mlMape ? `For this stock the model's average backtest error was ${mlMape.toFixed(1)}%.` : 'No per-stock backtest error is available.'} Input shown: ${driverName.toLowerCase()}${topDriver?.currentValue ? ` (${topDriver.currentValue})` : ''}. Payout ratio: ${targetStats.payoutPct ? targetStats.payoutPct.toFixed(0) + '%' : 'not available'}.`,
            impact: driverImpact
        });

        const peers = peersStats.filter(p => !p.isMock).map(p => {   // never compare against simulated peers
            const pScore = calculateMLScore(p, null, true, p.g);
            return {
                ticker: p.ticker, name: p.name, price: p.currentPrice,
                yield: p.currentYield, growth: p.g, beta: p.beta,
                payoutPct: p.payoutPct,
                aiScore: pScore.total,
                aiScoreRange: `${pScore.total}`
            };
        });

        res.json({
            ticker, name: targetStats.name,
            aiScore:       targetScore,
            aiScoreRange:  `${targetScore}`,
            scoreBreakdown,
            currentPrice:  targetStats.currentPrice,
            intrinsicValue: targetStats.intrinsicValue,
            valuationGap:  targetStats.valuationGap,
            currentYield:  targetStats.currentYield,
            g:             parseFloat(mlGrowthRate.toFixed(2)),
            payoutPct:     targetStats.payoutPct,
            dsi,
            dsiRange:      `${dsi}`,
            cutRisk, cutRiskColor,
            action, actionColor,
            mlForecast: {
                mlPrediction:   mlPredDiv ? parseFloat(mlPredDiv.toFixed(4)) : parseFloat(D1.toFixed(4)),
                confidenceLow:  confidenceLow ? parseFloat(confidenceLow.toFixed(4)) : null,
                confidenceHigh: confidenceHigh ? parseFloat(confidenceHigh.toFixed(4)) : null,
                mlGrowthRate:   parseFloat(mlGrowthRate.toFixed(2)),
                mlMape:         mlMape ? parseFloat(mlMape.toFixed(2)) : null,
                mlReliable,
                model:          modelLabel,
                rangeLevel:     hybrid ? 80 : null,
                hybrid:         hybrid ? {
                    cutRiskPct: hybrid.cutRiskPct, cutRiskLevel: hybrid.cutRiskLevel,
                    trustInML: hybrid.trustInML, forecastYear: hybrid.forecastYear,
                    backtestAccuracyPct: hybrid.backtest.accuracyPct
                } : null,
                topDrivers:     mlData?.companyFactorAttribution || []
            },
            insights, peers,
            timestamp: new Date()
        });
    } catch (err) {
        console.error('AI Route Error:', err.message);
        res.status(500).json({ error: 'Failed to generate AI insights' });
    }
});

// ── POST /api/ai/chat — Groq with Automatic Heuristic Fallback ────────────────
router.post('/chat', async (req, res) => {
    const cs = currSym(req.body?.ticker);
    const { ticker, question, context } = req.body;
    if (!ticker || !question) return res.status(400).json({ error: 'Missing ticker or question' });

    const name           = context?.name           || ticker;
    const score          = context?.aiScore         ?? 'not available';
    const dsi            = context?.dsi             ?? 'not available';
    const action         = context?.action          || 'not available';
    const cutRisk        = context?.cutRisk         || 'not available';
    const currentPrice   = context?.currentPrice    || null;
    const intrinsicValue = context?.intrinsicValue  || null;
    const currentYield   = context?.currentYield    || null;
    const g              = context?.g               || null;
    const payoutPct      = context?.payoutPct       || null;
    const valuationGap   = context?.valuationGap    || null;

    const mlForecast     = context?.mlForecast      || {};
    const mlPrediction   = mlForecast?.mlPrediction ? cs + Number(mlForecast.mlPrediction).toFixed(4) : null;
    const mlGrowth       = mlForecast?.mlGrowthRate != null ? Number(mlForecast.mlGrowthRate).toFixed(1) + '%' : null;
    const mlMape         = mlForecast?.mlMape != null ? Number(mlForecast.mlMape).toFixed(1) + '%' : null;
    const mlCI           = (mlForecast?.confidenceLow && mlForecast?.confidenceHigh) ? `${cs}${Number(mlForecast.confidenceLow).toFixed(2)} – ${cs}${Number(mlForecast.confidenceHigh).toFixed(2)}` : null;
    const topDriversStr  = mlForecast?.topDrivers?.length ? mlForecast.topDrivers.slice(0, 3).map(d => `${d.title || d.feature || 'Factor'} (${d.impact || 'neutral'})`).join(', ') : 'Payout Coverage, Defensive Beta';

    const apiKey = process.env.GROQ_API_KEY;

    // If Groq API Key is configured, attempt LLM completion
    if (apiKey) {
        try {
            const groq = new Groq({ apiKey });

            const peersInfo    = context?.peers    ? context.peers.map(p => `${p.ticker} — Score: ${p.aiScore}, Yield: ${p.yield?.toFixed(2)}%, Growth: ${p.growth?.toFixed(1)}%, Beta: ${p.beta?.toFixed(2)}, Payout: ${p.payoutPct ? p.payoutPct.toFixed(0) + '%' : 'N/A'}`).join('\n') : 'Not available';
            const insightsInfo = context?.insights ? context.insights.map(i => `[${i.type.toUpperCase()}] ${i.title}: ${i.text}`).join('\n') : 'Not available';

            const systemPrompt = `You are a Quantitative ML Dividend Analyst AI embedded in an ML-Powered Dividend Valuation Platform. All your analysis is derived from the platform's ML models (${mlForecast?.model || 'ML model'}), feature attribution, and two-stage ML valuation.

LIVE MACHINE LEARNING DATA FOR ${name} (${ticker}):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Current Market Price:     ${currentPrice  ? cs + Number(currentPrice).toFixed(2)  : 'N/A'}
Two-stage model value:    ${intrinsicValue ? cs + Number(intrinsicValue).toFixed(2) : 'N/A'}
ML Valuation Upside:      ${valuationGap  !== null ? (valuationGap >= 0 ? '+' : '') + Number(valuationGap).toFixed(1) + '%' : 'N/A'}
ML Next Div Prediction:   ${mlPrediction || 'Projected based on ML tree consensus'}
ML Projected Div Growth:  ${mlGrowth || (g !== null ? Number(g).toFixed(1) + '%' : 'N/A')}
Forecast Range:           ${mlCI || 'N/A'}${mlForecast?.rangeLevel ? ` (${mlForecast.rangeLevel}% range)` : ''}
Walk-Forward Error (MAPE):${mlMape || 'not available'}
Top ML Feature Drivers:   ${topDriversStr}
Forward Div Yield:        ${currentYield  !== null ? Number(currentYield).toFixed(2) + '%' : 'N/A'}
Payout Ratio:             ${payoutPct     !== null ? Number(payoutPct).toFixed(0) + '%' : 'N/A'}
Composite score:          ${score}/100 (rule-based points total, not ML)
DSI (rule-based index):   ${dsi} (${cutRisk} Cut Risk)
Recommendation:           ${action} (rule-based; capped by the hybrid model's cut risk)

Key Insights:
${insightsInfo}

Peer Comparison:
${peersInfo}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RULES:
- Use only the numbers above. Never invent figures, probabilities, track records or outcomes.
- Say clearly that the composite score and DSI are rule-based, and that the dividend forecast comes from the hybrid model.
- Never promise returns or certainty; mention that this is not financial advice when discussing buying or selling.
- Address questions about profit and confidence with financial clarity.
- Be concise (3–6 sentences or 4–6 bullet points).
- Use **bold** for key figures.`;

            // Groq retires models over time: GROQ_MODEL from .env first, then known ones
            const models = [process.env.GROQ_MODEL, 'openai/gpt-oss-20b', 'openai/gpt-oss-120b',
                'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'].filter(Boolean);
            let completion, lastErr;
            for (const model of models) {
                try {
                    const req = {
                        model,
                        messages:    [
                            { role: 'system', content: systemPrompt },
                            { role: 'user',   content: question      }
                        ],
                        max_tokens:  1500,
                        temperature: 0.7
                    };
                    if (model.startsWith('openai/gpt-oss')) req.reasoning_effort = 'low';
                    completion = await groq.chat.completions.create(req);
                    break;
                } catch (mErr) {
                    lastErr = mErr;
                    console.warn(`Groq chat model ${model} failed: ${mErr.status || ''} ${mErr.message}`.slice(0, 200));
                    if (mErr.status === 401 || mErr.status === 403) break;
                }
            }
            if (!completion) throw lastErr || new Error('no Groq model available');

            const reply = completion?.choices?.[0]?.message?.content;
            if (reply) return res.json({ reply, source: 'groq' });
        } catch (err) {
            console.warn('Groq fallback triggered:', err.message);
        }
    }

    // Seamless offline/fallback heuristic engine
    const heuristicReply = generateOfflineAIResponse(ticker, question, context);
    return res.json({ reply: heuristicReply, source: 'heuristic-engine' });
});

module.exports = router;
