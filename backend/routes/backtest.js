'use strict';

const express = require('express');
const router  = express.Router();
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({
    suppressNotices: ['yahooSurvey'],
    logger: { ...console, warn: (msg, ...args) => { if (!String(msg).includes('Unsupported environment')) console.warn(msg, ...args); } }
});
const { RandomForestRegression } = require('ml-random-forest');

/* ══════════════════════════════════════════════════════════════════
   ML HELPERS  (self-contained, no leakage)
══════════════════════════════════════════════════════════════════ */
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function safeDiv(a, b) { return b !== 0 ? a / b : 0; }

function buildFeatureVector(divHistory, fundamentals, rfRate, rmRate) {
    const n = divHistory.length;
    if (n < 2) return null;
    const prevDiv  = divHistory[n - 1];
    const prev2Div = n >= 2 ? divHistory[n - 2] : prevDiv;
    const prev3Div = n >= 3 ? divHistory[n - 3] : prev2Div;
    const divGrowth1Y     = safeDiv(prevDiv - prev2Div, Math.max(0.0001, prev2Div));
    const prevDivGrowth1Y = safeDiv(prev2Div - prev3Div, Math.max(0.0001, prev3Div));
    const divCAGR3Y       = n >= 4 ? Math.pow(safeDiv(prevDiv, Math.max(0.0001, divHistory[n - 4])), 1 / 3) - 1 : divGrowth1Y;
    const divAcceleration = divGrowth1Y - prevDivGrowth1Y;
    const { payoutRatio = 0.55, eps = prevDiv / 0.55, beta = 1.0, peRatio = 20 } = fundamentals || {};
    const yieldProxy   = safeDiv(prevDiv, Math.max(0.001, eps * peRatio / 10));
    const payoutStress = clamp(yieldProxy * payoutRatio, 0, 1);
    const yieldSpread  = yieldProxy - (rfRate / 100);
    const momentumScore = Math.sign(divGrowth1Y) * Math.log1p(Math.abs(divCAGR3Y));
    return [
        prevDiv,
        clamp(divGrowth1Y,    -0.5,  1.0),
        clamp(divCAGR3Y,      -0.3,  0.5),
        clamp(divAcceleration,-0.5,  0.5),
        clamp(payoutRatio,     0.0,  1.5),
        payoutStress,
        clamp(eps,             0.0, 30.0),
        clamp(beta,            0.1,  3.0),
        clamp(peRatio,         2.0, 80.0),
        clamp(yieldSpread,    -0.1,  0.2),
        momentumScore,
    ];
}

function mlIntrinsicValue(yearlyDivs, currentYear, price, fundamentals, rfRate, rmRate) {
    const availableYears = Object.keys(yearlyDivs).map(Number)
        .filter(y => y < currentYear).sort();
    if (availableYears.length < 2) return null;

    const divAmounts = availableYears.map(y => yearlyDivs[y]);
    const R   = (rfRate / 100) + (fundamentals.beta || 1.0) * ((rmRate / 100) - (rfRate / 100));
    const first = divAmounts[0];
    const last  = divAmounts[divAmounts.length - 1];
    const n     = divAmounts.length - 1;
    const ddmG  = Math.pow(last / first, 1 / n) - 1;
    const ddmD1 = last * (1 + ddmG);
    const ddmDenom = R - ddmG;
    const ddmIntrinsic = (ddmDenom > 0.001) ? ddmD1 / ddmDenom : price * 1.1;

    if (availableYears.length < 4) {
        return { intrinsicValue: ddmIntrinsic, mlDivPred: null, mlGrowthRate: ddmG, method: 'DDM' };
    }

    try {
        const MIN_TRAIN = 3;
        const trainX = [], trainY = [];
        for (let i = MIN_TRAIN; i < divAmounts.length; i++) {
            const hist   = divAmounts.slice(0, i);
            const prev   = divAmounts[i - 1];
            const actual = divAmounts[i];
            const growth = safeDiv(actual - prev, Math.max(0.0001, prev));
            const fv     = buildFeatureVector(hist, fundamentals, rfRate, rmRate);
            if (fv) { trainX.push(fv); trainY.push(growth); }
        }
        if (trainX.length < 2) {
            return { intrinsicValue: ddmIntrinsic, mlDivPred: null, mlGrowthRate: ddmG, method: 'DDM' };
        }
        const rf = new RandomForestRegression({ nEstimators: 100, maxDepth: 4, minNumSamples: 1, seed: 42 });
        rf.train(trainX, trainY);
        const forecastFV = buildFeatureVector(divAmounts, fundamentals, rfRate, rmRate);
        if (!forecastFV) {
            return { intrinsicValue: ddmIntrinsic, mlDivPred: null, mlGrowthRate: ddmG, method: 'DDM' };
        }
        const mlGrowthRate = rf.predict([forecastFV])[0];
        const mlDivPred    = last * (1 + mlGrowthRate);
        const blendedG     = 0.70 * mlGrowthRate + 0.30 * ddmG;
        const blendedD1    = last * (1 + blendedG);
        const blendedDenom = R - blendedG;
        const mlIntrinsic  = blendedDenom > 0.001 ? blendedD1 / blendedDenom : price * 1.1;
        return { intrinsicValue: mlIntrinsic, mlDivPred: +mlDivPred.toFixed(4), mlGrowthRate: +mlGrowthRate.toFixed(4), method: 'ML-RF' };
    } catch (e) {
        return { intrinsicValue: ddmIntrinsic, mlDivPred: null, mlGrowthRate: ddmG, method: 'DDM-fallback' };
    }
}

