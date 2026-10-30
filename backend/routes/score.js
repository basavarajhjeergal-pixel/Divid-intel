const express = require('express');
const router = express.Router();
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({
    suppressNotices: ['yahooSurvey'],
    logger: { ...console, warn: (msg, ...args) => { if (!String(msg).includes('Unsupported environment')) console.warn(msg, ...args); } }
});

// ── Load frozen Formula B from research (divfor) ──────────────────────────────
const formula = require('../formula.json');
let researchUniverse = {};
try {
    researchUniverse = require('../research_universe.json');
} catch (e) {
    researchUniverse = {};
}

// ── Sectors to exclude (banks/financials have different FCF structures) ───────
const EXCLUDED_SECTORS = [
    'Financial Services', 'Banks', 'Insurance', 'Asset Management',
    'Capital Markets', 'Mortgage Finance', 'Thrifts & Mortgage Finance'
];

// Frozen empirical regression intercept from divfor pipeline
const MODEL_INTERCEPT = -1.218;

// ── Sigmoid function ──────────────────────────────────────────────────────────
function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}

// ── Standardise a value using research means & stds with robust clipping ──────
function standardise(value, mean, std) {
    if (!std || std === 0) return 0;
    const z = (value - mean) / std;
    return Math.max(-3.5, Math.min(3.5, z));
}

// ── Classify score into signal band ──────────────────────────────────────────
function classifyScore(score) {
    if (score >= formula.bands.high) return { signal: formula.signals.high, band: 'green' };
    if (score >= formula.bands.low)  return { signal: formula.signals.moderate, band: 'yellow' };
    return { signal: formula.signals.low, band: 'red' };
}

// ── Fetch fundamentals from Yahoo Finance with fallback to research ───────────
async function fetchFundamentals(ticker) {
    let summary = {};
    try {
        summary = await yf.quoteSummary(ticker, {
            modules: ['financialData', 'defaultKeyStatistics', 'assetProfile', 'summaryDetail']
        });
    } catch (e) {
        summary = {};
    }

    const fd  = summary.financialData        || {};
    const ks  = summary.defaultKeyStatistics || {};
    const ap  = summary.assetProfile         || {};
    const sd  = summary.summaryDetail        || {};

    const research = researchUniverse[ticker] || null;
    let sector = ap.sector || (research ? research.sector : '');

    // ROE (Return on Equity)
    let ROE = fd.returnOnEquity ?? null;
    if (ROE === null && research && research.roe !== undefined) {
        ROE = research.roe;
    }

    // FCF Payout Ratio = dividends paid / free cash flow
    const fcf          = fd.freeCashflow ?? null;
    const dividendRate = sd.dividendRate ?? null;
    const sharesOut    = ks.sharesOutstanding ?? null;
    const totalDivPaid = (dividendRate && sharesOut) ? dividendRate * sharesOut : null;
    
    let FCFPayoutRatio = (fcf && totalDivPaid && fcf > 0) ? (totalDivPaid / fcf) : null;
    if (FCFPayoutRatio === null && research && research.fcfPayout !== undefined) {
        FCFPayoutRatio = research.fcfPayout;
    }

    // FCF Growth
    let FCFGrowth = null;
    if (research && research.fcfGrowth !== undefined) {
        FCFGrowth = research.fcfGrowth;
    }

    return { ROE, FCFPayoutRatio, FCFGrowth, sector, isResearchCohort: !!research };
}

// ── GET /api/score/:ticker ────────────────────────────────────────────────────
router.get('/:ticker', async (req, res) => {
    const ticker = req.params.ticker.toUpperCase().trim();

    try {
        const { ROE, FCFPayoutRatio, FCFGrowth, sector, isResearchCohort } = await fetchFundamentals(ticker);

        // Check if it's a bank or financial — skip scoring per research specification
        const isFinancial = EXCLUDED_SECTORS.some(s =>
            sector.toLowerCase().includes(s.toLowerCase())
        );
        if (isFinancial) {
            return res.json({
                ticker,
                score: null,
                signal: 'Not applicable',
                band: 'grey',
                note: 'Dividend Variation Score is not applicable for banks and financial companies (FCF structure differs).',
                sector,
                factors: { ROE, FCFPayoutRatio, FCFGrowth },
                isResearchCohort
            });
        }

        // Check data availability
        const available = { ROE, FCFPayoutRatio, FCFGrowth };
        const missing = Object.entries(available)
            .filter(([, v]) => v === null || v === undefined)
            .map(([k]) => k);

        // Need at least ROE + one cash flow factor
        const hasROE = ROE !== null && ROE !== undefined;
        const hasCashFlow = FCFPayoutRatio !== null || FCFGrowth !== null;

        if (!hasROE || !hasCashFlow) {
            return res.json({
                ticker,
                score: null,
                signal: 'Insufficient data',
                band: 'grey',
                note: `Missing factors: ${missing.join(', ')}. Cannot compute Dividend Variation Score.`,
                sector,
                factors: available,
                isResearchCohort
            });
        }

        // ── Compute score ──────────────────────────────────────────────────
        const { coefficients, means, stds } = formula;

        let logit = 0;
        let factorsUsed = 0;

        if (ROE !== null && ROE !== undefined) {
            logit += coefficients.ROE * standardise(ROE, means.ROE, stds.ROE);
            factorsUsed++;
        }
        if (FCFPayoutRatio !== null && FCFPayoutRatio !== undefined) {
            logit += coefficients.FCFPayoutRatio * standardise(FCFPayoutRatio, means.FCFPayoutRatio, stds.FCFPayoutRatio);
            factorsUsed++;
        }
        if (FCFGrowth !== null && FCFGrowth !== undefined) {
            logit += coefficients.FCFGrowth * standardise(FCFGrowth, means.FCFGrowth, stds.FCFGrowth);
            factorsUsed++;
        }

        const score = Math.max(1, Math.min(99, Math.round(sigmoid(logit) * 100)));
        const { signal, band } = classifyScore(score);

        return res.json({
            ticker,
            score,
            signal,
            band,
            factorsUsed,
            factors: {
                ROE: ROE !== null ? Math.round(ROE * 10000) / 100 : null,
                FCFPayoutRatio: FCFPayoutRatio !== null ? Math.round(FCFPayoutRatio * 10000) / 100 : null,
                FCFGrowth: FCFGrowth !== null ? Math.round(FCFGrowth * 10000) / 100 : null
            },
            missingFactors: missing,
            sector,
            note: isResearchCohort
                ? 'Empirical research cohort stock (divfor). Model grounded on research & live Yahoo Finance.'
                : 'Experimental research signal — Formula B (divfor). Not financial advice.',
            validation: formula.validation,
            isResearchCohort
        });

    } catch (err) {
        console.error(`[score] Error for ${ticker}:`, err.message);
        return res.status(500).json({
            ticker,
            score: null,
            signal: 'Error',
            band: 'grey',
            error: err.message
        });
    }
});

module.exports = router;

