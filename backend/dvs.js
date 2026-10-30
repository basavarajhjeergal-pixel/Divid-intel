/**
 * dividend-app/backend/dvs.js
 * 
 * DividIntel Dividend Safety Score (DVS) Methodology
 * ──────────────────────────────────────────────────
 * A transparent, five-factor fundamentals-based weighted score (0–100):
 * 
 *   DVS = (0.30 × FCF_Safety)
 *       + (0.20 × Earnings_Safety)
 *       + (0.15 × Leverage_Safety)
 *       + (0.20 × FCF_Consistency)
 *       + (0.15 × Dividend_History)
 * 
 * Every component is scored deterministically between 0 and 100.
 * Sector-specific adjustments apply for Banking & Financial Services.
 * Preserves original raw financial data and generates transparent data-quality warnings.
 */

const formula = require('./formula.json');

const FINANCIAL_SECTORS = [
    'financial services',
    'banks',
    'bank',
    'insurance',
    'asset management',
    'capital markets',
    'mortgage finance',
    'thrifts & mortgage finance'
];

/**
 * Evaluates whether a sector is a financial institution
 */
function isFinancialSector(sector) {
    if (!sector || typeof sector !== 'string') return false;
    const s = sector.toLowerCase();
    return FINANCIAL_SECTORS.some(fs => s.includes(fs));
}

/**
 * 1. FCF Payout Safety (Weight 0.30)
 *    Below 60% = 100
 *    60–80%    = 80
 *    80–100%   = 50
 *    Above 100% = 0
 *    Negative or zero FCF = 0 and warning
 */
function scoreFCFSafety(fcf, totalDividends) {
    const warnings = [];
    if (fcf === null || fcf === undefined) {
        warnings.push('Free Cash Flow data unavailable from filings; FCF Safety scored 0.');
        return {
            name: 'FCF Payout Safety',
            weight: 0.30,
            score: 0,
            contribution: 0.0,
            rawValue: 'Unavailable',
            fcfPayoutPct: null,
            thresholdMet: 'Missing Data (Score 0)',
            status: 'warning',
            warnings
        };
    }

    if (fcf <= 0) {
        warnings.push(`Negative or zero Free Cash Flow (${(fcf / 1e9).toFixed(2)}B): Dividends are not covered by organic cash generation.`);
        return {
            name: 'FCF Payout Safety',
            weight: 0.30,
            score: 0,
            contribution: 0.0,
            rawValue: fcf === 0 ? '₹0 / $0' : `Deficit: ${(fcf / 1e9).toFixed(2)}B`,
            fcfPayoutPct: null,
            thresholdMet: 'Negative or Zero FCF (Score 0)',
            status: 'warning',
            warnings
        };
    }

    if (totalDividends === null || totalDividends === undefined) {
        warnings.push('Total dividend distribution data unavailable; neutral estimate assigned with penalty.');
        return {
            name: 'FCF Payout Safety',
            weight: 0.30,
            score: 40,
            contribution: 12.0,
            rawValue: 'Dividends Unknown',
            fcfPayoutPct: null,
            thresholdMet: 'Dividend Total Missing (Score 40)',
            status: 'caution',
            warnings
        };
    }

    const fcfPayoutPct = (totalDividends / fcf) * 100;
    let score = 0;
    let thresholdMet = '';
    let status = 'healthy';

    if (fcfPayoutPct < 60) {
        score = 100;
        thresholdMet = 'Below 60% (Score 100)';
        status = 'healthy';
    } else if (fcfPayoutPct <= 80) {
        score = 80;
        thresholdMet = '60%–80% (Score 80)';
        status = 'healthy';
    } else if (fcfPayoutPct <= 100) {
        score = 50;
        thresholdMet = '80%–100% (Score 50)';
        status = 'caution';
        warnings.push(`Elevated FCF Payout: Company absorbs ${fcfPayoutPct.toFixed(1)}% of free cash flow on dividends.`);
    } else {
        score = 0;
        thresholdMet = 'Above 100% (Score 0)';
        status = 'warning';
        warnings.push(`FCF Payout exceeds 100% (${fcfPayoutPct.toFixed(1)}%): Dividends exceed organic annual Free Cash Flow.`);
    }

    return {
        name: 'FCF Payout Safety',
        weight: 0.30,
        score,
        contribution: +(score * 0.30).toFixed(1),
        rawValue: `${fcfPayoutPct.toFixed(1)}%`,
        fcfPayoutPct,
        thresholdMet,
        status,
        warnings
    };
}

