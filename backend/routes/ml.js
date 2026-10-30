/**
 * ML Dividend Prediction Engine (State-of-the-Art Edition)
 * ─────────────────────────────────────────────────────────────────────────────
 * Predicts Year-over-Year (YoY) Dividend Growth Rate rather than absolute values,
 * solving the fundamental tree-extrapolation flaw.
 * Incorporates macroeconomic variables (risk-free rate, market return) and
 * advanced stress features (payout stress, div acceleration).
 */

'use strict';

const express = require('express');
const router  = express.Router();
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({
    suppressNotices: ['yahooSurvey'],
    logger: { ...console, warn: (msg, ...args) => {
        if (!String(msg).includes('Unsupported environment')) console.warn(msg, ...args);
    }}
});
const { RandomForestRegression } = require('ml-random-forest');

/* ══════════════════════════════════════════════════════════════════
   FEATURE NAMES (order is fixed — used for SHAP indexing)
══════════════════════════════════════════════════════════════════ */
const FEATURE_NAMES = [
    'prevDiv',         // D(t-1)
    'divGrowth1Y',     // (D(t-1) - D(t-2)) / D(t-2)
    'divCAGR3Y',       // 3-year compound annual growth rate
    'divAcceleration', // divGrowth1Y - divGrowth1Y(t-1)
    'payoutRatio',     // EPS-based payout ratio
    'payoutStress',    // yieldProxy * payoutRatio
    'eps',             // Trailing EPS
    'beta',            // Market beta
    'peRatio',         // Price-to-earnings
    'yieldSpread',     // proxy yield - risk free rate
    'momentumScore',   // sign(divGrowth1Y) * log(1 + |divCAGR3Y|)
];

/* ══════════════════════════════════════════════════════════════════
   MATH HELPERS
══════════════════════════════════════════════════════════════════ */
function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function std(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}
function mae(actuals, preds) {
    if (!actuals.length) return 0;
    return mean(actuals.map((a, i) => Math.abs(a - preds[i])));
}
function rmse(actuals, preds) {
    if (!actuals.length) return 0;
    return Math.sqrt(mean(actuals.map((a, i) => (a - preds[i]) ** 2)));
}
function mape(actuals, preds) {
    const valid = actuals.map((a, i) => ({ a, p: preds[i] })).filter(v => Math.abs(v.a) > 0.001);
    if (!valid.length) return 0;
    return mean(valid.map(v => Math.abs((v.a - v.p) / v.a))) * 100;
}
function pearson(xs, ys) {
    const n = xs.length;
    if (n < 2) return 0;
    const mx = mean(xs), my = mean(ys);
    const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    const den = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) *
                          ys.reduce((s, y) => s + (y - my) ** 2, 0));
    return den === 0 ? 0 : num / den;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function safeDiv(a, b) { return b !== 0 ? a / b : 0; }

/* ══════════════════════════════════════════════════════════════════
   FORMULA DDM  (Gordon Growth) — no-leakage version
   Called with only data available up to a given year
══════════════════════════════════════════════════════════════════ */
function gordonDDM(divsBefore, beta = 1.0, rfRate = 4.5, rmRate = 10.0) {
    if (!divsBefore || divsBefore.length < 2) return null;
    const R = (rfRate / 100) + beta * ((rmRate / 100) - (rfRate / 100));
    const first = divsBefore[0];
    const last  = divsBefore[divsBefore.length - 1];
    const n     = divsBefore.length - 1;
    if (first <= 0 || last <= 0) return null;
    const g  = Math.pow(last / first, 1 / n) - 1;   // CAGR as decimal
    const D1 = last * (1 + g);
    const denom = R - g;
    if (denom <= 0.001) return last * (1 + g); // growth ≥ required return: return next-div estimate
    const intrinsic = D1 / denom;
    // Formula dividend prediction = last * (1 + g)  i.e. pure Gordon next-period div forecast
    return parseFloat((last * (1 + g)).toFixed(4));
}

