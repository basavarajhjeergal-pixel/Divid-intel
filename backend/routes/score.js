const express = require('express');
const router = express.Router();
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({
    suppressNotices: ['yahooSurvey', 'ripHistorical'],
    logger: { ...console, warn: (msg, ...args) => { if (!String(msg).includes('Unsupported environment')) console.warn(msg, ...args); } }
});

const { calculateDVS, isFinancialSector } = require('../dvs');
const formula = require('../formula.json');

let researchUniverse = {};
try {
    researchUniverse = require('../research_universe.json');
} catch (e) {
    researchUniverse = {};
}

/**
 * Robustly fetch all fundamentals and historical records for DVS calculation
 */
async function fetchDVSData(ticker) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const divStart = new Date(currentYear - 15, 0, 1);

    // Parallel fetch: quoteSummary, fundamentalsTimeSeries, chart dividend events
    const [summaryRes, seriesRes, chartRes] = await Promise.allSettled([
        yf.quoteSummary(ticker, {
            modules: ['financialData', 'defaultKeyStatistics', 'assetProfile', 'summaryDetail']
        }),
        yf.fundamentalsTimeSeries(ticker, {
            period1: '2019-01-01',
            module: 'all',
            type: 'annual'
        }),
        yf.chart(ticker, {
            period1: divStart,
            period2: now,
            interval: '1mo',
            events: 'div'
        })
    ]);

    const summary = summaryRes.status === 'fulfilled' ? summaryRes.value : {};
    const series  = seriesRes.status === 'fulfilled'  ? seriesRes.value : [];
    const divData = chartRes.status === 'fulfilled'   ? chartRes.value : {};

    const fd = summary.financialData        || {};
    const ks = summary.defaultKeyStatistics || {};
    const ap = summary.assetProfile         || {};
    const sd = summary.summaryDetail        || {};

    const research = researchUniverse[ticker] || null;
    let sector = ap.sector || (research ? research.sector : '');

    // 1. FCF extraction: Prefer financialData, fallback to latest annual statement in series, then research
    const validSeries = (series || []).filter(s => s.freeCashFlow != null || (s.operatingCashFlow != null && s.capitalExpenditure != null))
                                      .sort((a, b) => new Date(b.date) - new Date(a.date));
    const latestSeries = validSeries[0];
    const seriesFcf = latestSeries ? (latestSeries.freeCashFlow ?? (latestSeries.operatingCashFlow - Math.abs(latestSeries.capitalExpenditure))) : null;

    let fcf = fd.freeCashflow ?? seriesFcf;
    if (fcf === null && research && research.fcf !== undefined) {
        fcf = research.fcf;
    }

    // 2. Dividends paid
    const dividendRate = sd.dividendRate ?? null;
    const sharesOut    = ks.sharesOutstanding ?? null;
    let totalDividends = (dividendRate && sharesOut) ? dividendRate * sharesOut : null;

    // 3. Payout ratio
    let payoutRatio = sd.payoutRatio ?? null;
    if (payoutRatio === null && research && research.payoutRatio !== undefined) {
        payoutRatio = research.payoutRatio;
    }

    // 4. Balance sheet & Solvency
    const totalDebt = fd.totalDebt ?? (latestSeries?.totalDebt || null);
    const totalCash = fd.totalCash ?? (latestSeries?.cashAndCashEquivalents || null);
    const ebitda    = fd.ebitda    ?? (latestSeries?.EBITDA || null);
    const roe       = fd.returnOnEquity ?? (research?.roe || null);

    // 5. 5-Year FCF History
    const fcfHistory = validSeries.slice(-5).map(r => ({
        date: r.date,
        fcf: r.freeCashFlow ?? (r.operatingCashFlow != null && r.capitalExpenditure != null ? r.operatingCashFlow - Math.abs(r.capitalExpenditure) : null)
    })).filter(x => x.fcf !== null && x.fcf !== undefined);

    // If series is empty but we have trailing FCF, use trailing FCF as a 1-year entry
    if (fcfHistory.length === 0 && fcf !== null) {
        fcfHistory.push({ date: new Date(), fcf });
    }

    // 6. Dividend History aggregation & Cut detection
    const divEvents = divData.events?.dividends || [];
    const yearlyMap = {};
    divEvents.forEach(d => {
        const yr = new Date(d.date).getFullYear();
        yearlyMap[yr] = (yearlyMap[yr] || 0) + (d.amount || d.dividends || 0);
    });

    const completedYears = Object.keys(yearlyMap).map(Number).filter(y => y < currentYear).sort((a, b) => a - b);
    
    let recentCut = false;
    let cutDetail = null;

    if (completedYears.length >= 2) {
        const lastY = completedYears[completedYears.length - 1];
        const prevY = completedYears[completedYears.length - 2];
        if (yearlyMap[lastY] < yearlyMap[prevY] * 0.98) {
            recentCut = true;
            cutDetail = { fromYear: prevY, toYear: lastY, fromAmount: yearlyMap[prevY], toAmount: yearlyMap[lastY] };
        }
    }
    if (completedYears.length >= 3 && !recentCut) {
        const prevY = completedYears[completedYears.length - 2];
        const prevPrevY = completedYears[completedYears.length - 3];
        if (yearlyMap[prevY] < yearlyMap[prevPrevY] * 0.98) {
            recentCut = true;
            cutDetail = { fromYear: prevPrevY, toYear: prevY, fromAmount: yearlyMap[prevPrevY], toAmount: yearlyMap[prevY] };
        }
    }

    let streakYears = completedYears.length > 0 ? 1 : 0;
    for (let i = completedYears.length - 1; i > 0; i--) {
        const cy = completedYears[i];
        const py = completedYears[i - 1];
        if (cy - py > 1) break;
        if (yearlyMap[cy] >= yearlyMap[py] * 0.98) {
            streakYears++;
        } else {
            break;
        }
    }

    const dividendHistory = completedYears.map(yr => ({ year: yr, amount: yearlyMap[yr] }));

    return {
        ticker,
        sector,
        fcf,
        totalDividends,
        payoutRatio,
        totalDebt,
        totalCash,
        ebitda,
        roe,
        fcfHistory,
        dividendHistory,
        recentCut,
        cutDetail,
        streakYears,
        isResearchCohort: !!research
    };
}