/**
 * 2. Earnings Payout Safety (Weight 0.20)
 *    Below 50% = 100
 *    50–75%    = 80
 *    75–100%   = 50
 *    Above 100% = 0 (or negative net earnings = 0)
 */
function scoreEarningsSafety(payoutRatio) {
    const warnings = [];
    if (payoutRatio === null || payoutRatio === undefined) {
        warnings.push('Earnings payout ratio data unavailable; Earnings Safety scored 0.');
        return {
            name: 'Earnings Payout Safety',
            weight: 0.20,
            score: 0,
            contribution: 0.0,
            rawValue: 'Unavailable',
            earningsPayoutPct: null,
            thresholdMet: 'Missing Data (Score 0)',
            status: 'warning',
            warnings
        };
    }

    const earningsPayoutPct = payoutRatio * 100;
    let score = 0;
    let thresholdMet = '';
    let status = 'healthy';

    if (earningsPayoutPct < 0) {
        score = 0;
        thresholdMet = 'Negative Net Income (Score 0)';
        status = 'warning';
        warnings.push('Negative Net Income reported: Company operated at an accounting loss.');
    } else if (earningsPayoutPct < 50) {
        score = 100;
        thresholdMet = 'Below 50% (Score 100)';
        status = 'healthy';
    } else if (earningsPayoutPct <= 75) {
        score = 80;
        thresholdMet = '50%–75% (Score 80)';
        status = 'healthy';
    } else if (earningsPayoutPct <= 100) {
        score = 50;
        thresholdMet = '75%–100% (Score 50)';
        status = 'caution';
        warnings.push(`Narrow earnings cushion: Payout ratio of ${earningsPayoutPct.toFixed(1)}% leaves little margin for profit drops.`);
    } else {
        score = 0;
        thresholdMet = 'Above 100% (Score 0)';
        status = 'warning';
        warnings.push(`Earnings Payout exceeds 100% (${earningsPayoutPct.toFixed(1)}%): Distributions exceed net corporate earnings.`);
    }

    return {
        name: 'Earnings Payout Safety',
        weight: 0.20,
        score,
        contribution: +(score * 0.20).toFixed(1),
        rawValue: `${earningsPayoutPct.toFixed(1)}%`,
        earningsPayoutPct,
        thresholdMet,
        status,
        warnings
    };
}

/**
 * 3. Leverage Safety: Net Debt / EBITDA (Weight 0.15)
 *    Net Debt/EBITDA below 1 = 100
 *    1–2 = 80
 *    2–3 = 50
 *    Above 3 = 20
 */
