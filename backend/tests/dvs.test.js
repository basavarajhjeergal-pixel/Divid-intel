/**
 * tests/dvs.test.js
 * 
 * Exhaustive unit tests for DividIntel 5-Factor DVS Methodology:
 *  - Component score bounds (0–100)
 *  - Formula weights (0.30, 0.20, 0.15, 0.20, 0.15)
 *  - All threshold boundaries for FCF, Earnings, Leverage, Consistency, History
 *  - Monotonicity: higher FCF payout NEVER receives a higher safety score
 *  - Historical dividend cuts and maintenance outcomes
 *  - Financial sector specific model
 *  - Missing data and data-quality warnings
 */

const {
    calculateDVS,
    scoreFCFSafety,
    scoreEarningsSafety,
    scoreLeverageSafety,
    scoreFCFConsistency,
    scoreDividendHistory,
    isFinancialSector
} = require('../dvs');

describe('DividIntel 5-Factor DVS Methodology', () => {

    describe('1. Component Thresholds & Scoring', () => {

        test('FCF Payout Safety thresholds', () => {
            // Below 60% = 100
            expect(scoreFCFSafety(100, 30).score).toBe(100);
            expect(scoreFCFSafety(100, 59.9).score).toBe(100);

            // 60–80% = 80
            expect(scoreFCFSafety(100, 60).score).toBe(80);
            expect(scoreFCFSafety(100, 75).score).toBe(80);
            expect(scoreFCFSafety(100, 80).score).toBe(80);

            // 80–100% = 50
            expect(scoreFCFSafety(100, 85).score).toBe(50);
            expect(scoreFCFSafety(100, 100).score).toBe(50);

            // Above 100% = 0
            const above100 = scoreFCFSafety(100, 105);
            expect(above100.score).toBe(0);
            expect(above100.warnings.length).toBeGreaterThan(0);

            // Negative or zero FCF = 0 and warning
            const zeroFcf = scoreFCFSafety(0, 10);
            expect(zeroFcf.score).toBe(0);
            expect(zeroFcf.warnings.some(w => w.toLowerCase().includes('negative or zero'))).toBe(true);

            const negFcf = scoreFCFSafety(-50, 10);
            expect(negFcf.score).toBe(0);
            expect(negFcf.warnings.some(w => w.toLowerCase().includes('negative or zero'))).toBe(true);
        });

        test('Earnings Payout Safety thresholds', () => {
            // Below 50% = 100
            expect(scoreEarningsSafety(0.20).score).toBe(100);
            expect(scoreEarningsSafety(0.49).score).toBe(100);

            // 50–75% = 80
            expect(scoreEarningsSafety(0.50).score).toBe(80);
            expect(scoreEarningsSafety(0.65).score).toBe(80);
            expect(scoreEarningsSafety(0.75).score).toBe(80);

            // 75–100% = 50
            expect(scoreEarningsSafety(0.85).score).toBe(50);
            expect(scoreEarningsSafety(1.00).score).toBe(50);

            // Above 100% = 0
            const above100 = scoreEarningsSafety(1.25);
            expect(above100.score).toBe(0);
            expect(above100.warnings.length).toBeGreaterThan(0);

            // Negative net earnings = 0
            const negativeEarnings = scoreEarningsSafety(-0.25);
            expect(negativeEarnings.score).toBe(0);
            expect(negativeEarnings.warnings.length).toBeGreaterThan(0);
        });

        test('Leverage Safety (Net Debt/EBITDA) thresholds', () => {
            // Net Debt below 1 (including net cash position) = 100
            expect(scoreLeverageSafety(50, 100, 100).score).toBe(100); // Net cash: debt 50, cash 100
            expect(scoreLeverageSafety(80, 0, 100).score).toBe(100);   // Net debt 80, EBITDA 100 -> 0.8x

            // 1–2 = 80
            expect(scoreLeverageSafety(150, 0, 100).score).toBe(80);  // 1.5x
            expect(scoreLeverageSafety(200, 0, 100).score).toBe(80);  // 2.0x

            // 2–3 = 50
            expect(scoreLeverageSafety(250, 0, 100).score).toBe(50);  // 2.5x
            expect(scoreLeverageSafety(300, 0, 100).score).toBe(50);  // 3.0x

            // Above 3 = 20
            const highLeverage = scoreLeverageSafety(450, 0, 100);    // 4.5x
            expect(highLeverage.score).toBe(20);
            expect(highLeverage.warnings.some(w => w.includes('3.0x'))).toBe(true);

            // Negative EBITDA with positive debt = 20 and warning
            const distressed = scoreLeverageSafety(100, 10, -20);
            expect(distressed.score).toBe(20);
            expect(distressed.warnings.some(w => w.toLowerCase().includes('negative'))).toBe(true);
        });

        test('FCF Consistency thresholds (5 financial years)', () => {
            // 5 positive years = 100
            const history5 = [{ fcf: 10 }, { fcf: 20 }, { fcf: 15 }, { fcf: 25 }, { fcf: 30 }];
            expect(scoreFCFConsistency(history5).score).toBe(100);

            // 4 positive years = 80
            const history4 = [{ fcf: -5 }, { fcf: 20 }, { fcf: 15 }, { fcf: 25 }, { fcf: 30 }];
            expect(scoreFCFConsistency(history4).score).toBe(80);

            // 3 positive years = 60
            const history3 = [{ fcf: -5 }, { fcf: -10 }, { fcf: 15 }, { fcf: 25 }, { fcf: 30 }];
            expect(scoreFCFConsistency(history3).score).toBe(60);

            // 2 positive years = 40
            const history2 = [{ fcf: -5 }, { fcf: -10 }, { fcf: -2 }, { fcf: 25 }, { fcf: 30 }];
            expect(scoreFCFConsistency(history2).score).toBe(40);

            // 0–1 positive years = 0
            const history1 = [{ fcf: -5 }, { fcf: -10 }, { fcf: -2 }, { fcf: -1 }, { fcf: 30 }];
            expect(scoreFCFConsistency(history1).score).toBe(0);

            const history0 = [{ fcf: -5 }, { fcf: -10 }, { fcf: -2 }, { fcf: -1 }, { fcf: -3 }];
            expect(scoreFCFConsistency(history0).score).toBe(0);
        });

        test('Dividend History thresholds', () => {
            // 10+ years maintained/increased = 100
            expect(scoreDividendHistory([], false, 12).score).toBe(100);
            expect(scoreDividendHistory([], false, 10).score).toBe(100);

            // 5–9 years = 80
            expect(scoreDividendHistory([], false, 7).score).toBe(80);
            expect(scoreDividendHistory([], false, 5).score).toBe(80);

            // 3–4 years = 60
            expect(scoreDividendHistory([], false, 4).score).toBe(60);
            expect(scoreDividendHistory([], false, 3).score).toBe(60);

            // 1–2 years = 40
            expect(scoreDividendHistory([], false, 2).score).toBe(40);
            expect(scoreDividendHistory([], false, 1).score).toBe(40);

            // Recent dividend cut = 0 (even with 20-year prior streak)
            const cutResult = scoreDividendHistory([], true, 20);
            expect(cutResult.score).toBe(0);
            expect(cutResult.warnings.some(w => w.toLowerCase().includes('cut'))).toBe(true);
        });

    });

    describe('2. Mathematical Integrity & Monotonicity', () => {

        test('Monotonicity: Higher FCF payout ratio NEVER receives a higher safety score', () => {
            const ratios = [10, 30, 50, 59, 61, 70, 79, 81, 95, 99, 101, 150, 250];
            let previousScore = 100;

            for (const pct of ratios) {
                const res = scoreFCFSafety(100, pct);
                expect(res.score).toBeLessThanOrEqual(previousScore);
                previousScore = res.score;
            }
        });

        test('Formula component contributions sum exactly to final DVS', () => {
            const sample = calculateDVS({
                ticker: 'TEST',
                sector: 'Technology',
                fcf: 1000,
                totalDividends: 400, // 40% payout -> 100
                payoutRatio: 0.45,   // 45% payout -> 100
                totalDebt: 300,
                totalCash: 500,      // Net cash -> 100
                ebitda: 400,
                fcfHistory: [{ fcf: 100 }, { fcf: 150 }, { fcf: 200 }, { fcf: 250 }, { fcf: 300 }], // 5/5 -> 100
                streakYears: 12,     // 10+ yrs -> 100
                recentCut: false
            });

            expect(sample.score).toBe(100);
            expect(sample.components.fcfSafety.contribution).toBe(30);
            expect(sample.components.earningsSafety.contribution).toBe(20);
            expect(sample.components.leverageSafety.contribution).toBe(15);
            expect(sample.components.fcfConsistency.contribution).toBe(20);
            expect(sample.components.dividendHistory.contribution).toBe(15);

            const sumOfContributions = Object.values(sample.components).reduce((s, c) => s + c.contribution, 0);
            expect(sumOfContributions).toBe(100);
        });

    });

    describe('3. Historical Dividend Scenarios & Failure Cases', () => {

        test('Historical Dividend Cut: drops Dividend History to 0 and flags warning', () => {
            const result = calculateDVS({
                ticker: 'CUT_CO',
                sector: 'Consumer Discretionary',
                fcf: 500,
                totalDividends: 200,
                payoutRatio: 0.40,
                totalDebt: 200,
                totalCash: 100,
                ebitda: 300,
                fcfHistory: [{ fcf: 100 }, { fcf: 100 }, { fcf: 100 }, { fcf: 100 }, { fcf: 100 }],
                recentCut: true,     // <--- Dividend Cut
                streakYears: 8
            });

            expect(result.components.dividendHistory.score).toBe(0);
            expect(result.components.dividendHistory.contribution).toBe(0);
            expect(result.warnings.some(w => w.toLowerCase().includes('cut'))).toBe(true);
            expect(result.score).toBeLessThanOrEqual(85);
        });

        test('Cash-Burning Yield Trap: negative FCF and >100% earnings payout drops into Red Band (<50)', () => {
            const yieldTrap = calculateDVS({
                ticker: 'TRAP',
                sector: 'Real Estate',
                fcf: -150,           // Cash burn
                totalDividends: 100,
                payoutRatio: 1.40,   // 140% earnings payout
                totalDebt: 900,
                totalCash: 50,
                ebitda: 150,         // Net Debt / EBITDA = (850/150) = 5.67x
                fcfHistory: [{ fcf: -50 }, { fcf: -100 }, { fcf: 20 }, { fcf: -30 }, { fcf: -150 }], // 1/5 pos
                recentCut: true,
                streakYears: 1
            });

            expect(yieldTrap.score).toBeLessThan(50);
            expect(yieldTrap.band).toBe('red');
            expect(yieldTrap.signal).toBe('Elevated Dividend Cut Risk');
            expect(yieldTrap.warnings.length).toBeGreaterThan(2);
        });

        test('Dividend Aristocrat / Cash Compounder: achieves Green Band (≥70)', () => {
            const aristocrat = calculateDVS({
                ticker: 'ARISTO',
                sector: 'Consumer Staples',
                fcf: 15000,
                totalDividends: 7000, // 46.7% payout -> Score 100 (30 pts)
                payoutRatio: 0.48,    // 48% payout -> Score 100 (20 pts)
                totalDebt: 8000,
                totalCash: 9000,      // Net cash -> Score 100 (15 pts)
                ebitda: 6000,
                fcfHistory: [{ fcf: 10000 }, { fcf: 11000 }, { fcf: 12500 }, { fcf: 14000 }, { fcf: 15000 }], // 5/5 -> Score 100 (20 pts)
                recentCut: false,
                streakYears: 25       // Score 100 (15 pts)
            });

            expect(aristocrat.score).toBe(100);
            expect(aristocrat.band).toBe('green');
            expect(aristocrat.signal).toBe('High Dividend Safety');
            expect(aristocrat.warnings.length).toBe(0);
        });

    });

    describe('4. Financial Sector Specific Methodology', () => {

        test('Bank ticker receives sector-adjusted evaluation without FCF penalty', () => {
            expect(isFinancialSector('Financial Services')).toBe(true);
            expect(isFinancialSector('Banks')).toBe(true);
            expect(isFinancialSector('Insurance')).toBe(true);
            expect(isFinancialSector('Technology')).toBe(false);

            const bankResult = calculateDVS({
                ticker: 'JPM',
                sector: 'Financial Services',
                fcf: null,            // Bank FCF is null
                totalDividends: 4000,
                payoutRatio: 0.32,    // 32% payout (< 40%) -> Score 100 (40 pts)
                roe: 0.165,           // 16.5% ROE (≥ 15%) -> Score 100 (30 pts)
                totalDebt: null,
                totalCash: null,
                ebitda: null,
                recentCut: false,
                streakYears: 11       // 10+ yrs -> Score 100 (30 pts)
            });

            expect(bankResult.isFinancial).toBe(true);
            expect(bankResult.score).toBe(100);
            expect(bankResult.band).toBe('green');
            expect(bankResult.components.earningsSafety.weight).toBe(0.40);
            expect(bankResult.components.capitalCushion.weight).toBe(0.30);
            expect(bankResult.components.dividendHistory.weight).toBe(0.30);
            expect(bankResult.warnings.some(w => w.includes('Financial Sector Model'))).toBe(true);
        });

    });

    describe('5. Missing Data Transparency', () => {

        test('Missing FCF data does NOT silently assign 100', () => {
            const missingFCF = calculateDVS({
                ticker: 'NOFCF',
                sector: 'Industrials',
                fcf: null,            // Missing FCF
                totalDividends: 100,
                payoutRatio: 0.40,
                totalDebt: 200,
                totalCash: 100,
                ebitda: 300,
                fcfHistory: [],
                recentCut: false,
                streakYears: 5
            });

            expect(missingFCF.components.fcfSafety.score).toBe(0);
            expect(missingFCF.components.fcfSafety.contribution).toBe(0);
            expect(missingFCF.warnings.some(w => w.toLowerCase().includes('unavailable'))).toBe(true);
            expect(missingFCF.score).toBeLessThanOrEqual(70);
        });

        test('Preserves raw financial data in response structure', () => {
            const result = calculateDVS({
                ticker: 'RAW_TEST',
                sector: 'Energy',
                fcf: 850000000,
                totalDividends: 340000000,
                payoutRatio: 0.42,
                totalDebt: 1200000000,
                totalCash: 400000000,
                ebitda: 900000000,
                roe: 0.18,
                fcfHistory: [{ fcf: 700000000 }, { fcf: 850000000 }],
                dividendHistory: [{ year: 2024, amount: 2.50 }, { year: 2025, amount: 2.75 }],
                recentCut: false,
                streakYears: 4
            });

            expect(result.rawFinancials).toBeDefined();
            expect(result.rawFinancials.freeCashFlow).toBe(850000000);
            expect(result.rawFinancials.totalDividendsPaid).toBe(340000000);
            expect(result.rawFinancials.fcfPayoutRatio).toBe(40);
            expect(result.rawFinancials.earningsPayoutRatio).toBe(42);
            expect(result.rawFinancials.netDebt).toBe(800000000);
            expect(result.rawFinancials.netDebtToEbitda).toBe(0.89);
            expect(result.rawFinancials.roe).toBe(18);
            expect(result.rawFinancials.streakYears).toBe(4);
            expect(result.rawFinancials.recentCut).toBe(false);
        });

    });

});