/* ══════════════════════════════════════════════════════════════════
   MAIN BACKTEST ROUTE
══════════════════════════════════════════════════════════════════ */
router.get('/:ticker', async (req, res) => {
    const { ticker }         = req.params;
    const years              = parseInt(req.query.years)       || 5;
    const initialInvestment  = parseFloat(req.query.investment) || 10000;
    const rfRate             = parseFloat(req.query.rf)        || 4.5;
    const rmRate             = parseFloat(req.query.rm)        || 10.0;
    const dripEnabled        = req.query.drip !== 'false';

    try {
        const endDate   = new Date();
        const startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - years);

        let chartData;
        try {
            chartData = await yf.chart(ticker, { period1: startDate, period2: endDate, interval: '1mo', events: 'div' });
        } catch (e) {
            return res.json(getMockBacktestResponse(ticker, years, initialInvestment, dripEnabled));
        }

        const quotes         = (chartData.quotes || []).filter(q => q.close || q.adjclose);
        const dividendEvents = chartData.events?.dividends || [];
        if (quotes.length < 12) return res.json(getMockBacktestResponse(ticker, years, initialInvestment, dripEnabled));

        // ── Fundamentals for ML ───────────────────────────────────────────────
        let fundamentals = { payoutRatio: 0.55, eps: 2.0, beta: 1.0, peRatio: 20 };
        try {
            const [quoteRes, summaryRes] = await Promise.allSettled([
                yf.quote(ticker),
                yf.quoteSummary(ticker, { modules: ['defaultKeyStatistics', 'financialData', 'summaryDetail'] })
            ]);
            const q  = quoteRes.status  === 'fulfilled' ? quoteRes.value  : {};
            const sm = summaryRes.status === 'fulfilled' ? summaryRes.value : {};
            const ks = sm.defaultKeyStatistics || {};
            const fd = sm.financialData        || {};
            const sd = sm.summaryDetail        || {};
            fundamentals = {
                payoutRatio: clamp(sd.payoutRatio || ks.payoutRatio || 0.55, 0, 2),
                eps:         clamp(ks.trailingEps || fd.revenuePerShare || 2.0, 0.01, 50),
                beta:        clamp(q.beta || ks.beta || 1.0, 0.1, 3.0),
                peRatio:     clamp(q.trailingPE || ks.trailingPE || 20, 2, 80),
            };
        } catch (e) {}

        // ── Dividend calendar ─────────────────────────────────────────────────
        const divCalendar = {};
        dividendEvents.forEach(d => {
            const dDate   = new Date(d.date < 10000000000 ? d.date * 1000 : d.date);
            const dateKey = dDate.toISOString().split('T')[0].slice(0, 7);
            divCalendar[dateKey] = (divCalendar[dateKey] || 0) + d.amount;
        });

        // ── Yearly dividends ──────────────────────────────────────────────────
        const yearlyDivs = {};
        dividendEvents.forEach(d => {
            const dDate = new Date(d.date < 10000000000 ? d.date * 1000 : d.date);
            const year  = dDate.getFullYear();
            if (year > 2000 && year < 2100) yearlyDivs[year] = (yearlyDivs[year] || 0) + d.amount;
        });

        // ── Simulation state ──────────────────────────────────────────────────
        let cash            = initialInvestment, shares = 0;
        let dripCash        = initialInvestment, dripShares = 0;
        let benchmarkShares = 0, benchmarkInit = false;
        let position = 'OUT', dripPosition = 'OUT';
        const trades = [], equityCurve = [], divIncomeList = [];
        let totalDivIncome = 0, dripDivIncome = 0;
        let peakValue = initialInvestment, maxDrawdown = 0;
        const monthlyReturns = [];
        let prevPortValue = initialInvestment, initCostBasis = 0, dripCostBasis = 0;
        const mlCache = {};

        for (let i = 0; i < quotes.length; i++) {
            const q     = quotes[i];
            const price = q.close || q.adjclose;
            if (!price || price <= 0) continue;

            const date     = new Date(q.date);
            const dateStr  = date.toISOString().split('T')[0];
            const monthKey = dateStr.slice(0, 7);

            if (!benchmarkInit) { benchmarkShares = initialInvestment / price; benchmarkInit = true; }

            const divThisMonth = divCalendar[monthKey] || 0;
            if (divThisMonth > 0 && shares > 0)     { const inc = divThisMonth * shares;     totalDivIncome += inc; cash      += inc; }
            if (divThisMonth > 0 && dripShares > 0) { const inc = divThisMonth * dripShares; dripDivIncome  += inc; if (dripEnabled) dripShares += inc / price; else dripCash += inc; }

            const portfolioValue = position     === 'IN' ? shares     * price : cash;
            const dripValue      = dripPosition === 'IN' ? dripShares * price : dripCash;
            const benchmarkValue = benchmarkShares * price;

            if (portfolioValue > peakValue) peakValue = portfolioValue;
            const drawdown = ((peakValue - portfolioValue) / peakValue) * 100;
            if (drawdown > maxDrawdown) maxDrawdown = drawdown;
            if (prevPortValue > 0) monthlyReturns.push((portfolioValue - prevPortValue) / prevPortValue);
            prevPortValue = portfolioValue;

            const annualDiv = Object.values(yearlyDivs).slice(-1)[0] || 0;
            const yoc       = initCostBasis > 0 && annualDiv > 0 ? (annualDiv / initCostBasis) * 100 : 0;
            const dripYoc   = dripCostBasis > 0 && annualDiv > 0 ? (annualDiv / dripCostBasis) * 100 : 0;

            equityCurve.push({
                date: dateStr,
                portfolioValue: parseFloat(portfolioValue.toFixed(2)),
                dripValue:      parseFloat(dripValue.toFixed(2)),
                benchmarkValue: parseFloat(benchmarkValue.toFixed(2)),
                divIncome:      parseFloat(totalDivIncome.toFixed(2)),
                dripDivIncome:  parseFloat(dripDivIncome.toFixed(2)),
                yoc:            parseFloat(yoc.toFixed(2)),
                dripYoc:        parseFloat(dripYoc.toFixed(2))
            });
            divIncomeList.push({ date: dateStr, cumIncome: parseFloat(totalDivIncome.toFixed(2)) });

            // ── ML quarterly signal ───────────────────────────────────────────
            if (i % 3 === 0 && i > 0) {
                const currentYear = date.getFullYear();
                const quarter     = Math.ceil((date.getMonth() + 1) / 3);
                const cacheKey    = `${currentYear}-Q${quarter}`;

                if (!mlCache[cacheKey]) {
                    mlCache[cacheKey] = mlIntrinsicValue(yearlyDivs, currentYear, price, fundamentals, rfRate, rmRate);
                }
                const mlResult = mlCache[cacheKey];

                if (mlResult) {
                    const intrinsicValue = mlResult.intrinsicValue;
                    const profitPct      = ((intrinsicValue - price) / price) * 100;
                    let signal = 'HOLD';
                    if (profitPct >  10) signal = 'BUY';
                    if (profitPct < -10) signal = 'SELL';

                    const tradeBase = {
                        date: dateStr, signal,
                        price:          +price.toFixed(2),
                        intrinsicValue: +intrinsicValue.toFixed(2),
                        mlMethod:       mlResult.method,
                        mlDivPred:      mlResult.mlDivPred,
                        mlGrowthRate:   mlResult.mlGrowthRate !== null ? +(mlResult.mlGrowthRate * 100).toFixed(2) : null,
                    };

                    if (signal === 'BUY' && position === 'OUT') {
                        shares = cash / price; cash = 0; position = 'IN'; initCostBasis = price;
                        trades.push({ ...tradeBase, shares: +shares.toFixed(4), portfolioValue: +(shares * price).toFixed(2) });
                    } else if (signal === 'SELL' && position === 'IN') {
                        cash = shares * price; shares = 0; position = 'OUT';
                        trades.push({ ...tradeBase, shares: 0, portfolioValue: +cash.toFixed(2) });
                    } else if (signal !== 'HOLD') {
                        const cur = position === 'IN' ? shares * price : cash;
                        trades.push({ ...tradeBase, signal: signal + ' (HELD)', shares: +shares.toFixed(4), portfolioValue: +cur.toFixed(2) });
                    }

                    if (signal === 'BUY' && dripPosition === 'OUT') { dripShares = dripCash / price; dripCash = 0; dripPosition = 'IN'; dripCostBasis = price; }
                    else if (signal === 'SELL' && dripPosition === 'IN') { dripCash = dripShares * price; dripShares = 0; dripPosition = 'OUT'; }
                }
            }
        }

        const lastPrice           = quotes[quotes.length - 1].close || quotes[quotes.length - 1].adjclose;
        const finalPortValue      = position     === 'IN' ? shares     * lastPrice : cash;
        const finalDripValue      = dripPosition === 'IN' ? dripShares * lastPrice : dripCash;
        const finalBenchmarkValue = benchmarkShares * lastPrice;
        const totalReturn         = ((finalPortValue      - initialInvestment) / initialInvestment) * 100;
        const dripReturn          = ((finalDripValue      - initialInvestment) / initialInvestment) * 100;
        const benchmarkReturn     = ((finalBenchmarkValue - initialInvestment) / initialInvestment) * 100;

        let wins = 0, totalPairs = 0;
        for (let i = 0; i < trades.length - 1; i++) {
            if (trades[i].signal === 'BUY') {
                for (let j = i + 1; j < trades.length; j++) {
                    if (trades[j].signal === 'SELL') { totalPairs++; if (trades[j].portfolioValue > trades[i].portfolioValue) wins++; break; }
                }
            }
        }
        const winRate = totalPairs > 0 ? (wins / totalPairs) * 100 : 0;

        const avgReturn = monthlyReturns.length ? mean(monthlyReturns) : 0;
        const stdReturn = monthlyReturns.length > 1
            ? Math.sqrt(monthlyReturns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / (monthlyReturns.length - 1)) : 1;
        const sharpeRatio = stdReturn > 0 ? ((avgReturn - (rfRate / 100 / 12)) / stdReturn) * Math.sqrt(12) : 0;

        const annualDiv2   = Object.values(yearlyDivs).slice(-1)[0] || 0;
        const finalYoc     = initCostBasis > 0 && annualDiv2 > 0 ? (annualDiv2 / initCostBasis) * 100 : 0;
        const finalDripYoc = dripCostBasis > 0 && annualDiv2 > 0 ? (annualDiv2 / dripCostBasis) * 100 : 0;

        const mlCount  = trades.filter(t => t.mlMethod === 'ML-RF').length;
        const ddmCount = trades.filter(t => t.mlMethod && t.mlMethod !== 'ML-RF').length;

        // ── ML Dividend Accuracy: year-by-year walk-forward audit ─────────────
        const divPredictions = [];
        const sortedYears = Object.keys(yearlyDivs).map(Number).sort();
        for (let yi = 3; yi < sortedYears.length; yi++) {
            const targetYear  = sortedYears[yi];
            const actualDiv   = yearlyDivs[targetYear];
            if (!actualDiv || actualDiv <= 0) continue;

            const priorYears   = sortedYears.slice(0, yi);
            const priorAmounts = priorYears.map(y => yearlyDivs[y]);
            const lastDiv      = priorAmounts[priorAmounts.length - 1];

            // DDM CAGR baseline
            const ddmFirstDiv = priorAmounts[0];
            const ddmN        = priorAmounts.length - 1;
            const ddmG        = ddmN > 0 && ddmFirstDiv > 0 ? Math.pow(lastDiv / ddmFirstDiv, 1 / ddmN) - 1 : 0;
            const ddmPred     = +( lastDiv * (1 + ddmG) ).toFixed(4);

            let mlPred = null, predMethod = 'DDM';
            if (priorAmounts.length >= 4) {
                try {
                    const MIN_T = 3;
                    const tX = [], tY = [];
                    for (let k = MIN_T; k < priorAmounts.length; k++) {
                        const hist    = priorAmounts.slice(0, k);
                        const prev    = priorAmounts[k - 1];
                        const actual2 = priorAmounts[k];
                        const growth  = safeDiv(actual2 - prev, Math.max(0.0001, prev));
                        const fv      = buildFeatureVector(hist, fundamentals, rfRate, rmRate);
                        if (fv) { tX.push(fv); tY.push(growth); }
                    }
                    if (tX.length >= 2) {
                        const rfm = new RandomForestRegression({ nEstimators: 100, maxDepth: 4, minNumSamples: 1, seed: 42 });
                        rfm.train(tX, tY);
                        const fv2 = buildFeatureVector(priorAmounts, fundamentals, rfRate, rmRate);
                        if (fv2) {
                            const g2 = rfm.predict([fv2])[0];
                            mlPred = +( lastDiv * (1 + g2) ).toFixed(4);
                            predMethod = 'ML-RF';
                        }
                    }
                } catch (e) { /* fallback to DDM */ }
            }

            const usedPred  = mlPred !== null ? mlPred : ddmPred;
            const errAbs    = Math.abs(usedPred - actualDiv);
            const errPct    = actualDiv > 0 ? (errAbs / actualDiv) * 100 : 0;
            const mlErrPct  = mlPred !== null && actualDiv > 0 ? (Math.abs(mlPred - actualDiv) / actualDiv) * 100 : null;
            const ddmErrPct = actualDiv > 0 ? (Math.abs(ddmPred - actualDiv) / actualDiv) * 100 : null;

            let tier;
            if (errPct <= 5)       tier = 'excellent';
            else if (errPct <= 10) tier = 'good';
            else if (errPct <= 20) tier = 'fair';
            else                   tier = 'miss';

            divPredictions.push({
                year:      targetYear,
                actual:    +actualDiv.toFixed(4),
                mlPred:    mlPred !== null ? mlPred : null,
                ddmPred,
                usedPred,
                errPct:    +errPct.toFixed(2),
                mlErrPct:  mlErrPct !== null ? +mlErrPct.toFixed(2) : null,
                ddmErrPct: ddmErrPct !== null ? +ddmErrPct.toFixed(2) : null,
                tier,
                method:    predMethod,
                mlWon:     mlPred !== null && ddmErrPct !== null ? (Math.abs(mlPred - actualDiv) < Math.abs(ddmPred - actualDiv)) : null,
            });
        }

        const mlRows     = divPredictions.filter(r => r.mlErrPct !== null);
        const mlWins2    = mlRows.filter(r => r.mlWon === true).length;
        const excellent  = divPredictions.filter(r => r.tier === 'excellent').length;
        const good       = divPredictions.filter(r => r.tier === 'good').length;
        const fair       = divPredictions.filter(r => r.tier === 'fair').length;
        const miss       = divPredictions.filter(r => r.tier === 'miss').length;
        const avgMlErr   = mlRows.length > 0
            ? +(mlRows.reduce((s, r) => s + r.mlErrPct, 0) / mlRows.length).toFixed(2) : null;
        const avgDdmErr  = divPredictions.length > 0
            ? +(divPredictions.reduce((s, r) => s + (r.ddmErrPct || 0), 0) / divPredictions.length).toFixed(2) : null;

        const mlDivAccuracy = {
            totalPeriods: divPredictions.length,
            mlPeriods:    mlRows.length,
            mlWins:       mlWins2,
            mlWinRate:    mlRows.length > 0 ? +((mlWins2 / mlRows.length) * 100).toFixed(1) : null,
            avgMlErrPct:  avgMlErr,
            avgDdmErrPct: avgDdmErr,
            excellent, good, fair, miss,
            within5Pct:   +((excellent / Math.max(divPredictions.length, 1)) * 100).toFixed(1),
            within10Pct:  +((( excellent + good) / Math.max(divPredictions.length, 1)) * 100).toFixed(1),
        };

        res.json({
            ticker, years, initialInvestment, dripEnabled,
            equityCurve, trades,
            divPredictions,
            mlDivAccuracy,
            metrics: {
                totalReturn:         +totalReturn.toFixed(2),
                dripReturn:          +dripReturn.toFixed(2),
                benchmarkReturn:     +benchmarkReturn.toFixed(2),
                winRate:             +winRate.toFixed(1),
                maxDrawdown:         +maxDrawdown.toFixed(2),
                sharpeRatio:         +sharpeRatio.toFixed(2),
                totalTrades:         trades.filter(t => t.signal === 'BUY' || t.signal === 'SELL').length,
                finalValue:          +finalPortValue.toFixed(2),
                dripFinalValue:      +finalDripValue.toFixed(2),
                benchmarkFinalValue: +finalBenchmarkValue.toFixed(2),
                totalDivIncome:      +totalDivIncome.toFixed(2),
                dripDivIncome:       +dripDivIncome.toFixed(2),
                yieldOnCost:         +finalYoc.toFixed(2),
                dripYieldOnCost:     +finalDripYoc.toFixed(2),
                mlSignalCount:       mlCount,
                ddmFallbackCount:    ddmCount,
            },
            signalEngine: mlCount >= ddmCount ? 'ML Random Forest' : 'DDM Fallback',
            isMock: false
        });

    } catch (err) {
        console.error('Backtest error:', err.message);
        res.json(getMockBacktestResponse(ticker, years, initialInvestment, dripEnabled));
    }
});