function scoreLeverageSafety(totalDebt, totalCash, ebitda) {
    const warnings = [];
    if (totalDebt === null && totalCash === null && ebitda === null) {
        warnings.push('Debt and EBITDA metrics unavailable; Leverage Safety scored 40 with data warning.');
        return {
            name: 'Leverage Safety (Net Debt/EBITDA)',
            weight: 0.15,
            score: 40,
            contribution: 6.0,
            rawValue: 'Unavailable',
            netDebtToEbitda: null,
            thresholdMet: 'Missing Data (Score 40)',
            status: 'caution',
            warnings
        };
    }

    const debt = totalDebt || 0;
    const cash = totalCash || 0;
    const netDebt = debt - cash;

    // If net cash positive (cash > debt)
    if (netDebt <= 0) {
        return {
            name: 'Leverage Safety (Net Debt/EBITDA)',
            weight: 0.15,
            score: 100,
            contribution: 15.0,
            rawValue: 'Net Cash Positive',
            netDebtToEbitda: 0,
            thresholdMet: 'Net Cash (Below 1.0x: Score 100)',
            status: 'healthy',
            warnings
        };
    }

    // Positive net debt with zero or negative EBITDA
    if (ebitda === null || ebitda <= 0) {
        warnings.push('Negative or zero EBITDA with outstanding net debt: severe solvency risk.');
        return {
            name: 'Leverage Safety (Net Debt/EBITDA)',
            weight: 0.15,
            score: 20,
            contribution: 3.0,
            rawValue: ebitda <= 0 ? 'Negative EBITDA' : 'EBITDA Missing',
            netDebtToEbitda: null,
            thresholdMet: 'Negative EBITDA / Debt (Score 20)',
            status: 'warning',
            warnings
        };
    }

    const ratio = netDebt / ebitda;
    let score = 20;
    let thresholdMet = '';
    let status = 'healthy';

    if (ratio < 1.0) {
        score = 100;
        thresholdMet = 'Below 1.0x (Score 100)';
        status = 'healthy';
    } else if (ratio <= 2.0) {
        score = 80;
        thresholdMet = '1.0x–2.0x (Score 80)';
        status = 'healthy';
    } else if (ratio <= 3.0) {
        score = 50;
        thresholdMet = '2.0x–3.0x (Score 50)';
        status = 'caution';
        warnings.push(`Moderate leverage: Net Debt to EBITDA is ${ratio.toFixed(2)}x.`);
    } else {
        score = 20;
        thresholdMet = 'Above 3.0x (Score 20)';
        status = 'warning';
        warnings.push(`High Leverage: Net Debt/EBITDA of ${ratio.toFixed(2)}x exceeds 3.0x threshold.`);
    }

    return {
        name: 'Leverage Safety (Net Debt/EBITDA)',
        weight: 0.15,
        score,
        contribution: +(score * 0.15).toFixed(1),
        rawValue: `${ratio.toFixed(2)}x`,
        netDebtToEbitda: ratio,
        thresholdMet,
        status,
        warnings
    };
}

/**
 * 4. FCF Consistency (Weight 0.20)
 *    Count positive FCF years over the last five financial years.
 *    5 = 100, 4 = 80, 3 = 60, 2 = 40, 0–1 = 0.
 */
function scoreFCFConsistency(fcfHistory) {
    const warnings = [];
    if (!Array.isArray(fcfHistory) || fcfHistory.length === 0) {
        warnings.push('Multi-year cash flow statements unavailable; FCF Consistency scored 0.');
        return {
            name: 'FCF Consistency (5-Year)',
            weight: 0.20,
            score: 0,
            contribution: 0.0,
            rawValue: 'No History',
            positiveYearsCount: 0,
            totalYearsEvaluated: 0,
            thresholdMet: 'No Historical Data (Score 0)',
            status: 'warning',
            warnings
        };
    }

    // Evaluate up to the 5 most recent periods
    const evalPeriods = fcfHistory.slice(-5);
    const positiveYearsCount = evalPeriods.filter(p => p.fcf > 0).length;
    const totalPeriods = evalPeriods.length;

    let score = 0;
    let thresholdMet = '';
    let status = 'healthy';

    if (positiveYearsCount >= 5) {
        score = 100;
        thresholdMet = '5 Positive Years (Score 100)';
        status = 'healthy';
    } else if (positiveYearsCount === 4) {
        score = 80;
        thresholdMet = '4 Positive Years (Score 80)';
        status = 'healthy';
        if (totalPeriods === 5) {
            warnings.push('1 negative Free Cash Flow year recorded in the last 5 financial periods.');
        } else if (totalPeriods < 5) {
            warnings.push(`4 of 4 available financial reporting years had positive FCF (5th year unavailable from data feed).`);
        }
    } else if (positiveYearsCount === 3) {
        score = 60;
        thresholdMet = '3 Positive Years (Score 60)';
        status = 'caution';
        warnings.push(`Inconsistent cash generation: FCF was negative in ${totalPeriods - positiveYearsCount} of ${totalPeriods} recorded years.`);
    } else if (positiveYearsCount === 2) {
        score = 40;
        thresholdMet = '2 Positive Years (Score 40)';
        status = 'caution';
        warnings.push(`Volatile cash generation: Positive FCF in only 2 of ${totalPeriods} recorded periods.`);
    } else {
        score = 0;
        thresholdMet = '0–1 Positive Years (Score 0)';
        status = 'warning';
        warnings.push(`Chronic cash flow deficits: Positive FCF in ${positiveYearsCount} of ${totalPeriods} recorded periods.`);
    }

    return {
        name: 'FCF Consistency (5-Year)',
        weight: 0.20,
        score,
        contribution: +(score * 0.20).toFixed(1),
        rawValue: `${positiveYearsCount}/${Math.max(5, totalPeriods)} positive periods`,
        positiveYearsCount,
        totalYearsEvaluated: totalPeriods,
        thresholdMet,
        status,
        warnings
    };
}

