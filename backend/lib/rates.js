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

module.exports = { RATES, isIndian, ratesFor, requiredReturn };
