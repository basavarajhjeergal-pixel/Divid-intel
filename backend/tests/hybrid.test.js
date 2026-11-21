const { applyHybrid, getHybridGrowth, getHybrid } = require('../lib/hybrid');

// a minimal legacy-pipeline result, shaped like routes/ml.js output
function legacy(ticker) {
    const years = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
    const div = { 2017: 1.48, 2018: 1.56, 2019: 1.60, 2020: 1.64, 2021: 1.68, 2022: 1.76, 2023: 1.84, 2024: 1.94, 2025: 2.04 };
    return {
        ticker, currentPrice: 60,
        dividendHistory: Object.entries(div).map(([y, a]) => ({ year: +y, amount: a })),
        backtestTable: years.map(y => ({ year: y, actual: div[y], ml: div[y] * 1.2, formula: div[y - 1] * 1.03,
                                         formulaAbsErr: Math.abs(div[y - 1] * 1.03 - div[y]), shap: { x: 1 } })),
        metrics: { ml: { mape: 99 } }, futureForecast: { formulaPrediction: 2.1 },
        modelInfo: { type: 'Random Forest Regression (Walk-Forward)', nEstimators: 150 }
    };
}

test('covered stock: every ML output comes from the hybrid model', () => {
    const r = applyHybrid(legacy('KO'));
    const h = getHybrid('KO');
    expect(r.modelInfo.hybrid).toBe(true);
    expect(r.modelInfo.type).toMatch(/Hybrid/);
    expect(r.futureForecast.mlPrediction).toBe(h.forecastDividend);
    expect(r.futureForecast.confidenceLow).toBe(h.range80Low);
    expect(r.futureForecast.rangeLevel).toBe(80);
    expect(r.futureForecast.formulaPrediction).toBe(2.1);           // DDM column kept
    expect(r.backtestTable.length).toBeGreaterThan(3);
    r.backtestTable.forEach(row => expect(row.shap).toEqual({}));    // no legacy RF attributions left
    expect(r.metrics.ml.mape).toBeLessThan(99);                      // recomputed from hybrid rows
    expect(r.featureImportance[0].title).toBeDefined();
    expect(r.companyFactorAttribution.length).toBeGreaterThan(0);
});

test('uncovered stock stays on the legacy model and is marked so', () => {
    const r = applyHybrid(legacy('MRK'));
    expect(r.modelInfo.legacy).toBe(true);
    expect(r.modelInfo.type).toMatch(/Random Forest/);
});

test('walk-forward growth exists for past years only', () => {
    expect(getHybridGrowth('KO', 2025)).not.toBeNull();
    expect(getHybridGrowth('KO', 1990)).toBeNull();
    expect(getHybridGrowth('MRK', 2025)).toBeNull();
});
