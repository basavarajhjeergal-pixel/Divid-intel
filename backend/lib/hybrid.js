// Loads the hybrid model's saved predictions (backend/data/hybrid_predictions.json).
// The file is produced offline by research/hybrid/hybrid_model.py --export ...
// and reloaded automatically when it changes. Nothing is trained on request.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'hybrid_predictions.json');
let cache = null, mtime = 0;

function loadAll() {
    try {
        const st = fs.statSync(FILE);
        if (!cache || st.mtimeMs !== mtime) {
            cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
            mtime = st.mtimeMs;
        }
        return cache;
    } catch {
        return null;            // no file yet -> callers fall back to the old model
    }
}

function getHybrid(ticker) {
    const all = loadAll();
    const s = all?.stocks?.[String(ticker || '').toUpperCase().trim()];
    if (!s) return null;
    return { ...s, model: all.model, trainedAt: all.trainedAt, usesNews: all.usesNews, backtest: all.backtest };
}

// Walk-forward predicted growth (%) for one past year: made using only earlier years.
function getHybridGrowth(ticker, year) {
    const h = getHybrid(ticker);
    const e = h?.history?.find(r => r.year === Number(year));
    return e ? e.predictedGrowthPct : null;
}

const DRIVER_META = {
    thisYearGrowthPct:   { title: "This year's dividend growth", category: 'Growth Momentum', fmt: v => `${v}%` },
    vsThreeYearLevelPct: { title: 'Dividend vs its 3-year level', category: 'Mean Reversion', fmt: v => `${v > 0 ? '+' : ''}${v}%` },
    cutsLast5Years:      { title: 'Cuts in the last 5 years', category: 'Dividend Cut Risk', fmt: v => `${v}` },
    groupCutRatePct:     { title: 'Bayesian cut rate (company + group)', category: 'Dividend Cut Risk', fmt: v => `${v}%` },
};