/**
 * 5. Dividend History (Weight 0.15)
 *    10+ years maintained/increased = 100
 *    5–9 years  = 80
 *    3–4 years  = 60
 *    1–2 years  = 40
 *    Recent dividend cut = 0.
 */
function scoreDividendHistory(dividendHistory, recentCut, streakYears) {
    const warnings = [];
    let score = 0;
    let thresholdMet = '';
    let status = 'healthy';

    if (recentCut) {
        score = 0;
        thresholdMet = 'Recent Dividend Cut (Score 0)';
        status = 'warning';
        warnings.push('Recent dividend cut detected in recent financial periods.');
    } else if (streakYears >= 10) {
        score = 100;
        thresholdMet = '10+ Years Maintained/Increased (Score 100)';
        status = 'healthy';
    } else if (streakYears >= 5) {
        score = 80;
        thresholdMet = '5–9 Years Maintained/Increased (Score 80)';
        status = 'healthy';
    } else if (streakYears >= 3) {
        score = 60;
        thresholdMet = '3–4 Years Maintained/Increased (Score 60)';
        status = 'caution';
        warnings.push(`Emerging track record: Dividend maintained for ${streakYears} consecutive years.`);
    } else if (streakYears >= 1) {
        score = 40;
        thresholdMet = '1–2 Years Maintained/Increased (Score 40)';
        status = 'caution';
        warnings.push(`Short dividend history: ${streakYears} year(s) of continuous payout.`);
    } else {
        score = 0;
        thresholdMet = 'No Consecutive Dividend History (Score 0)';
        status = 'warning';
        warnings.push('No verified dividend payment track record in historical filings.');
    }

    return {
        name: 'Dividend History & Consistency',
        weight: 0.15,
        score,
        contribution: +(score * 0.15).toFixed(1),
        rawValue: recentCut ? 'Recent Dividend Cut' : `${streakYears} consecutive years`,
        streakYears,
        recentCut,
        thresholdMet,
        status,
        warnings
    };
}

/**
 * Sector-specific evaluation for Financial Institutions (Banks, Insurance)
 * ───────────────────────────────────────────────────────────────────────
 * Corporate FCF and Net Debt/EBITDA are structurally inapplicable to banking
 * balance sheets (where customer loans are assets and deposits are liabilities).
 * 
 * Financial Institution Weights:
 *   - Earnings Payout Safety: 40%
 *   - ROE Capital Generation Cushion: 30%
 *   - Dividend Track Record: 30%
 */