// ── GET /api/score/:ticker ────────────────────────────────────────────────────
router.get('/:ticker', async (req, res) => {
    const ticker = req.params.ticker.toUpperCase().trim();

    try {
        const rawData = await fetchDVSData(ticker);

        // Check if data is completely empty
        const hasAnyData = rawData.fcf !== null || rawData.payoutRatio !== null || rawData.totalDebt !== null || rawData.streakYears > 0;
        if (!hasAnyData && !rawData.isResearchCohort) {
            return res.json({
                ticker,
                score: null,
                scoreRange: 'N/A',
                signal: 'Insufficient data',
                band: 'grey',
                note: 'Insufficient financial statement history from data feed to compute 5-Factor DVS.',
                sector: rawData.sector,
                warnings: ['All key fundamental factors (FCF, Payout, Debt, Dividend history) are missing.'],
                components: null,
                rawFinancials: null,
                isResearchCohort: false
            });
        }

        // Calculate 5-Factor DVS
        const dvsResult = calculateDVS(rawData);

        // Backwards compatibility factors block for existing widgets
        const factors = {
            ROE: rawData.roe != null ? +(rawData.roe * 100).toFixed(2) : null,
            FCFPayoutRatio: dvsResult.rawFinancials.fcfPayoutRatio,
            EarningsPayoutRatio: dvsResult.rawFinancials.earningsPayoutRatio,
            NetDebtToEBITDA: dvsResult.rawFinancials.netDebtToEbitda,
            StreakYears: rawData.streakYears,
            RecentCut: rawData.recentCut
        };

        return res.json({
            ...dvsResult,
            factors,
            isResearchCohort: rawData.isResearchCohort
        });

    } catch (err) {
        console.error(`[score] Error for ${ticker}:`, err.message);
        return res.status(500).json({
            ticker,
            score: null,
            scoreRange: 'N/A',
            signal: 'Error',
            band: 'grey',
            error: err.message,
            warnings: [`Data retrieval failed: ${err.message}`]
        });
    }
});

module.exports = router;