/* ══════════════════════════════════════════════════════════════════
   FEATURE BUILDER
   Given the ordered dividend history up to (but not including) targetYear,
   build one feature vector for predicting targetYear's dividend growth.
══════════════════════════════════════════════════════════════════ */
function buildFeatureVector(divHistory, fundamentals, rfRate, rmRate) {
    const n = divHistory.length;
    if (n < 2) return null;

    const prevDiv  = divHistory[n - 1].amount;
    const prev2Div = n >= 2 ? divHistory[n - 2].amount : prevDiv;
    const prev3Div = n >= 3 ? divHistory[n - 3].amount : prev2Div;

    const divGrowth1Y = safeDiv(prevDiv - prev2Div, Math.max(0.0001, prev2Div));
    const prevDivGrowth1Y = safeDiv(prev2Div - prev3Div, Math.max(0.0001, prev3Div));
    
    const divCAGR3Y   = n >= 4
        ? Math.pow(safeDiv(prevDiv, Math.max(0.0001, divHistory[n - 4].amount)), 1 / 3) - 1
        : divGrowth1Y;
        
    const divAcceleration = divGrowth1Y - prevDivGrowth1Y;

    const { payoutRatio = 0.55, eps = prevDiv / 0.55, beta = 1.0, peRatio = 20, price = 100 } = fundamentals || {};
    const stockPrice    = Math.max(0.1, price || (eps * peRatio));
    const yieldProxy    = clamp(safeDiv(prevDiv, stockPrice), 0, 0.25);
    
    const payoutStress = clamp(yieldProxy * payoutRatio, 0, 1);
    const yieldSpread  = yieldProxy - (rfRate / 100);
    const momentumScore = Math.sign(divGrowth1Y) * Math.log1p(Math.abs(clamp(divCAGR3Y, -0.5, 1.0)));

    return [
        prevDiv,
        clamp(divGrowth1Y,     -0.5,  0.6),
        clamp(divCAGR3Y,       -0.3,  0.4),
        clamp(divAcceleration, -0.4,  0.4),
        clamp(payoutRatio,      0.0,  1.5),
        payoutStress,
        clamp(eps,              0.0, 500.0),
        clamp(beta,             0.1,  3.0),
        clamp(peRatio,          2.0, 80.0),
        clamp(yieldSpread,     -0.1,  0.2),
        momentumScore,
    ];
}

/* ══════════════════════════════════════════════════════════════════
   SHAP-STYLE FEATURE ATTRIBUTION (Growth to Absolute $)
   For a fitted model and one sample, compute signed dollar contributions.
══════════════════════════════════════════════════════════════════ */
function computeShap(model, featureVector, backgroundMeans, prevDiv) {
    // Model predicts growth rate
    const baseGrowthPred = model.predict([featureVector])[0];
    const contributions = {};

    FEATURE_NAMES.forEach((name, i) => {
        const perturbed = [...featureVector];
        perturbed[i] = backgroundMeans[i]; // replace with background mean
        const perturbedGrowthPred = model.predict([perturbed])[0];
        
        // Difference in growth rate caused by this feature
        const growthImpact = baseGrowthPred - perturbedGrowthPred;
        
        // Convert to absolute dollar impact
        const dollarImpact = prevDiv * growthImpact;
        
        contributions[name] = parseFloat(dollarImpact.toFixed(6));
    });

    return contributions;
}

/* ══════════════════════════════════════════════════════════════════
   FEATURE IMPORTANCE
══════════════════════════════════════════════════════════════════ */
function computeFeatureImportance(model, trainX, backgroundMeans, trainPrevDivs) {
    const contributions = FEATURE_NAMES.map(() => []);
    for (let i = 0; i < trainX.length; i++) {
        const fv = trainX[i];
        const prevDiv = trainPrevDivs[i];
        const shap = computeShap(model, fv, backgroundMeans, prevDiv);
        FEATURE_NAMES.forEach((name, fi) => contributions[fi].push(Math.abs(shap[name])));
    }
    const raw = FEATURE_NAMES.map((name, i) => ({ feature: name, importance: mean(contributions[i]) }));
    const total = raw.reduce((s, r) => s + r.importance, 0) || 1;
    return raw.map(r => ({ feature: r.feature, importance: parseFloat((r.importance / total).toFixed(4)) }))
              .sort((a, b) => b.importance - a.importance);
}