function evaluateFinancialInstitution(inputs) {
    const { payoutRatio, roe, recentCut, streakYears, sector } = inputs;
    const warnings = [];
    warnings.push('Financial Sector Model: Corporate Free Cash Flow and Net Debt are not standard metrics for financial institutions. Scored on earnings payout, ROE capital cushion, and dividend consistency.');

    // 1. Earnings Payout Safety (40%)
    let earnScore = 0;
    let earnThreshold = '';
    const earnPct = (payoutRatio != null) ? payoutRatio * 100 : null;

    if (earnPct === null) {
        earnScore = 40;
        earnThreshold = 'Data Missing (Score 40)';
        warnings.push('Earnings payout ratio unavailable; scored 40 with data warning.');
    } else if (earnPct < 0) {
        earnScore = 0;
        earnThreshold = 'Negative Net Earnings (Score 0)';
        warnings.push('Negative earnings / loan-loss distress reported.');
    } else if (earnPct < 40) {
        earnScore = 100;
        earnThreshold = 'Below 40% (Score 100)';
    } else if (earnPct <= 60) {
        earnScore = 80;
        earnThreshold = '40%–60% (Score 80)';
    } else if (earnPct <= 80) {
        earnScore = 50;
        earnThreshold = '60%–80% (Score 50)';
        warnings.push(`Elevated bank dividend payout (${earnPct.toFixed(1)}%): Exceeds standard 60% prudence threshold.`);
    } else {
        earnScore = 0;
        earnThreshold = 'Above 80% (Score 0)';
        warnings.push(`Excessive bank dividend payout (${earnPct.toFixed(1)}%): Depletes regulatory capital buffer.`);
    }

    const earningsSafety = {
        name: 'Earnings Payout Safety',
        weight: 0.40,
        score: earnScore,
        contribution: +(earnScore * 0.40).toFixed(1),
        rawValue: earnPct != null ? `${earnPct.toFixed(1)}%` : 'Unavailable',
        thresholdMet: earnThreshold,
        status: earnScore >= 80 ? 'healthy' : earnScore >= 50 ? 'caution' : 'warning',
        warnings: []
    };

    // 2. ROE Capital Cushion (30%)
    let roeScore = 0;
    let roeThreshold = '';
    const roePct = roe != null ? roe * 100 : null;

    if (roePct === null) {
        roeScore = 40;
        roeThreshold = 'Data Missing (Score 40)';
        warnings.push('Return on Equity (ROE) unavailable; scored 40 with data warning.');
    } else if (roePct >= 15) {
        roeScore = 100;
        roeThreshold = 'ROE ≥ 15% (Score 100)';
    } else if (roePct >= 12) {
        roeScore = 80;
        roeThreshold = 'ROE 12%–15% (Score 80)';
    } else if (roePct >= 8) {
        roeScore = 50;
        roeThreshold = 'ROE 8%–12% (Score 50)';
        warnings.push(`Sub-par bank capital returns: ROE of ${roePct.toFixed(1)}% indicates modest capital organic generation.`);
    } else if (roePct > 0) {
        roeScore = 20;
        roeThreshold = 'ROE < 8% (Score 20)';
        warnings.push(`Depressed ROE (${roePct.toFixed(1)}%): Low return on equity undermines dividend sustainability.`);
    } else {
        roeScore = 0;
        roeThreshold = 'Negative ROE (Score 0)';
        warnings.push('Negative Return on Equity: Core equity capital erosion.');
    }

    const capitalCushion = {
        name: 'ROE Capital Cushion',
        weight: 0.30,
        score: roeScore,
        contribution: +(roeScore * 0.30).toFixed(1),
        rawValue: roePct != null ? `${roePct.toFixed(1)}%` : 'Unavailable',
        thresholdMet: roeThreshold,
        status: roeScore >= 80 ? 'healthy' : roeScore >= 50 ? 'caution' : 'warning',
        warnings: []
    };

    // 3. Dividend History (30%)
    const divResult = scoreDividendHistory(inputs.dividendHistory, recentCut, streakYears);
    const dividendHistory = {
        name: 'Dividend History & Consistency',
        weight: 0.30,
        score: divResult.score,
        contribution: +(divResult.score * 0.30).toFixed(1),
        rawValue: divResult.rawValue,
        thresholdMet: divResult.thresholdMet,
        status: divResult.status,
        warnings: divResult.warnings
    };
    if (divResult.warnings.length) warnings.push(...divResult.warnings);

    const components = {
        earningsSafety,
        capitalCushion,
        dividendHistory
    };

    const totalContribution = Object.values(components).reduce((s, c) => s + c.contribution, 0);
    const finalScore = Math.max(0, Math.min(100, Math.round(totalContribution)));

    return {
        score: finalScore,
        components,
        warnings,
        isFinancial: true,
        sectorNote: 'Sector: Financial Services (Bank/Insurance Custom Model)'
    };
}