// Turn the legacy per-stock pipeline result into the hybrid model's view for covered stocks.
// Keeps live-data fields (price, fundamentals, formula/DDM column); replaces everything the ML model says.
function applyHybrid(r) {
    if (!r || !r.ticker) return r;
    const h = getHybrid(r.ticker);
    if (!h) {
        r.modelInfo = { ...(r.modelInfo || {}), legacy: true };
        return r;
    }
    const all = loadAll();
    const actualByYear = {};
    (r.dividendHistory || []).forEach(d => { actualByYear[d.year] = d.amount; });
    (r.backtestTable || []).forEach(row => { actualByYear[row.year] = row.actual; });

    // per-year walk-forward table: hybrid growth applied to the app's own prior-year dividend
    const rows = [];
    for (const row of (r.backtestTable || [])) {
        const g = h.history?.find(e => e.year === row.year);
        const prev = actualByYear[row.year - 1];
        if (!g || !prev) continue;
        const ml = prev * (1 + g.predictedGrowthPct / 100);
        const mlAbsErr = Math.abs(ml - row.actual);
        const fmtAbsErr = Math.abs(row.formula - row.actual);
        rows.push({
            ...row,
            ml: +ml.toFixed(4),
            mlError: +(ml - row.actual).toFixed(4),
            mlAbsErr: +mlAbsErr.toFixed(4),
            mlPct: row.actual > 0 ? +((mlAbsErr / row.actual) * 100).toFixed(2) : 0,
            winner: mlAbsErr <= fmtAbsErr ? 'ML' : 'Formula',
            mlRangeLow: g.range80LowGrowthPct != null ? +(prev * (1 + g.range80LowGrowthPct / 100)).toFixed(4) : null,
            mlRangeHigh: g.range80HighGrowthPct != null ? +(prev * (1 + g.range80HighGrowthPct / 100)).toFixed(4) : null,
            trustInML: g.trustInML,
            prev,
            shap: {}
        });
    }

    if (rows.length) {
        const mae  = a => a.reduce((s, x) => s + x, 0) / a.length;
        const mlE  = rows.map(x => x.mlAbsErr), fE = rows.map(x => x.formulaAbsErr);
        const nE   = rows.map(x => Math.abs(x.prev - x.actual));
        const pct  = (e) => mae(rows.map((x, i) => x.actual > 0 ? e[i] / x.actual * 100 : 0));
        const mlWins = rows.filter(x => x.winner === 'ML').length;
        const mlMape = pct(mlE), nMape = pct(nE);
        r.metrics = {
            ...r.metrics,
            ml: { mae: +mae(mlE).toFixed(4), rmse: +Math.sqrt(mae(mlE.map(x => x * x))).toFixed(4), mape: +mlMape.toFixed(2), winsCount: mlWins },
            formula: { mae: +mae(fE).toFixed(4), rmse: +Math.sqrt(mae(fE.map(x => x * x))).toFixed(4), mape: +pct(fE).toFixed(2), winsCount: rows.length - mlWins },
            naive: { mae: +mae(nE).toFixed(4) },
            overallWinner: mlWins >= rows.length - mlWins ? 'ML' : 'Formula',
            mlBeatsNaive: mae(mlE) <= mae(nE),
            mlBeatsFormula: mae(mlE) <= mae(fE),
            mlReliable: mae(mlE) <= mae(nE) || mlMape <= 15,
            backtestPeriods: rows.length,
        };
        r.backtestTable = rows;
        r.mlReliable = r.metrics.mlReliable;
        r.accuracyWarning = r.mlReliable ? null
            : `For ${r.ticker} the hybrid model's error (${mlMape.toFixed(1)}%) is close to "same as last year" (${nMape.toFixed(1)}%). It trusts ML ${Math.round(h.trustInML * 100)}% for this group, so the forecast stays near last year's dividend.`;
    }

    r.futureForecast = {
        ...(r.futureForecast || {}),
        year: h.forecastYear,
        baseDiv: h.lastDividend,
        mlPrediction: h.forecastDividend,
        mlGrowthRate: h.changePct,
        confidenceLow: h.range80Low,
        confidenceHigh: h.range80High,
        rangeLevel: 80,
        cutRiskPct: h.cutRiskPct,
        cutRiskLevel: h.cutRiskLevel,
        shap: {},
        isForecast: true,
        note: `Hybrid model forecast with an 80% range from past forecast errors (ranges covered the real dividend ${h.backtest.range80CoveragePct}% of the time in the backtest).`,
    };

    r.featureImportance = (all.featureImportance || []).map(f => ({ feature: f.feature, title: f.title, importance: f.importance }));
    const impByTitle = {};
    r.featureImportance.forEach(f => { impByTitle[f.title] = f.importance; });
    r.companyFactorAttribution = Object.entries(h.drivers || {})
        .filter(([k, v]) => v !== null && v !== undefined && DRIVER_META[k])
        .map(([k, v]) => {
            const m = DRIVER_META[k];
            let impact = 'neutral';
            if (k === 'thisYearGrowthPct') impact = v > 30 ? 'negative' : v >= 0 ? 'positive' : 'negative';
            if (k === 'vsThreeYearLevelPct') impact = v > 25 ? 'negative' : v < -10 ? 'positive' : 'neutral';
            if (k === 'cutsLast5Years') impact = v >= 2 ? 'negative' : v === 0 ? 'positive' : 'neutral';
            if (k === 'groupCutRatePct') impact = v >= 20 ? 'negative' : v <= 8 ? 'positive' : 'neutral';
            return { feature: k, title: m.title, category: m.category, currentValue: m.fmt(v), rawVal: v,
                     shapDollar: 0, importancePct: +(((impByTitle[m.title] || 0)) * 100).toFixed(1), impact };
        });

    r.modelInfo = {
        type: 'Hybrid model (Gradient Boosting + Bayesian cut signal + trust weights)',
        nEstimators: null,
        validationMethod: `Walk-forward ${h.backtest.years}, ${h.backtest.predictions} predictions across 16 companies`,
        trainingWindowLabel: 'All earlier years of all 16 companies',
        features: r.featureImportance.map(f => f.title),
        hybrid: true,
        backtestAccuracyPct: h.backtest.accuracyPct,
        trustInML: h.trustInML,
    };
    return r;
}

module.exports = { loadAll, getHybrid, getHybridGrowth, applyHybrid };