/* ══════════════════════════════════════════════════════════════════
   MAIN PREDICTION PIPELINE
══════════════════════════════════════════════════════════════════ */
async function runMLPipeline(ticker, rfRate = 4.5, rmRate = 10.0) {

    /* ── 1. Fetch 10 complete years of dividends ───────────────── */
    const now = new Date();
    const currentYear = now.getFullYear();
    const divStart = new Date(currentYear - 10, 0, 1);

    let rawDividends = [];
    try {
        const divData = await yf.chart(ticker, {
            period1:  divStart,
            period2:  now,
            interval: '1mo',
            events:   'div'
        });
        rawDividends = divData.events?.dividends || [];
    } catch (e) {
        throw new Error('Could not fetch dividend history: ' + e.message);
    }

    /* ── 2. Aggregate to yearly totals & compute Trailing 12-Month (TTM) ── */
    const yearlyMap = {};
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    let ttmDividend = 0;

    rawDividends.forEach(d => {
        const dDate = new Date(d.date < 10000000000 ? d.date * 1000 : d.date);
        const year  = dDate.getFullYear();
        if (year >= (currentYear - 10) && year < currentYear) {
            yearlyMap[year] = (yearlyMap[year] || 0) + d.amount;
        }
        if (dDate >= oneYearAgo && dDate <= now) {
            ttmDividend += d.amount;
        }
    });

    const historicalDivs = Object.keys(yearlyMap)
        .map(Number)
        .sort()
        .map(y => ({ year: y, amount: parseFloat(yearlyMap[y].toFixed(4)) }))
        .filter(d => d.amount > 0);

    // Current year annual dividend baseline is the empirical Trailing 12-Month (TTM) dividend
    const baseDivForForecast = ttmDividend > 0
        ? parseFloat(ttmDividend.toFixed(4))
        : (historicalDivs.length ? historicalDivs[historicalDivs.length - 1].amount : 1.0);

    const divHistory = [...historicalDivs, { year: currentYear, amount: baseDivForForecast }];
    const currentYearDiv = divHistory.find(d => d.year === currentYear);

    const yearsAvailable = historicalDivs.length;
    if (yearsAvailable < 4) {
        throw new Error(`Insufficient dividend history: only ${yearsAvailable} complete years found (need ≥ 4).`);
    }

    /* ── 3. Fetch current fundamentals ─────────────────────────── */
    let fundamentals = { payoutRatio: 0.55, eps: 2.0, beta: 1.0, peRatio: 20, price: 100 };
    let stockName    = ticker;
    let currentPrice = 100;

    try {
        const [quoteRes, summaryRes] = await Promise.allSettled([
            yf.quote(ticker),
            yf.quoteSummary(ticker, {
                modules: ['defaultKeyStatistics', 'financialData', 'summaryDetail', 'assetProfile']
            })
        ]);
        const q  = quoteRes.status  === 'fulfilled' ? quoteRes.value  : {};
        const sm = summaryRes.status === 'fulfilled' ? summaryRes.value : {};
        const ks = sm.defaultKeyStatistics || {};
        const fd = sm.financialData        || {};
        const sd = sm.summaryDetail        || {};

        const rawEps     = ks.trailingEps   || fd.revenuePerShare || null;
        const rawPayout  = sd.payoutRatio   || ks.payoutRatio     || null;
        const rawBeta    = q.beta || ks.beta || 1.0;
        const rawPe      = q.trailingPE || ks.trailingPE || 20;

        currentPrice = q.regularMarketPrice || 100;
        stockName    = q.longName || q.shortName || ticker;

        fundamentals = {
            payoutRatio: rawPayout ? clamp(rawPayout, 0, 2) : 0.55,
            eps:         rawEps    ? clamp(rawEps, 0.01, 500) : (baseDivForForecast / 0.55 || 2.0),
            beta:        clamp(rawBeta, 0.1, 3.0),
            peRatio:     clamp(rawPe,   2,   80),
            price:       currentPrice
        };
    } catch (e) { /* use defaults */ }

    /* ── 4. Build dataset rows ─────────────────────────────────── */
    const MIN_TRAIN = 3;
    const dataset = [];

    for (let i = MIN_TRAIN; i < historicalDivs.length; i++) {
        const trainHistory = historicalDivs.slice(0, i);
        const actualTarget = historicalDivs[i].amount;
        const prevDiv      = historicalDivs[i-1].amount;
        
        // Transform target: Model learns the bounded GROWTH rate, not the absolute dollar amount
        const rawGrowth    = safeDiv(actualTarget - prevDiv, Math.max(0.0001, prevDiv));
        const targetGrowth = clamp(rawGrowth, -0.5, 0.6);
        
        const fv = buildFeatureVector(trainHistory, fundamentals, rfRate, rmRate);
        if (!fv) continue;
        dataset.push({ year: historicalDivs[i].year, fv, targetGrowth, actualTarget, trainHistory });
    }

    if (dataset.length < 2) {
        throw new Error('Not enough data points for walk-forward validation.');
    }

    /* ── 5. Walk-forward cross-validation ──────────────────────── */
    const walkedPredictions = [];
    const walkedFormulas    = [];
    const walkedActuals     = [];

    const allX = dataset.map(d => d.fv);
    const allY = dataset.map(d => d.targetGrowth);

    for (let i = 1; i < dataset.length; i++) {
        const trainX = allX.slice(0, i);
        const trainY = allY.slice(0, i);

        let rfModel;
        try {
            rfModel = new RandomForestRegression({
                nEstimators:         150,
                maxDepth:            4,
                minNumSamples:       1,
                seed:                42,
                noOOB:               true,
            });
            rfModel.train(trainX, trainY);
        } catch (e) {
            // Fallback: naive baseline (last known dividend)
            walkedPredictions.push(dataset[i].trainHistory[dataset[i].trainHistory.length - 1].amount);
            walkedFormulas.push(gordonDDM(dataset[i].trainHistory.map(h => h.amount), fundamentals.beta, rfRate, rmRate) || dataset[i].trainHistory[dataset[i].trainHistory.length - 1].amount);
            walkedActuals.push(dataset[i].actualTarget);
            continue;
        }

        // Predict growth, convert to absolute $
        const predGrowth = rfModel.predict([allX[i]])[0];
        const prevDivForPred = dataset[i].trainHistory[dataset[i].trainHistory.length - 1].amount;
        const predDiv = prevDivForPred * (1 + predGrowth);

        walkedPredictions.push(parseFloat(predDiv.toFixed(4)));
        walkedFormulas.push(
            gordonDDM(dataset[i].trainHistory.map(h => h.amount), fundamentals.beta, rfRate, rmRate) ||
            dataset[i].trainHistory[dataset[i].trainHistory.length - 1].amount
        );
        walkedActuals.push(dataset[i].actualTarget);
    }

    /* ── 6. Accuracy metrics ─────────────────────────────────────── */
    const naivePreds = walkedActuals.map((_, i, arr) => i > 0 ? arr[i - 1] : arr[0]); // persist last-known

    const mlMetrics  = { mae: mae(walkedActuals, walkedPredictions), rmse: rmse(walkedActuals, walkedPredictions), mape: mape(walkedActuals, walkedPredictions) };
    const fmtMetrics = { mae: mae(walkedActuals, walkedFormulas),    rmse: rmse(walkedActuals, walkedFormulas),    mape: mape(walkedActuals, walkedFormulas) };
    const naiveMAE   = mae(walkedActuals, naivePreds);

    const mlBeatsNaive    = mlMetrics.mae  < naiveMAE;
    const mlBeatsFormula  = mlMetrics.mae  < fmtMetrics.mae;
    const mlAccuracyOk    = mlMetrics.mape < 15;
    const mlReliable      = mlBeatsNaive && mlAccuracyOk;

    /* ── 7. Train FINAL model on ALL historical data ───────────── */
    let finalModel, backgroundMeans;
    const finalX = allX;
    const finalY = allY;

    finalModel = new RandomForestRegression({
        nEstimators:    150,
        maxDepth:       4,
        minNumSamples:  1,
        seed:           42,
        noOOB:          true,
    });
    finalModel.train(finalX, finalY);

    backgroundMeans = FEATURE_NAMES.map((_, i) => mean(finalX.map(r => r[i])));

    /* ── 8. Build backtest comparison table ─────────────────────── */
    const backtestTable = [];
    let mlWins = 0, fmtWins = 0;

    for (let i = 0; i < walkedActuals.length; i++) {
        const year       = dataset[i + 1]?.year || (dataset[dataset.length - 1].year - walkedActuals.length + i + 1);
        const actual     = walkedActuals[i];
        const ml         = walkedPredictions[i];
        const formula    = walkedFormulas[i];
        const mlErr      = parseFloat((ml - actual).toFixed(4));
        const fmtErr     = parseFloat((formula - actual).toFixed(4));
        const mlAbsErr   = Math.abs(mlErr);
        const fmtAbsErr  = Math.abs(fmtErr);

        let winner;
        if (Math.abs(mlAbsErr - fmtAbsErr) < 0.001) winner = 'TIE';
        else if (mlAbsErr < fmtAbsErr) { winner = 'ML'; mlWins++; }
        else { winner = 'Formula'; fmtWins++; }

        let shap = {};
        try {
            const prevD = dataset[i + 1]?.trainHistory[dataset[i + 1].trainHistory.length - 1].amount || 1;
            shap = computeShap(finalModel, dataset[i + 1]?.fv || allX[i], backgroundMeans, prevD);
        } catch (e) { shap = {}; }

        backtestTable.push({
            year,
            actual:      parseFloat(actual.toFixed(4)),
            ml:          parseFloat(ml.toFixed(4)),
            formula:     parseFloat(formula.toFixed(4)),
            mlError:     mlErr,
            formulaError: fmtErr,
            mlAbsErr:    parseFloat(mlAbsErr.toFixed(4)),
            formulaAbsErr: parseFloat(fmtAbsErr.toFixed(4)),
            mlPct:       actual > 0 ? parseFloat(((mlAbsErr / actual) * 100).toFixed(2)) : 0,
            formulaPct:  actual > 0 ? parseFloat(((fmtAbsErr / actual) * 100).toFixed(2)) : 0,
            winner,
            shap,
            featuresUsed: dataset[i + 1] ? dataset[i + 1].trainHistory.map(h => ({ year: h.year, dividend: h.amount })) : []
        });
    }

    let overallWinner;
    if (mlWins > fmtWins)       overallWinner = 'ML';
    else if (fmtWins > mlWins)  overallWinner = 'Formula';
    else                        overallWinner = 'TIE';

    /* ── 9. Feature importance ──────────────────────────────────── */
    let featureImportance = [];
    try {
        const trainPrevDivs = dataset.map(d => d.trainHistory[d.trainHistory.length - 1].amount);
        featureImportance = computeFeatureImportance(finalModel, finalX, backgroundMeans, trainPrevDivs);
    } catch (e) { featureImportance = FEATURE_NAMES.map(f => ({ feature: f, importance: 0 })); }

    /* ── 10. Correlation of each feature with growth ──────────── */
    const correlations = FEATURE_NAMES.map((name, i) => ({
        feature:  name,
        pearson:  parseFloat(pearson(finalX.map(r => r[i]), finalY).toFixed(4))
    })).sort((a, b) => Math.abs(b.pearson) - Math.abs(a.pearson));

    /* ── 11. Future forecast (next year) ────────────────────────── */
    const forecastYear    = currentYear + 1;
    const forecastHistory = divHistory; 
    const prevDivForForecast = forecastHistory[forecastHistory.length - 1].amount;
    const forecastFV      = buildFeatureVector(
        currentYearDiv ? [...historicalDivs, currentYearDiv] : historicalDivs,
        fundamentals, rfRate, rmRate
    );

    let mlFuturePred = null, confidenceLow = null, confidenceHigh = null, futureShap = {};
    let formulaFuturePred = null;
    let mlGrowthRate = 0;

    if (forecastFV) {
        try {
            const treePreds = finalModel.estimators
                ? finalModel.estimators.map(t => t.predict([forecastFV])[0])
                : [finalModel.predict([forecastFV])[0]];

            const rawGrowth  = mean(treePreds);
            const meanGrowth = clamp(rawGrowth, -0.25, 0.35);
            mlFuturePred     = parseFloat((prevDivForForecast * (1 + meanGrowth)).toFixed(4));
            mlGrowthRate     = parseFloat((meanGrowth * 100).toFixed(2));
            
            const predStdGrowth = std(treePreds);
            const lowGrowth  = clamp(meanGrowth - 1.96 * predStdGrowth, -0.4, 0.5);
            const highGrowth = clamp(meanGrowth + 1.96 * predStdGrowth, -0.4, 0.6);
            
            confidenceLow    = parseFloat(Math.max(0, prevDivForForecast * (1 + lowGrowth)).toFixed(4));
            confidenceHigh   = parseFloat((prevDivForForecast * (1 + highGrowth)).toFixed(4));
            futureShap       = computeShap(finalModel, forecastFV, backgroundMeans, prevDivForForecast);
        } catch (e) {
            const rawG       = finalModel.predict([forecastFV])[0];
            const meanGrowth = clamp(rawG, -0.25, 0.35);
            mlFuturePred     = parseFloat((prevDivForForecast * (1 + meanGrowth)).toFixed(4));
            mlGrowthRate     = parseFloat((meanGrowth * 100).toFixed(2));
            confidenceLow    = parseFloat(Math.max(0, mlFuturePred * 0.92).toFixed(4));
            confidenceHigh   = parseFloat((mlFuturePred * 1.08).toFixed(4));
        }
    }

    const lastHistoryForFormula = currentYearDiv
        ? [...historicalDivs, currentYearDiv].map(h => h.amount)
        : historicalDivs.map(h => h.amount);
    formulaFuturePred = gordonDDM(lastHistoryForFormula, fundamentals.beta, rfRate, rmRate);

    /* ── 12. Detailed Company Factor Analysis ────────────────────── */
    const friendlyLabels = {
        prevDiv:         { title: 'Base Dividend (D t-1)', cat: 'Historical Baseline' },
        divGrowth1Y:     { title: '1-Year Dividend Growth', cat: 'Growth Momentum' },
        divCAGR3Y:       { title: '3-Year Dividend CAGR', cat: 'Growth Trend' },
        divAcceleration: { title: 'Growth Acceleration', cat: 'Momentum Shift' },
        payoutRatio:     { title: 'Earnings Payout Ratio', cat: 'Solvency & Cushion' },
        payoutStress:    { title: 'Payout Stress Index', cat: 'Dividend Cut Risk' },
        eps:             { title: 'Trailing EPS', cat: 'Earnings Power' },
        beta:            { title: 'Systematic Beta (β)', cat: 'Market Sensitivity' },
        peRatio:         { title: 'P/E Valuation Multiple', cat: 'Market Pricing' },
        yieldSpread:     { title: 'Yield Spread vs Treasury', cat: 'Macro Yield Spread' },
        momentumScore:   { title: 'Compounded Momentum', cat: 'Growth Multiplier' }
    };

    const companyFactorAttribution = FEATURE_NAMES.map((name, idx) => {
        const rawVal = forecastFV ? forecastFV[idx] : 0;
        const shapDollar = futureShap ? (futureShap[name] || 0) : 0;
        const impObj = featureImportance.find(f => f.feature === name);
        const importancePct = impObj ? +(impObj.importance * 100).toFixed(1) : 0;
        const meta = friendlyLabels[name] || { title: name, cat: 'Feature' };

        let displayVal = `${rawVal.toFixed(2)}`;
        if (name === 'payoutRatio') displayVal = `${(rawVal * 100).toFixed(1)}%`;
        if (name === 'divGrowth1Y' || name === 'divCAGR3Y' || name === 'yieldSpread') displayVal = `${(rawVal * 100).toFixed(2)}%`;
        if (name === 'prevDiv') displayVal = `$${rawVal.toFixed(2)}`;
        if (name === 'eps') displayVal = `$${rawVal.toFixed(2)}`;

        const impact = shapDollar > 0.0005 ? 'positive' : shapDollar < -0.0005 ? 'negative' : 'neutral';

        return {
            feature: name,
            title: meta.title,
            category: meta.cat,
            currentValue: displayVal,
            rawVal,
            shapDollar: parseFloat(shapDollar.toFixed(4)),
            importancePct,
            impact
        };
    }).sort((a, b) => Math.abs(b.shapDollar) - Math.abs(a.shapDollar) || b.importancePct - a.importancePct);

    /* ── 13. Accuracy warning ──────────────────────────────────── */
    let accuracyWarning = null;
    if (!mlReliable) {
        if (!mlBeatsNaive) {
            accuracyWarning = `ML model (MAPE ${mlMetrics.mape.toFixed(1)}%) does not outperform the naive baseline (MAPE ${mape(walkedActuals, naivePreds).toFixed(1)}%). Treat ML predictions with caution. Formula model may be more reliable.`;
        } else if (!mlAccuracyOk) {
            accuracyWarning = `ML model MAPE is ${mlMetrics.mape.toFixed(1)}% (threshold: 15%). This stock may have irregular dividends. Predictions are shown but treat with caution.`;
        }
    }

    /* ── 14. Return ─────────────────────────────────────────────── */
    return {
        ticker,
        name:          stockName,
        currentPrice,
        yearsAvailable,
        fundamentals: {
            eps:         parseFloat(fundamentals.eps.toFixed(2)),
            payoutRatio: parseFloat((fundamentals.payoutRatio * 100).toFixed(1)),
            beta:        parseFloat(fundamentals.beta.toFixed(2)),
            peRatio:     parseFloat(fundamentals.peRatio.toFixed(1)),
        },

        backtestTable,

        metrics: {
            ml:      { mae: parseFloat(mlMetrics.mae.toFixed(4)),  rmse: parseFloat(mlMetrics.rmse.toFixed(4)),  mape: parseFloat(mlMetrics.mape.toFixed(2)),  winsCount: mlWins  },
            formula: { mae: parseFloat(fmtMetrics.mae.toFixed(4)), rmse: parseFloat(fmtMetrics.rmse.toFixed(4)), mape: parseFloat(fmtMetrics.mape.toFixed(2)), winsCount: fmtWins },
            naive:   { mae: parseFloat(naiveMAE.toFixed(4)) },
            overallWinner,
            mlBeatsNaive,
            mlBeatsFormula,
            mlReliable,
            backtestPeriods: walkedActuals.length,
        },

        futureForecast: mlFuturePred !== null ? {
            year:              forecastYear,
            baseDiv:           parseFloat(prevDivForForecast.toFixed(4)),
            mlPrediction:      parseFloat(mlFuturePred.toFixed(4)),
            mlGrowthRate:      parseFloat(mlGrowthRate.toFixed(2)),
            formulaPrediction: formulaFuturePred ? parseFloat(formulaFuturePred.toFixed(4)) : null,
            confidenceLow:     parseFloat(confidenceLow.toFixed(4)),
            confidenceHigh:    parseFloat(confidenceHigh.toFixed(4)),
            shap:              futureShap,
            isForecast:        true,
            note:              'This is a forward-looking forecast. Actual dividend is unknown until declared.',
        } : null,

        companyFactorAttribution,
        featureImportance,
        correlations,
        mlReliable,
        accuracyWarning,

        dividendHistory: divHistory,

        dataQuality: {
            yearsAvailable,
            backtestPeriods: walkedActuals.length,
            missingYears:    0,
            warning: yearsAvailable < 6
                ? `Only ${yearsAvailable} complete years available. More history improves ML accuracy.`
                : null
        },

        modelInfo: {
            type:             'Random Forest Regression (Walk-Forward)',
            nEstimators:      150,
            maxDepth:         4,
            features:         FEATURE_NAMES,
            validationMethod: 'Walk-Forward YoY Growth Prediction',
            minTrainWindow:   MIN_TRAIN,
        },

        isMock:    false,
        timestamp: new Date(),
    };
}

router.get('/predict/:ticker', async (req, res) => {
    const { ticker } = req.params;
    const rfRate = parseFloat(req.query.rf) || 4.5;
    const rmRate = parseFloat(req.query.rm) || 10.0;

    try {
        const result = await runMLPipeline(ticker.toUpperCase(), rfRate, rmRate);
        res.json(result);
    } catch (err) {
        console.error(`ML predict error [${ticker}]:`, err.message);
        res.status(422).json({
            error:   'ML pipeline failed',
            message: err.message,
            ticker,
            isMock:  false,
        });
    }
});

router.runMLPipeline = runMLPipeline;

module.exports = router;