/**
 * Master DVS Calculation Function
 * ───────────────────────────────
 * Computes deterministic 5-factor DVS, signal bands, contributions, and warnings.
 */
function calculateDVS(inputs) {
    const {
        ticker = '',
        sector = '',
        fcf = null,
        totalDividends = null,
        payoutRatio = null,
        totalDebt = null,
        totalCash = null,
        ebitda = null,
        roe = null,
        fcfHistory = [],
        dividendHistory = [],
        recentCut = false,
        streakYears = 0
    } = inputs;

    const isFinancial = isFinancialSector(sector);

    let result;
    if (isFinancial) {
        result = evaluateFinancialInstitution(inputs);
    } else {
        const fcfSafety = scoreFCFSafety(fcf, totalDividends);
        const earningsSafety = scoreEarningsSafety(payoutRatio);
        const leverageSafety = scoreLeverageSafety(totalDebt, totalCash, ebitda);
        const fcfConsistency = scoreFCFConsistency(fcfHistory);
        const dividendHistResult = scoreDividendHistory(dividendHistory, recentCut, streakYears);

        const components = {
            fcfSafety,
            earningsSafety,
            leverageSafety,
            fcfConsistency,
            dividendHistory: dividendHistResult
        };

        const warnings = [
            ...fcfSafety.warnings,
            ...earningsSafety.warnings,
            ...leverageSafety.warnings,
            ...fcfConsistency.warnings,
            ...dividendHistResult.warnings
        ];

        const totalContribution = Object.values(components).reduce((s, c) => s + c.contribution, 0);
        const finalScore = Math.max(0, Math.min(100, Math.round(totalContribution)));

        result = {
            score: finalScore,
            components,
            warnings,
            isFinancial: false
        };
    }

    const { score, components, warnings } = result;

    // Signal and Band classification
    let signal = formula.signals.low;
    let band = 'red';

    if (score >= formula.bands.high) {
        signal = formula.signals.high;
        band = 'green';
    } else if (score >= formula.bands.low) {
        signal = formula.signals.moderate;
        band = 'yellow';
    } else {
        signal = formula.signals.low;
        band = 'red';
    }

    const scoreRange = `${Math.max(0, score - 3)} – ${Math.min(100, score + 3)}`;

    // Raw financial numbers preservation
    const debtVal = totalDebt || 0;
    const cashVal = totalCash || 0;
    const netDebtVal = debtVal - cashVal;
    const netDebtToEbitdaVal = (netDebtVal > 0 && ebitda && ebitda > 0) ? +(netDebtVal / ebitda).toFixed(2) : (netDebtVal <= 0 ? 0 : null);

    const rawFinancials = {
        freeCashFlow: fcf,
        totalDividendsPaid: totalDividends,
        fcfPayoutRatio: (fcf && fcf > 0 && totalDividends != null) ? +(totalDividends / fcf * 100).toFixed(2) : null,
        earningsPayoutRatio: payoutRatio != null ? +(payoutRatio * 100).toFixed(2) : null,
        totalDebt,
        totalCash,
        netDebt: netDebtVal,
        ebitda,
        netDebtToEbitda: netDebtToEbitdaVal,
        roe: roe != null ? +(roe * 100).toFixed(2) : null,
        streakYears,
        recentCut,
        fcfHistory: (fcfHistory || []).map(p => ({
            date: p.date ? new Date(p.date).toISOString().slice(0, 10) : 'N/A',
            fcf: p.fcf,
            isPositive: p.fcf > 0
        })),
        dividendHistory: (dividendHistory || []).map(d => ({
            year: d.year,
            amount: d.amount
        }))
    };

    return {
        ticker: ticker.toUpperCase(),
        score,
        scoreRange,
        signal,
        band,
        methodology: formula.methodology,
        formula: formula.formula,
        components,
        rawFinancials,
        warnings,
        isFinancial,
        sector,
        disclaimer: formula.disclaimer
    };
}

module.exports = {
    calculateDVS,
    scoreFCFSafety,
    scoreEarningsSafety,
    scoreLeverageSafety,
    scoreFCFConsistency,
    scoreDividendHistory,
    isFinancialSector
};