function getMockBacktestResponse(ticker, years, investment, drip) {
    const equityCurve = [], trades = [];
    const startDate = new Date(); startDate.setFullYear(startDate.getFullYear() - years);
    let pv = investment, dripV = investment, bv = investment, divInc = 0, dripInc = 0;
    for (let m = 0; m < years * 12; m++) {
        const d = new Date(startDate); d.setMonth(d.getMonth() + m);
        const mr = 0.005 + (Math.random() - 0.45) * 0.04;
        const bmr = 0.006 + (Math.random() - 0.45) * 0.03;
        const divM = 0.00065 * pv;
        pv *= (1 + mr); bv *= (1 + bmr); divInc += divM; dripInc += divM;
        dripV *= (1 + mr); dripV += drip ? divM : 0;
        equityCurve.push({ date: d.toISOString().split('T')[0], portfolioValue: +pv.toFixed(2), dripValue: +dripV.toFixed(2), benchmarkValue: +bv.toFixed(2), divIncome: +divInc.toFixed(2), dripDivIncome: +dripInc.toFixed(2), yoc: +(2.8 + m * 0.01).toFixed(2), dripYoc: +(3.1 + m * 0.015).toFixed(2) });
        if (m % 6 === 3) trades.push({ date: d.toISOString().split('T')[0], signal: m % 12 === 3 ? 'BUY' : 'SELL', price: +(50 + Math.random() * 20).toFixed(2), intrinsicValue: +(55 + Math.random() * 25).toFixed(2), shares: +(investment / 60).toFixed(4), portfolioValue: +pv.toFixed(2), mlMethod: 'ML-RF', mlDivPred: null, mlGrowthRate: null });
    }
    const tr = ((pv - investment) / investment) * 100;
    const dr = ((dripV - investment) / investment) * 100;
    const br = ((bv - investment) / investment) * 100;
    return { ticker, years, initialInvestment: investment, dripEnabled: drip, equityCurve, trades, metrics: { totalReturn: +tr.toFixed(2), dripReturn: +dr.toFixed(2), benchmarkReturn: +br.toFixed(2), winRate: 62.5, maxDrawdown: 8.4, sharpeRatio: 1.15, totalTrades: trades.length, finalValue: +pv.toFixed(2), dripFinalValue: +dripV.toFixed(2), benchmarkFinalValue: +bv.toFixed(2), totalDivIncome: +divInc.toFixed(2), dripDivIncome: +dripInc.toFixed(2), yieldOnCost: 3.4, dripYieldOnCost: 4.1, mlSignalCount: trades.length, ddmFallbackCount: 0 }, signalEngine: 'ML Random Forest', isMock: true };
}

module.exports = router;
