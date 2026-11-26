// Market assumptions for the required return (CAPM), one place for the whole app.
// Risk-free = 10-year government bond yield (checked Nov 2026: India about 7.2%, US about 5.0%).
// Market return = assumed long-run stock-market return. minR = lowest required return allowed
// (a stock must pay clearly more than a government bond).
const RATES = {
    IN: { rf: 7.2, rm: 13.0, minR: 10.5 },
    US: { rf: 5.0, rm: 10.0, minR: 8.0 },
};

const isIndian = t => /\.(NS|BO)$/i.test(String(t || ''));
const ratesFor = t => (isIndian(t) ? RATES.IN : RATES.US);

// CAPM: R = rf + beta x (rm - rf), with beta kept between 0.6 and 2.0 and R never below minR
function requiredReturn(ticker, beta) {
    const r = ratesFor(ticker);
    const b = Math.max(0.6, Math.min(2.0, Number.isFinite(beta) && beta > 0 ? beta : 1.0));
    return Math.max(r.minR / 100, r.rf / 100 + b * ((r.rm - r.rf) / 100));
}

// Long-run dividend growth after the first 5 years (India grows faster in nominal terms)
const LONG_GROWTH = { IN: 5.0, US: 3.5 };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// One dividend valuation for every screen (same formula as the ML Analysis tab):
// two-stage H-model, 5-year fade from the hybrid growth g1 to the long-run growth g2,
// R - g2 kept at least 4% (US) / 5% (India), value limited to 0.55x-1.65x the price.
// Signal: STRONG BUY > +25%, BUY > +12%, SELL < -12%, otherwise HOLD.
function modelValue(ticker, { price, D0, D1, growthPct, beta }) {
    const india = isIndian(ticker);
    const R  = requiredReturn(ticker, beta);
    const g2 = (india ? LONG_GROWTH.IN : LONG_GROWTH.US) / 100;
    const g1 = clamp(Number.isFinite(growthPct) ? growthPct : g2 * 100, -5, india ? 16 : 12) / 100;
    const spread = Math.max(india ? 0.05 : 0.04, R - g2);
    const H = 5;
    const next = D1 > 0 ? D1 : D0 * (1 + g1);
    const raw = next * (1 + g2) / spread + D0 * H * Math.max(0, g1 - g2) / spread;
    const value = price > 0 ? clamp(raw, price * 0.55, price * 1.65) : raw;
    const gap = price > 0 ? ((value - price) / price) * 100 : 0;
    const signal = gap > 25 ? 'STRONG BUY' : gap > 12 ? 'BUY' : gap < -12 ? 'SELL' : 'HOLD';
    return { R, g1, g2, raw, value, gap, signal, capped: value !== raw };
}

// The one recommendation shown everywhere: the valuation signal, capped by the hybrid cut risk
// (High cut risk -> at most HOLD, Medium -> at most BUY), so a likely dividend cut is never a buy.
function finalSignal(valuationSignal, cutRiskLevel) {
    const rank = { SELL: 0, HOLD: 1, BUY: 2, 'STRONG BUY': 3 };
    const cap = cutRiskLevel === 'High' ? 'HOLD' : cutRiskLevel === 'Medium' ? 'BUY' : 'STRONG BUY';
    return rank[valuationSignal] > rank[cap] ? cap : valuationSignal;
}

module.exports = { RATES, LONG_GROWTH, isIndian, ratesFor, requiredReturn, modelValue, finalSignal };
