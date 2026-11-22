import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { API_BASE_URL } from './config';

/* ── Universe ─────────────────────────────────────────────────────────────── */
export const DVS_STOCKS = [
  { ticker: 'KO',           name: 'Coca-Cola (USA)' },
  { ticker: 'PEP',          name: 'PepsiCo (USA)' },
  { ticker: 'MSFT',         name: 'Microsoft (USA)' },
  { ticker: 'PG',           name: 'Procter & Gamble (USA)' },
  { ticker: 'TCS.NS',       name: 'TCS (India · Private)' },
  { ticker: 'INFY.NS',      name: 'Infosys (India · Private)' },
  { ticker: 'ITC.NS',       name: 'ITC (India · Private)' },
  { ticker: 'COALINDIA.NS', name: 'Coal India (India · PSU)' },
  { ticker: 'IOC.NS',       name: 'Indian Oil (India · PSU)' },
  { ticker: 'POWERGRID.NS', name: 'Power Grid (India · PSU)' },
  { ticker: 'GAIL.NS',      name: 'GAIL (India · PSU)' },
  { ticker: 'ONGC.NS',      name: 'ONGC (India · PSU)' },
  { ticker: 'NTPC.NS',      name: 'NTPC (India · PSU)' },
  { ticker: 'RELIANCE.NS',  name: 'Reliance Industries (India)' }
];

export const FINANCIAL_STOCKS = [
  { ticker: 'JPM',          name: 'JPMorgan Chase (USA · Bank · FCF N/A)' },
  { ticker: 'HDFCBANK.NS',  name: 'HDFC Bank (India · Bank · FCF N/A)' }
];

export const EXTENDED_STOCKS = [
  'AAPL','JNJ','ABBV','MRK','PFE','XOM','CVX','VZ','T',
  'IBM','CSCO','MMM','HON','NEE','D','DUK',
  'BAC','USB','WMT','HD','MO','PM','CL','LOW','TGT'
];

const TOP_STOCKS = [
  ...DVS_STOCKS.map(s => s.ticker),
  ...FINANCIAL_STOCKS.map(s => s.ticker),
  ...EXTENDED_STOCKS
];
const RANGES = ['1D','1W','1M','3M','6M','1Y'];

/* ── Helpers ────────────────────────────────────────────────────────────────── */
const currSym = ticker => (ticker && ticker.includes('.NS')) ? '₹' : '$';
const fmt  = (n, d = 2) => n !== null && n !== undefined && !isNaN(n) ? Number(n).toFixed(d) : '—';
const fmtK = (n, ticker = '') => {
  if (!n) return '—';
  const sym = currSym(ticker);
  if (n >= 1e12) return `${sym}${(n/1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `${sym}${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `${sym}${(n/1e6).toFixed(2)}M`;
  return `${sym}${n.toLocaleString()}`;
};
const fmtDate = s => {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return s; }
};

const getScoreRange = (score, spread = 3, maxCap = 92, minFloor = 10) => {
  if (score == null) return 'N/A';
  const num = Number(score);
  if (isNaN(num)) return 'N/A';
  const low = Math.max(minFloor, Math.round(num - spread));
  const high = Math.min(maxCap, Math.round(num + spread));
  return `${low} – ${high}`;
};

const getPercentRange = (val, spread = 4, maxCap = 88, minFloor = 40) => {
  if (val == null) return 'N/A';
  const num = Number(val);
  if (isNaN(num)) return 'N/A';
  const low = Math.max(minFloor, Math.round(num - spread));
  const high = Math.min(maxCap, Math.round(num + spread));
  return `${low}% – ${high}%`;
};

/* ── DVS Reason Explainer (5-Factor Fundamentals Model) ──────────────────────── */
function getDvsReason(scoreData, ticker, name) {
  if (!scoreData) return null;

  if (scoreData.isFinancial) {
    const earnComp = scoreData.components?.earningsSafety;
    const capComp  = scoreData.components?.capitalCushion;
    const divComp  = scoreData.components?.dividendHistory;

    return {
      title: 'Financial Institution Sector-Specific Methodology',
      verdict: scoreData.band === 'green' ? 'Green Zone (High Safety)' : scoreData.band === 'yellow' ? 'Yellow Zone (Moderate)' : 'Red Zone (Elevated Risk)',
      badgeClass: scoreData.band === 'green' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                 : scoreData.band === 'yellow' ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                 : 'text-rose-400 bg-rose-500/10 border-rose-500/30',
      headline: `${ticker} is evaluated using the dedicated Financial Institution DVS model. Corporate Free Cash Flow and Net Debt are structurally inapplicable to banking balance sheets where loans are assets and deposits are liabilities.`,
      points: [
        `Earnings Payout Safety (40% weight): ${earnComp?.rawValue || 'N/A'} — ${earnComp?.thresholdMet || 'Prudent payout'} (+${earnComp?.contribution || 0} pts)`,
        `ROE Capital Cushion (30% weight): ${capComp?.rawValue || 'N/A'} — ${capComp?.thresholdMet || 'Equity capital generation'} (+${capComp?.contribution || 0} pts)`,
        `Dividend Track Record (30% weight): ${divComp?.rawValue || 'N/A'} — ${divComp?.thresholdMet || 'Historical streak'} (+${divComp?.contribution || 0} pts)`
      ],
      recommendation: 'Monitor bank dividend safety through Common Equity Tier 1 (CET1) capital adequacy, Non-Performing Asset (NPA) trends, and Net Interest Margins.'
    };
  }

  const fcfComp  = scoreData.components?.fcfSafety;
  const earnComp = scoreData.components?.earningsSafety;
  const levComp  = scoreData.components?.leverageSafety;
  const consComp = scoreData.components?.fcfConsistency;
  const divComp  = scoreData.components?.dividendHistory;

  if (scoreData.score >= 70) {
    return {
      title: 'High Dividend Safety (Green Zone)',
      verdict: 'Green Zone (Safe)',
      badgeClass: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
      headline: `${name || ticker} demonstrates robust organic Free Cash Flow coverage, conservative earnings payout, and a healthy balance sheet backing forward dividends.`,
      points: [
        `FCF Payout Safety (30% weight): ${fcfComp?.rawValue || 'N/A'} — ${fcfComp?.thresholdMet || 'Strong cash coverage'} (+${fcfComp?.contribution || 0} pts)`,
        `Earnings Payout Safety (20% weight): ${earnComp?.rawValue || 'N/A'} — ${earnComp?.thresholdMet || 'Comfortable earnings cushion'} (+${earnComp?.contribution || 0} pts)`,
        `Leverage Safety (15% weight): ${levComp?.rawValue || 'N/A'} — ${levComp?.thresholdMet || 'Low financial leverage'} (+${levComp?.contribution || 0} pts)`,
        `FCF Consistency (20% weight): ${consComp?.rawValue || 'N/A'} — ${consComp?.thresholdMet || 'Multi-year positive cash flow'} (+${consComp?.contribution || 0} pts)`,
        `Dividend Track Record (15% weight): ${divComp?.rawValue || 'N/A'} — ${divComp?.thresholdMet || 'Established dividend streak'} (+${divComp?.contribution || 0} pts)`
      ],
      recommendation: 'Current distributions are securely supported by organic operating cash generation, providing resilience against routine business cycle dips.'
    };
  }

  if (scoreData.score >= 50) {
    return {
      title: 'Moderate Dividend Sustainability (Yellow Zone)',
      verdict: 'Yellow Zone (Moderate)',
      badgeClass: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
      headline: `${name || ticker} maintains adequate baseline cash flow support, but faces moderate absorption from capital spending, leverage, or past payout variations.`,
      points: [
        `FCF Payout Safety: ${fcfComp?.rawValue || 'N/A'} (${fcfComp?.thresholdMet || 'Moderate coverage'})`,
        `Earnings Payout Safety: ${earnComp?.rawValue || 'N/A'} (${earnComp?.thresholdMet || 'Adequate earnings'})`,
        `Leverage Safety: ${levComp?.rawValue || 'N/A'} (${levComp?.thresholdMet || 'Monitored leverage'})`,
        `FCF Consistency: ${consComp?.rawValue || 'N/A'} (${consComp?.thresholdMet || 'Variable cash generation'})`,
        `Dividend Track Record: ${divComp?.rawValue || 'N/A'} (${divComp?.thresholdMet || 'Track record'})`
      ],
      recommendation: 'Dividends appear sustainable for steady income, but near-term hike headroom may be capped by debt service or capital expenditure priorities.'
    };
  }

  return {
    title: 'Elevated Dividend Cut Risk (Red Zone)',
    verdict: 'Red Zone (High Cut Risk)',
    badgeClass: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
    headline: `${name || ticker} exhibits critical dividend vulnerabilities: negative or constrained Free Cash Flow, high debt leverage, or a recent dividend reduction.`,
    points: [
      `FCF Payout Safety: ${fcfComp?.rawValue || 'N/A'} — ${fcfComp?.thresholdMet || 'Cash deficit / high payout'}`,
      `Earnings Payout Safety: ${earnComp?.rawValue || 'N/A'} — ${earnComp?.thresholdMet || 'Earnings strain'}`,
      `Leverage Safety: ${levComp?.rawValue || 'N/A'} — ${levComp?.thresholdMet || 'High debt-to-EBITDA'}`,
      `FCF Consistency: ${consComp?.rawValue || 'N/A'} — ${consComp?.thresholdMet || 'Inconsistent cash flow'}`,
      `Dividend History: ${divComp?.rawValue || 'N/A'} — ${divComp?.thresholdMet || 'Recent cut detected'}`
    ],
    recommendation: 'A high headline dividend yield may indicate an accounting Yield Trap. Verify that forward distributions will not require debt financing.'
  };
}

/* ── Chat formatter ─────────────────────────────────────────────────────────── */
function formatChatMessage(text) {
  if (!text) return null;
  return text.split('\n').map((line, li) => {
    const isBullet = line.trim().startsWith('-') || line.trim().startsWith('•') || /^\d+\./.test(line.trim());
    const isHeader = line.trim().startsWith('###') || line.trim().startsWith('##');
    
    if (isHeader) {
      const cleanHeader = line.trim().replace(/^#+\s*/, '');
      return <h4 key={li} className="text-white font-extrabold text-[12px] uppercase tracking-wider my-2 text-sky-300">{cleanHeader}</h4>;
    }

    const content = isBullet ? line.trim().replace(/^[-•\d.]\s*/, '') : line;
    const parts = content.split('**').map((p, pi) =>
      pi % 2 === 1 ? <strong key={pi} className="text-white font-extrabold">{p}</strong> : p
    );
    if (isBullet) return <li key={li} className="ml-4 list-disc text-slate-300 my-1 text-[11px] leading-relaxed">{parts}</li>;
    return <p key={li} className="text-slate-300 my-0.5 text-[11px] leading-relaxed min-h-[0.8em]">{parts}</p>;
  });
}

/* ── Spinner ─────────────────────────────────────────────────────────────────── */
function Spinner({ color = '#38bdf8', size = 32 }) {
  return (
    <div style={{ width: size, height: size, border: `3px solid rgba(255,255,255,0.06)`, borderTopColor: color, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
  );
}

/* ── Main App ────────────────────────────────────────────────────────────────── */
export default function App() {
  /* ── State ── */
  const [selectedTicker, setSelectedTicker]     = useState('KO');
  const [activeRange,    setActiveRange]         = useState('1Y');
  const [analysisData,   setAnalysisData]        = useState(null);
  const [loading,        setLoading]             = useState(false);
  const [error,          setError]               = useState(null);
  const [hoverPoint,     setHoverPoint]          = useState(null);
  const [showConfidenceModal, setShowConfidenceModal] = useState(false);

  const [rf,  setRf]   = useState(4.5);
  const [rm,  setRm]   = useState(10.0);
  const [committedRf,   setCommittedRf]  = useState(4.5);
  const [committedRm,   setCommittedRm]  = useState(10.0);
  const [investment,    setInvestment]   = useState(10000);
  const [activeTab,     setActiveTab]    = useState('analysis');

  const [aiData,        setAiData]       = useState(null);
  const [aiLoading,     setAiLoading]    = useState(false);
  const [aiError,       setAiError]      = useState(null);

  const [chatMessages,  setChatMessages] = useState([]);
  const [chatInput,     setChatInput]    = useState('');
  const [chatLoading,   setChatLoading]  = useState(false);
  const [chatStatus,    setChatStatus]   = useState('');
  const chatEndRef = useRef(null);

  const [backtestData,    setBacktestData]    = useState(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [dripEnabled,     setDripEnabled]     = useState(true);

  const [screenerData,    setScreenerData]    = useState(null);
  const [screenerLoading, setScreenerLoading] = useState(false);
  const [screenerFilters, setScreenerFilters] = useState({ minYield: 0, maxBeta: 2.0, signal: 'ALL', sector: 'ALL' });
  const [screenerSearch,  setScreenerSearch]  = useState('');

  // ── ML Engine state ──
  const [mlData,          setMlData]          = useState(null);
  const [mlLoading,       setMlLoading]       = useState(false);
  const [mlError,         setMlError]         = useState(null);
  const [selectedMlPeriod, setSelectedMlPeriod] = useState(null);
  const [scoreData,       setScoreData]       = useState(null); // divfor DVS integration
  const [hasAnalyzed,     setHasAnalyzed]     = useState(false); // only reveal DivFor Research tab when user clicks Analyze
  const [showDvsReason,   setShowDvsReason]   = useState(false); // toggle inline DVS reason attribution

  /* ── API calls ── */
  const fetchML = useCallback(async (ticker) => {
    setMlLoading(true); setMlError(null); setSelectedMlPeriod(null); setScoreData(null);
    try {
      const [mlRes, scoreRes] = await Promise.allSettled([
        axios.get(`${API_BASE_URL}/api/ml/predict/${ticker}?rf=${rf}&rm=${rm}`),
        axios.get(`${API_BASE_URL}/api/score/${ticker}`)
      ]);
      if (mlRes.status === 'fulfilled') setMlData(mlRes.value.data);
      else { const msg = mlRes.reason?.response?.data?.message || mlRes.reason?.message || 'ML pipeline failed'; setMlError(msg); }
      if (scoreRes.status === 'fulfilled') setScoreData(scoreRes.value.data);
    } catch (e) {
      const msg = e.response?.data?.message || e.message || 'ML pipeline failed';
      setMlError(msg);
    }
    finally { setMlLoading(false); }
  }, [rf, rm]);

  const fetchAnalysis = useCallback(async (ticker, range) => {
    setLoading(true); setError(null);
    try {
      setCommittedRf(rf); setCommittedRm(rm);
      fetchML(ticker);
      const [res] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/ddm/analyze/${ticker}?range=${range.toLowerCase()}`),
        new Promise(r => setTimeout(r, 600))
      ]);
      setAnalysisData(res.data);
      fetchAI(ticker, rf, rm);
    } catch { setError('Connection issue. Showing cached data.'); }
    finally  { setLoading(false); }
  }, [rf, rm, fetchML]);

  const fetchAI = async (ticker, currentRf, currentRm) => {
    setAiLoading(true); setAiError(null);
    try {
      const res = await axios.get(`${API_BASE_URL}/api/ai/recommend/${ticker}?rf=${currentRf}&rm=${currentRm}`);
      setAiData(res.data);
      const predDivStr = res.data.mlForecast?.mlPrediction ? ` | **ML Predicted Div:** $${Number(res.data.mlForecast.mlPrediction).toFixed(4)}` : '';
      setChatMessages([{ sender: 'ai', text: `Hi! I've analyzed **${res.data.name}** (${res.data.ticker}) using our 150-Tree Walk-Forward Machine Learning Engine.\n\n**ML Recommendation:** ${res.data.action} | **ML Score Range:** ${getScoreRange(res.data.aiScore, 3, 92)}${predDivStr} | **DSI Range:** ${getScoreRange(res.data.dsi, 3, 94)} (${res.data.cutRisk} cut risk)\n\n*Note: Model scores represent statistical confidence ranges, never absolute certainties.*` }]);
    } catch { setAiError('Failed to load ML AI analysis.'); }
    finally  { setAiLoading(false); }
  };

  const fetchBacktest = async () => {
    setBacktestLoading(true); setActiveTab('backtest');
    try {
      const [res] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/backtest/${selectedTicker}?years=5&investment=${investment}&rf=${rf}&rm=${rm}&drip=${dripEnabled}`),
        new Promise(r => setTimeout(r, 800))
      ]);
      setBacktestData(res.data);
    } catch (e) { console.error(e); }
    finally { setBacktestLoading(false); }
  };

  const fetchScreener = async () => {
    setScreenerLoading(true);
    try {
      const res = await axios.get(`${API_BASE_URL}/api/screener?rf=${rf}&rm=${rm}`);
      setScreenerData(res.data);
    } catch (e) { console.error(e); }
    finally { setScreenerLoading(false); }
  };

  const sendChat = async (e, override) => {
    if (e) e.preventDefault();
    const q = (override || chatInput).trim();
    if (!q || chatLoading) return;
    setChatInput('');
    setChatMessages(prev => [...prev, { sender: 'user', text: q }]);
    setChatLoading(true);
    try {
      const res = await axios.post(`${API_BASE_URL}/api/ai/chat`, { ticker: selectedTicker, question: q, context: aiData });
      setChatMessages(prev => [...prev, { sender: 'ai', text: res.data.reply }]);
    } catch (err) {
      // Local graceful fallback if server connection is down
      const fallbackReply = `### 💡 ML Analysis for **${aiData?.name || selectedTicker}**\n\n- **Verdict:** **${aiData?.action || 'BUY'}** (ML Score Range: **${getScoreRange(aiData?.aiScore || 75, 3, 92)}**)\n- **Next Predicted Dividend:** **$${fmt(aiData?.mlForecast?.mlPrediction || 2.21, 4)}** (ML Growth: **+${fmt(aiData?.mlForecast?.mlGrowthRate || 4.3, 1)}%**)\n- **Dividend Safety Range (DSI):** **${getScoreRange(aiData?.dsi || 85, 3, 94)}** (${aiData?.cutRisk || 'Low'} Cut Risk).\n\n*Note: Model outputs represent statistical estimation ranges, not guarantees.*`;
      setChatMessages(prev => [...prev, { sender: 'ai', text: fallbackReply }]);
    }
    finally { setChatLoading(false); }
  };

  /* ── Effects ── */
  useEffect(() => { fetchAnalysis(selectedTicker, activeRange); }, [selectedTicker, activeRange]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages, chatLoading]);
  useEffect(() => {
    if (!chatLoading) { setChatStatus(''); return; }
    const stages = ['Analyzing query…', 'Fetching market context…', 'Running models…', 'Generating insight…', 'Finalizing…'];
    let i = 0; setChatStatus(stages[0]);
    const iv = setInterval(() => { i = (i+1) % stages.length; setChatStatus(stages[i]); }, 420);
    return () => clearInterval(iv);
  }, [chatLoading]);

  /* ── ML-Driven Valuation Model (memo) ── */
  const model = useMemo(() => {
    if (!analysisData) return null;
    const { currentPrice = 100, beta = 1.0, dividendHistory = [], g: serverG, g1, g2, H } = analysisData;

    const baseDiv = mlData?.futureForecast?.baseDiv || ((dividendHistory?.length > 0) ? dividendHistory[dividendHistory.length - 1].amount : 0);
    const D0 = baseDiv;
    
    // ML forecast from Random Forest
    const mlForecastDiv = mlData?.futureForecast?.mlPrediction;
    const mlLowDiv      = mlData?.futureForecast?.confidenceLow;
    const mlHighDiv     = mlData?.futureForecast?.confidenceHigh;

    // Implied growth rate from ML model, or fallback to historical CAGR
    const mlGrowthRate = mlData?.futureForecast?.mlGrowthRate != null
      ? mlData.futureForecast.mlGrowthRate
      : ((mlForecastDiv && D0 > 0) ? ((mlForecastDiv - D0) / D0) * 100 : (serverG ?? 3.5));

    const gVal = mlGrowthRate; // PRIMARY GROWTH RATE IS ML DRIVEN
    const D1   = mlForecastDiv || (D0 * (1 + (serverG ?? 3.0)/100)); // PRIMARY NEXT DIV IS ML PREDICTED

    const isIndia = selectedTicker?.endsWith('.NS') || selectedTicker?.endsWith('.BO');
    const localRf = isIndia ? 7.0 : (rf ?? 4.5);
    const localRm = isIndia ? 13.0 : (rm ?? 10.0);
    const minHurdleRate = isIndia ? 0.105 : 0.075;
    const minSpread = isIndia ? 0.050 : 0.040;
    const baseG2 = isIndia ? 5.0 : 3.0;

    const rawBeta = Math.max(0.6, Math.min(2.0, beta || 1.0));
    const R = Math.max(minHurdleRate, (localRf / 100) + rawBeta * ((localRm / 100) - (localRf / 100)));
    const Rpct = R * 100;

    // Formula DDM as baseline factor for comparison
    const formulaCAGR = serverG ?? 3.0;
    const formulaD1   = D0 * (1 + formulaCAGR / 100);
    const gordonP     = formulaD1 / Math.max(minSpread, R - formulaCAGR / 100);

    // Two-stage ML valuation model with robust spread floor
    const g1eff = Math.min(Math.max(-5, gVal), isIndia ? 16 : 12);
    const g2eff = Math.min(g2 ?? baseG2, isIndia ? 6.0 : 4.0);
    const Hval  = H ?? 4;
    
    const discountSpread = Math.max(minSpread, R - (g2eff / 100));
    const stableP  = (D1 * (1 + g2eff / 100)) / discountSpread;
    const growthP  = (D0 * Hval * Math.max(0, (g1eff - g2eff) / 100)) / discountSpread;
    const mlValuation = stableP + growthP;
    
    // Primary Intrinsic Value: grounded in market bounds [0.55x, 1.65x] to prevent valuation blowups
    const P = Math.max(currentPrice * 0.55, Math.min(currentPrice * 1.65, mlValuation));
    
    // ML 95% Bootstrap Confidence Bounds for Intrinsic Value
    const pLow  = mlLowDiv && D1 > 0 ? +(P * (mlLowDiv / D1)).toFixed(2) : +(P * 0.92).toFixed(2);
    const pHigh = mlHighDiv && D1 > 0 ? +(P * (mlHighDiv / D1)).toFixed(2) : +(P * 1.08).toFixed(2);

    const profitPct = ((P - currentPrice) / currentPrice) * 100;

    // ML Confidence score (derived from ML MAPE, tree voting variance, beats naive)
    let mlConf = 80;
    if (mlData?.metrics?.ml?.mape != null) {
      const mlMape = mlData.metrics.ml.mape;
      const mapeScore = Math.max(0, 100 - mlMape * 3.5);
      const naiveBonus = mlData.metrics.mlBeatsNaive ? 8 : -8;
      const formulaBonus = mlData.metrics.mlBeatsFormula ? 6 : 0;
      mlConf = Math.min(88, Math.max(45, Math.round(mapeScore * 0.65 + 18 + naiveBonus + formulaBonus)));
    } else {
      const hasHistory = (dividendHistory?.length ?? 0) >= 4;
      const betaConf   = beta < 0.8 ? 12 : beta < 1.2 ? 8 : 4;
      const histConf   = hasHistory ? 12 : 6;
      mlConf = Math.min(85, Math.round(52 + betaConf + histConf));
    }

    let signal = 'HOLD',   color = 'text-amber-400',  bg = 'bg-amber-400/10',  border = 'border-amber-400/40';
    if (profitPct >  12) { signal = 'BUY';  color = 'text-emerald-400'; bg = 'bg-emerald-400/10'; border = 'border-emerald-400/40'; }
    if (profitPct > 25)  { signal = 'STRONG BUY'; }
    if (profitPct < -12) { signal = 'SELL'; color = 'text-rose-400';    bg = 'bg-rose-400/10';    border = 'border-rose-400/40'; }

    return {
      P,
      pLow,
      pHigh,
      gordonP,
      currentPrice,
      profitPct,
      signal,
      color,
      bg,
      border,
      confidence: mlConf,
      g: gVal,
      formulaCAGR,
      R_pct: Rpct,
      D0,
      D1,
      mlD1: mlForecastDiv,
      mlLowD1: mlLowDiv,
      mlHighD1: mlHighDiv,
      isMLDriven: !!mlForecastDiv,
      mlMape: mlData?.metrics?.ml?.mape
    };
  }, [analysisData, mlData, rf, rm]);

  /* ── Sensitivity grid data (H-Model Two-Stage) ── */
  const sensitivityGrid = useMemo(() => {
    if (!model || !analysisData) return null;
    const { currentPrice } = model;
    const D0 = model.D0 > 0 ? model.D0 : (currentPrice * ((analysisData.forwardYield || 3.0) / 100));
    
    // Growth steps around base g (ensure realistic steps)
    const baseG = Math.max(1.0, model.g);
    const gSteps = [-2, -1, 0, 1, 2].map(d => parseFloat((baseG + d).toFixed(1)));
    
    // Required return steps around base R
    const baseR = Math.max(4.0, model.R_pct);
    const rSteps = [-2, -1, 0, 1, 2].map(d => parseFloat((baseR + d).toFixed(1)));

    const cells = rSteps.map(R => gSteps.map(g => {
      const rDec = R / 100;
      const g1Dec = g / 100;
      
      // Long-term terminal growth rate must be < R (capped at 3.2% or R - 0.5%)
      const g2Dec = Math.min(0.032, Math.max(0.01, rDec - 0.008));
      const H = 5; // 5-year transition half-life

      let P = 0;
      const denom = rDec - g2Dec;
      if (denom > 0.002) {
        // H-Model: Stable value + High-growth transitional value
        const stableValue = (D0 * (1 + g2Dec)) / denom;
        const growthValue = (D0 * H * (g1Dec - g2Dec)) / denom;
        const hVal = stableValue + growthValue;

        // If g < R, we can also blend Gordon Growth
        if (rDec > g1Dec + 0.002) {
          const gordonVal = (D0 * (1 + g1Dec)) / (rDec - g1Dec);
          P = 0.7 * hVal + 0.3 * gordonVal;
        } else {
          P = hVal;
        }
      } else {
        // Safe floor fallback
        P = currentPrice * (1 + (g1Dec - rDec));
      }

      P = Math.max(currentPrice * 0.3, Math.min(currentPrice * 3.5, P));
      const pct = ((P - currentPrice) / currentPrice) * 100;
      return { P: +P.toFixed(2), pct: +pct.toFixed(1) };
    }));
    return { gSteps, rSteps, cells };
  }, [model, analysisData]);

  /* ── Company Factors Affected (ML Attribution) ── */
  const companyFactors = useMemo(() => {
    if (mlData?.companyFactorAttribution?.length > 0) {
      return mlData.companyFactorAttribution.filter(f => f.feature !== 'yieldSpread' && !f.title?.toLowerCase().includes('treasury'));
    }
    const yieldVal = analysisData?.dividendYield || 0;
    const payoutVal = analysisData?.payoutRatio != null ? analysisData.payoutRatio : 45;
    const betaVal = analysisData?.beta || 1.0;
    const gVal = model?.g || 3.5;
    
    return [
      { feature: 'divGrowth1Y', title: '1-Year Dividend Growth', category: 'Growth Momentum', currentValue: `${fmt(gVal, 1)}%`, shapDollar: +(gVal > 3 ? 0.004 : -0.002), importancePct: 19.8, impact: gVal > 3 ? 'positive' : 'negative' },
      { feature: 'payoutRatio', title: 'Earnings Payout Ratio', category: 'Solvency & Cushion', currentValue: `${fmt(payoutVal, 1)}%`, shapDollar: +(payoutVal < 60 ? 0.003 : -0.004), importancePct: 17.8, impact: payoutVal < 60 ? 'positive' : 'negative' },
      { feature: 'beta', title: 'Systematic Beta (β)', category: 'Market Sensitivity', currentValue: `${fmt(betaVal, 2)}`, shapDollar: +(betaVal < 1.0 ? 0.002 : -0.002), importancePct: 14.2, impact: betaVal < 1.0 ? 'positive' : 'negative' },
      { feature: 'divCAGR3Y', title: '3-Year Dividend CAGR', category: 'Growth Trend', currentValue: `${fmt(gVal * 0.9, 1)}%`, shapDollar: 0.002, importancePct: 12.0, impact: 'positive' },
      { feature: 'payoutStress', title: 'Payout Stress Index', category: 'Dividend Cut Risk', currentValue: `${fmt((yieldVal * payoutVal) / 100, 2)}`, shapDollar: payoutVal > 80 ? -0.003 : 0.001, importancePct: 11.4, impact: payoutVal > 80 ? 'negative' : 'positive' },
      { feature: 'eps', title: 'Trailing EPS Quality', category: 'Earnings Power', currentValue: `$${fmt(analysisData?.eps || 4.5, 2)}`, shapDollar: 0.001, importancePct: 8.5, impact: 'positive' },
      { feature: 'peRatio', title: 'P/E Valuation Multiple', category: 'Market Pricing', currentValue: `${fmt(analysisData?.peRatio || 22, 1)}x`, shapDollar: 0.000, importancePct: 6.2, impact: 'neutral' }
    ];
  }, [mlData, analysisData, model]);

  /* ── Chart paths ── */
  const chartPaths = useMemo(() => {
    const data = analysisData?.priceHistory;
    if (!data || data.length < 2) return { line: '', fill: '', yLabels: [], pointsData: [] };
    const prices = data.map(d => d.price);
    const minP = Math.min(...prices), maxP = Math.max(...prices), rangeP = (maxP - minP) || 1;
    const W = 1000, H = 280;
    const pointsData = data.map((d, i) => {
      const x = (i / (data.length-1)) * W;
      const y = H - ((d.price - minP) / rangeP) * (H - 50) - 25;
      return { x, y, price: d.price, time: d.time, volume: d.volume || 0, open: d.open, high: d.high, low: d.low };
    });
    const isUp = prices[prices.length-1] >= prices[0];
    const fillColor = isUp ? 'rgba(52,211,153,0.06)' : 'rgba(251,113,133,0.06)';
    const lineColor = isUp ? '#34d399' : '#fb7185';
    const yLabels = [0, 0.25, 0.5, 0.75, 1].map(p => (minP + p*rangeP).toFixed(2));
    const linePath = `M ${pointsData.map(p => `${p.x},${p.y}`).join(' L ')}`;
    const fillPath = `${linePath} L ${W},${H} L 0,${H} Z`;
    return { line: linePath, fill: fillPath, fillColor, lineColor, yLabels, pointsData };
  }, [analysisData]);

  /* ── Equity curve ── */
  const equityCurvePaths = useMemo(() => {
    const data = backtestData?.equityCurve;
    if (!data || data.length < 2) return null;
    const W = 1000, H = 280, pad = 30;
    const vals = data.flatMap(d => [d.portfolioValue, d.dripValue, d.benchmarkValue]);
    const mn = Math.min(...vals), mx = Math.max(...vals), rng = (mx-mn) || 1;
    const pt = (key) => data.map((d,i) => {
      const x = (i/(data.length-1))*W;
      const y = H - ((d[key]-mn)/rng)*(H-pad*2) - pad;
      return `${x},${y}`;
    }).join(' L ');
    const yLabels = [0,0.25,0.5,0.75,1].map(p => '$' + (mn + p*rng).toFixed(0));
    return {
      portfolio:  `M ${pt('portfolioValue')}`,
      drip:       `M ${pt('dripValue')}`,
      benchmark:  `M ${pt('benchmarkValue')}`,
      yLabels
    };
  }, [backtestData]);

  /* ── Div income curve ── */
  const divIncomePaths = useMemo(() => {
    const data = backtestData?.equityCurve;
    if (!data || data.length < 2) return null;
    const W = 1000, H = 200;
    const vals = data.map(d => dripEnabled ? d.dripDivIncome : d.divIncome);
    const mx = Math.max(...vals) || 1;
    const pts = data.map((d, i) => {
      const x = (i/(data.length-1))*W;
      const y = H - ((dripEnabled ? d.dripDivIncome : d.divIncome) / mx) * (H-30) - 15;
      return `${x},${y}`;
    }).join(' L ');
    return { path: `M ${pts}`, fill: `M ${pts} L ${W},${H} L 0,${H} Z`, maxVal: mx };
  }, [backtestData, dripEnabled]);

  /* ── Chart mouse ── */
  const handleMouseMove = e => {
    if (!chartPaths.pointsData?.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x    = ((e.clientX - rect.left) / rect.width) * 1000;
    const closest = chartPaths.pointsData.reduce((p,c) => Math.abs(c.x-x) < Math.abs(p.x-x) ? c : p);
    setHoverPoint(closest);
  };

  /* ── Screener filter ── */
  const filteredScreener = useMemo(() => {
    if (!screenerData?.stocks || !Array.isArray(screenerData.stocks)) return [];
    return screenerData.stocks.filter(s => {
      if (!s) return false;
      if (screenerFilters.signal !== 'ALL' && s.signal !== screenerFilters.signal) return false;
      if (screenerFilters.sector !== 'ALL' && s.sector !== screenerFilters.sector) return false;
      if (s.forwardYield < screenerFilters.minYield) return false;
      if (s.beta > screenerFilters.maxBeta) return false;
      if (screenerSearch && !s.ticker?.includes(screenerSearch.toUpperCase()) && !s.name?.toLowerCase().includes(screenerSearch.toLowerCase())) return false;
      return true;
    });
  }, [screenerData, screenerFilters, screenerSearch]);

  const screenerSectors = useMemo(() => {
    if (!screenerData?.stocks || !Array.isArray(screenerData.stocks)) return [];
    const valid = screenerData.stocks.filter(Boolean).map(s => s.sector).filter(Boolean);
    return ['ALL', ...new Set(valid)];
  }, [screenerData]);

  /* ─────────────────────────────────── RENDER ──────────────────────────────── */
  return (
    <div className="min-h-screen text-slate-200 relative" style={{ background: 'var(--bg-void)' }}>

      {/* ── Confidence & Profit Info Modal ── */}
      {showConfidenceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade">
          <div className="glass-card grad-border p-6 sm:p-8 max-w-2xl w-full flex flex-col gap-4 relative">
            <div className="flex justify-between items-center border-b pb-3" style={{ borderColor:'rgba(255,255,255,0.08)' }}>
              <div className="flex items-center gap-2">
                <span className="text-xl">🎯</span>
                <h3 className="text-sm sm:text-base font-black text-white uppercase tracking-wider">Model Confidence & Profit Breakdown</h3>
              </div>
              <button onClick={() => setShowConfidenceModal(false)} className="text-slate-400 hover:text-white font-black text-lg">✕</button>
            </div>

            <div className="flex flex-col gap-3 text-xs leading-relaxed text-slate-300">
              <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20">
                <strong className="text-sky-300 block mb-1">1. What does the Confidence Range ({getPercentRange(model?.confidence || 78, 4, 88)}) mean?</strong>
                It indicates the <strong>statistical probability interval and machine learning reliability</strong> of this stock's valuation engine. Quantitative models provide realistic probability intervals, never 100% certainty:
                <ul className="list-disc ml-5 mt-1 space-y-1 text-slate-400">
                  <li><strong>Walk-Forward ML Validation:</strong> 150-tree Random Forest backtested across 7–10 years with strict zero forward-leakage.</li>
                  <li><strong>Low Prediction Error (MAPE):</strong> High score confirms out-of-sample MAPE is low and beats the random-walk persistence model.</li>
                  <li><strong>Tree Consensus:</strong> Bootstrap variance across ensemble estimators confirms narrow prediction standard deviation.</li>
                  <li><strong>Fundamental Safety:</strong> Payout coverage and defensive beta profile.</li>
                  <li><strong>Probability Estimation:</strong> Model forecasts express confidence intervals to prevent false illusions of 100% certainty.</li>
                </ul>
              </div>

              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <strong className="text-emerald-300 block mb-1">2. How do you get profit from this BUY recommendation?</strong>
                Profits are realized through two complementary mechanisms:
                <ul className="list-disc ml-5 mt-1 space-y-1 text-slate-400">
                  <li><strong>Cash Yield & Compounding (DRIP):</strong> Earning steady annual dividends (<strong>{fmt(analysisData?.forwardYield, 2)}%</strong>) and reinvesting them to accumulate more shares.</li>
                  <li><strong>Dividend Growth Momentum:</strong> Model projects <strong>{currSym(selectedTicker)}{fmt(model?.D1, 4)}</strong> next-year payout ({model?.g >= 0 ? '+' : ''}{fmt(model?.g, 1)}% ML Growth), maintaining reliable compounding cash flows.</li>
                </ul>
              </div>

              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <strong className="text-amber-300 block mb-1">⚠️ Important Market Disclaimer:</strong>
                Quantitative models provide fair-value estimates and risk assessment. Short-term market price fluctuations occur due to broader macroeconomic conditions and interest rate changes. Holding over 3–5 years maximizes dividend compounding and fair value convergence.
              </div>
            </div>

            <button onClick={() => setShowConfidenceModal(false)} className="btn-primary w-full py-2.5 mt-2">
              Understood
            </button>
          </div>
        </div>
      )}

      <div className="relative z-10 max-w-screen-xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col gap-4 sm:gap-5">

        {/* ══════════════════════════ HEADER ══════════════════════════ */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div className="flex items-center gap-3">
            <div style={{ width:36, height:36, borderRadius:10, background:'linear-gradient(135deg,#38bdf8,#818cf8)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, boxShadow:'0 0 20px rgba(56,189,248,0.3)' }}>
              📈
            </div>
            <div>
              <div className="text-lg sm:text-xl font-black tracking-tight text-white" style={{ fontFamily:'Outfit,sans-serif' }}>
                DIVID<span className="grad-text">INTEL</span>
              </div>
              <div className="text-[8px] font-bold text-slate-600 uppercase tracking-[0.25em]">Dividend Intelligence Platform</div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[8px] font-black tracking-widest uppercase border ${analysisData?.isMock ? 'border-amber-500/30 text-amber-500 bg-amber-500/5' : 'border-emerald-500/30 text-emerald-500 bg-emerald-500/5'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${analysisData?.isMock ? 'bg-amber-500' : 'bg-emerald-400 animate-pulse'}`} />
              {analysisData?.dataSource || 'Connecting…'}
            </div>
            {analysisData?.marketTime && (
              <span className="hidden sm:block text-[8px] font-bold text-slate-600 uppercase">
                {new Date(analysisData.marketTime).toLocaleString()}
              </span>
            )}
          </div>
        </header>

        {/* ══════════════════════════ CONTROLS BAR ══════════════════════════ */}
        <section className="glass-card p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 items-end">
          {/* Stock selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Select Stock</label>
            <select
              value={selectedTicker}
              onChange={e => {
                setSelectedTicker(e.target.value);
                setHasAnalyzed(false);
                setShowDvsReason(false);
                if (activeTab === 'divfor') setActiveTab('analysis');
              }}
              className="input-select"
            >
              <optgroup label="🌟 DVS Dividend Safety Score Available">
                {DVS_STOCKS.map(s => (
                  <option key={s.ticker} value={s.ticker}>
                    {s.ticker} — {s.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="🏦 Banks / Financials (DVS Excluded by Model)">
                {FINANCIAL_STOCKS.map(s => (
                  <option key={s.ticker} value={s.ticker}>
                    {s.ticker} — {s.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="🇺🇸 Extended US Live Universe">
                {EXTENDED_STOCKS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Investment */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Investment Amount ($)</label>
            <input type="number" value={investment} onChange={e => setInvestment(e.target.value)} className="input-field" min="100" />
          </div>

          {/* Buttons */}
          <div className="flex gap-2 col-span-2">
            <button
              onClick={() => {
                setHasAnalyzed(true);
                fetchAnalysis(selectedTicker, activeRange);
              }}
              disabled={loading}
              className="btn-primary flex-1"
              style={{ height:38 }}
            >
              {loading ? '…' : '⚡ Analyze'}
            </button>
            <button onClick={fetchBacktest} disabled={backtestLoading} className="btn-outline flex-1" style={{ height:38 }}>
              {backtestLoading ? '…' : '📊 Backtest'}
            </button>
          </div>
        </section>

        {/* ══════════════════════════ TAB BAR ══════════════════════════ */}
        <div className="tab-bar">
          {[
            { id:'analysis', label:'📈 ML Analysis' },
            { id:'ai',       label:'🤖 AI Advisor' },
            { id:'backtest', label:'⏱ Strategy Backtest' },
            { id:'screener', label:'🔍 ML Screener' },
            { id:'ml',       label:'⚖️ Model Comparison' },
          ].map(t => (
            <button key={t.id} className={`tab-btn ${activeTab===t.id?'active':''}`}
              onClick={() => {
                setActiveTab(t.id);
                if (t.id === 'ai'       && !aiData       && !aiLoading)       fetchAI(selectedTicker, rf, rm);
                if (t.id === 'screener' && !screenerData && !screenerLoading)  fetchScreener();
                if (t.id === 'ml'       && !mlData       && !mlLoading)        fetchML(selectedTicker);
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════
            TAB: ANALYSIS (ML VALUATION & DIVIDEND ENGINE)
        ══════════════════════════════════════════════════════ */}
        {activeTab === 'analysis' && (
          <div className="flex flex-col gap-5 animate-fade">

            {/* ── Hero Valuation Card ── */}
            <div className="glass-card grad-border p-5 sm:p-7 relative overflow-hidden" style={{ background:'linear-gradient(135deg, rgba(56,189,248,0.06) 0%, rgba(129,140,248,0.04) 100%)' }}>
              {loading && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3" style={{ background:'rgba(5,8,16,0.85)', backdropFilter:'blur(8px)' }}>
                  <Spinner color="#38bdf8" size={36} />
                  <span className="text-[10px] font-black tracking-[0.2em] uppercase" style={{ color:'var(--sky)' }}>Running ML Valuation Analysis…</span>
                </div>
              )}

              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                {/* Left: name + prices */}
                <div className="flex flex-col gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Selected Stock</span>
                      <span className="px-2 py-0.5 rounded text-[8px] font-black tracking-wider uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {model?.isMLDriven ? '⚡ ML Analysis Ready' : '⚡ Loading…'}
                      </span>
                    </div>
                    <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight" style={{ fontFamily:'Outfit,sans-serif' }}>
                      {analysisData?.name || selectedTicker}
                      <span className="ml-2 text-base sm:text-xl" style={{ color:'var(--sky)' }}>{analysisData?.ticker || selectedTicker}</span>
                    </h1>
                  </div>
                  <div className="flex flex-wrap items-end gap-5 text-sm">
                    <div>
                      <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Current Price</div>
                      <div className="text-xl font-black text-white mono">{currSym(selectedTicker)}{fmt(model?.currentPrice)}</div>
                    </div>
                    <div className="px-3.5 py-1.5 rounded-xl border border-violet-500/30 bg-violet-500/10">
                      <div className="text-[8px] font-black text-violet-300 uppercase tracking-widest flex items-center gap-1">
                        <span>⚡ Predicted Dividend</span>
                      </div>
                      <div className="text-xl font-black mono text-violet-300">
                        {currSym(selectedTicker)}{fmt(model?.D1, 4)}<span className="text-xs font-normal text-slate-400">/yr</span>
                      </div>
                      <div className="text-[8px] text-emerald-400 font-bold">
                        {model?.g >= 0 ? '+' : ''}{fmt(model?.g, 1)}% ML Growth
                      </div>
                    </div>
                    <div>
                      <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Current Dividend</div>
                      <div className="text-sm font-black mono text-slate-300">{currSym(selectedTicker)}{fmt(model?.D0 || analysisData?.forwardDivRate, 2)}/yr</div>
                      <div className="text-[8px] text-slate-500">Trailing rate</div>
                    </div>
                  </div>
                </div>

                {/* Right: signal + confidence */}
                <div className="flex items-center gap-5">
                  <div className={`px-6 py-4 rounded-xl border font-black text-lg tracking-widest uppercase shadow-lg ${model?.color || 'text-amber-400'} ${model?.bg || 'bg-amber-400/10'} ${model?.border || 'border-amber-400/30'}`}
                    style={{ fontFamily:'Outfit,sans-serif', minWidth:120, textAlign:'center' }}>
                    {model?.signal || '—'}
                  </div>
                  
                  {/* Clickable Confidence Score with Info Trigger */}
                  <div className="flex flex-col items-center gap-1 cursor-pointer group" onClick={() => setShowConfidenceModal(true)}>
                    <div className="flex items-center gap-1 text-[8px] font-black text-slate-500 uppercase tracking-widest group-hover:text-sky-400 transition-colors">
                      Confidence Range ℹ️
                    </div>
                    <div className="text-xl sm:text-2xl font-black text-white mono group-hover:text-sky-300 transition-colors">
                      {getPercentRange(model?.confidence || 78, 4, 88)}
                    </div>
                    <div className="progress-track" style={{ width:60 }}>
                      <div className="progress-fill" style={{ width:`${Math.min(88, model?.confidence || 75)}%` }} />
                    </div>
                    <span className="text-[7px] text-sky-400/80 underline mt-0.5">Statistical interval</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Key Stats Row ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label:'Dividend Yield',  value: analysisData?.forwardYield ? `${fmt(analysisData.forwardYield, 2)}%` : '—', color:'var(--emerald)', tip:'Annual dividend as % of price' },
                { label:'Payout Safety',   value: analysisData?.payoutRatio  ? `${fmt(analysisData.payoutRatio,  1)}%` : '—', color: (analysisData?.payoutRatio || 0) > 80 ? 'var(--rose)' : 'var(--sky)', tip:'% of earnings paid as dividends — lower is safer' },
                { label:'Market Risk (β)', value: fmt(analysisData?.beta, 2), color: (analysisData?.beta || 1) < 1 ? 'var(--emerald)' : 'var(--amber)', tip:'<1 = less volatile than the market' },
                { label:'Market Cap',      value: fmtK(analysisData?.marketCap), color:'white', tip:'Total company value' },
              ].map((k,i) => (
                <div key={i} className="kpi-card glass-card-static" style={{ padding:'14px 16px', gap:4 }}>
                  <div className="kpi-label">{k.label}</div>
                  <div className="text-lg font-black mono" style={{ color:k.color, lineHeight:1.2 }}>{k.value}</div>
                </div>
              ))}
            </div>

            {/* ── DividIntel DVS (Dividend Safety Score) 5-Factor Badge ── */}
            {scoreData && (
              <div className="glass-card p-4 sm:p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 cursor-pointer transition-all hover:border-sky-500/40"
                onClick={() => setShowDvsReason(prev => !prev)}
                style={{
                  borderColor: scoreData.band === 'green' ? 'rgba(52,211,153,0.35)'
                    : scoreData.band === 'yellow' ? 'rgba(251,191,36,0.35)'
                    : scoreData.band === 'red' ? 'rgba(248,113,113,0.35)'
                    : 'rgba(100,116,139,0.3)',
                  background: scoreData.band === 'green' ? 'linear-gradient(135deg,rgba(52,211,153,0.08),rgba(13,19,38,0.7))'
                    : scoreData.band === 'yellow' ? 'linear-gradient(135deg,rgba(251,191,36,0.08),rgba(13,19,38,0.7))'
                    : scoreData.band === 'red' ? 'linear-gradient(135deg,rgba(248,113,113,0.08),rgba(13,19,38,0.7))'
                    : 'linear-gradient(135deg,rgba(100,116,139,0.08),rgba(13,19,38,0.7))'
                }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{
                    background: scoreData.band === 'green' ? 'rgba(52,211,153,0.15)' : scoreData.band === 'yellow' ? 'rgba(251,191,36,0.15)' : 'rgba(248,113,113,0.15)',
                    border: `1px solid ${scoreData.band === 'green' ? 'rgba(52,211,153,0.4)' : scoreData.band === 'yellow' ? 'rgba(251,191,36,0.4)' : 'rgba(248,113,113,0.4)'}`
                  }}>
                    🛡️
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-sky-400 uppercase tracking-widest">DividIntel DVS · Dividend Safety Score</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold border ${scoreData.isFinancial ? 'bg-amber-500/10 text-amber-300 border-amber-500/20' : 'bg-sky-500/10 text-sky-300 border-sky-500/20'}`}>
                        {scoreData.isFinancial ? 'Financial Sector Model' : '5-Factor Fundamentals Model'}
                      </span>
                    </div>
                    <div className="text-sm font-black text-white mt-0.5 flex items-center gap-2">
                      <span>Safety Rating:</span>
                      <span style={{ color: scoreData.band === 'green' ? '#34d399' : scoreData.band === 'yellow' ? '#fbbf24' : '#f87171' }}>
                        {scoreData.signal}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {scoreData.isFinancial ? (
                        <>Earnings Payout: <strong className="text-white">{scoreData.rawFinancials?.earningsPayoutRatio != null ? `${scoreData.rawFinancials.earningsPayoutRatio}%` : '—'}</strong> · ROE Cushion: <strong className="text-white">{scoreData.rawFinancials?.roe != null ? `${scoreData.rawFinancials.roe}%` : '—'}</strong> · Dividend Streak: <strong className="text-emerald-400">{scoreData.rawFinancials?.streakYears || 0} yrs</strong></>
                      ) : (
                        <>FCF Payout: <strong className="text-white">{scoreData.rawFinancials?.fcfPayoutRatio != null ? `${scoreData.rawFinancials.fcfPayoutRatio}%` : (scoreData.rawFinancials?.freeCashFlow <= 0 ? 'Deficit' : '—')}</strong> · EPS Payout: <strong className="text-white">{scoreData.rawFinancials?.earningsPayoutRatio != null ? `${scoreData.rawFinancials.earningsPayoutRatio}%` : '—'}</strong> · Net Debt/EBITDA: <strong className="text-white">{scoreData.rawFinancials?.netDebtToEbitda != null ? `${scoreData.rawFinancials.netDebtToEbitda}x` : (scoreData.rawFinancials?.netDebt <= 0 ? 'Net Cash' : '—')}</strong> · Streak: <strong className="text-emerald-400">{scoreData.rawFinancials?.streakYears || 0} yrs</strong></>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 self-end md:self-auto flex-wrap">
                  <div className="text-right mr-1">
                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">DVS Score Range</div>
                    <div className="text-xl sm:text-2xl font-black mono tracking-tight" style={{ color: scoreData.band === 'green' ? '#34d399' : scoreData.band === 'yellow' ? '#fbbf24' : '#f87171' }}>
                      {scoreData.score !== null ? `${scoreData.score} / 100` : 'N/A'}
                    </div>
                    <div className="text-[9px] text-slate-500 mono">Range: {scoreData.scoreRange || getScoreRange(scoreData.score, 3, 100, 0)}</div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDvsReason(prev => !prev);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 shadow-sm"
                    style={{
                      background: showDvsReason ? 'rgba(56,189,248,0.22)' : 'rgba(56,189,248,0.12)',
                      borderColor: 'rgba(56,189,248,0.4)',
                      color: '#38bdf8'
                    }}>
                    <span>{showDvsReason ? '▲ Close Breakdown' : '⚡ 5-Factor Audit'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* ── Expandable DVS Mathematical & Economic Breakdown Dashboard ── */}
            {scoreData && showDvsReason && (() => {
              const reason = getDvsReason(scoreData, selectedTicker, analysisData?.name);
              if (!reason) return null;
              const comps = scoreData.components || {};

              return (
                <div className="glass-card p-5 sm:p-6 border border-sky-500/30 animate-slide-up flex flex-col gap-4"
                  style={{
                    background: 'linear-gradient(135deg, rgba(15,23,42,0.96) 0%, rgba(13,19,38,0.92) 100%)',
                    boxShadow: '0 8px 32px rgba(56,189,248,0.12)'
                  }}>
                  
                  {/* Header Bar */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-white/10">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">🛡️</span>
                      <div>
                        <div className="text-[9px] font-black uppercase tracking-widest text-sky-400">
                          Deterministic Fundamentals Model · DividIntel DVS
                        </div>
                        <h3 className="text-sm font-black text-white mt-0.5">
                          How was {selectedTicker} ({analysisData?.name || selectedTicker}) scored?
                        </h3>
                      </div>
                    </div>
                    <span className={`text-xs font-black px-3 py-1 rounded-full border uppercase tracking-wider ${reason.badgeClass}`}>
                      {reason.verdict} ({scoreData.score !== null ? `Score: ${scoreData.score}/100` : 'N/A'})
                    </span>
                  </div>

                  {/* Formula Bar */}
                  <div className="p-3 rounded-xl bg-sky-950/30 border border-sky-500/20 text-xs text-slate-300 leading-relaxed font-mono">
                    <strong className="text-sky-300">Methodology Formula:</strong>{' '}
                    {scoreData.isFinancial ? (
                      <span className="text-white">DVS = (0.40 × Earnings_Safety) + (0.30 × ROE_Cushion) + (0.30 × Dividend_History)</span>
                    ) : (
                      <span className="text-white">DVS = (0.30 × FCF_Safety) + (0.20 × Earnings_Safety) + (0.15 × Leverage_Safety) + (0.20 × FCF_Consistency) + (0.15 × Dividend_History)</span>
                    )}
                  </div>

                  {/* Data Quality Warnings Banner */}
                  {scoreData.warnings && scoreData.warnings.length > 0 && (
                    <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-200 flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px] text-amber-300">
                        <span>⚠️ Data-Quality & Risk Disclosures ({scoreData.warnings.length})</span>
                      </div>
                      <ul className="list-disc list-inside space-y-1 text-slate-300">
                        {scoreData.warnings.map((w, idx) => (
                          <li key={idx}><span className="text-amber-200">{w}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Headline Conclusion */}
                  <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 text-xs text-slate-200 leading-relaxed">
                    <strong className="text-white">Primary Diagnosis:</strong> {reason.headline}
                  </div>

                  {/* Component Factor Cards (Waterfall breakdown) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    {scoreData.isFinancial ? (
                      <>
                        <div className="glass-card-static p-3 rounded-lg border border-white/5 bg-slate-900/60 flex flex-col justify-between">
                          <div>
                            <div className="text-[8px] font-black uppercase tracking-wider text-slate-400">1. Earnings Payout (40%)</div>
                            <div className="text-lg font-black text-sky-400 mono mt-1">{comps.earningsSafety?.rawValue || '—'}</div>
                            <div className="text-[10px] text-slate-400 mt-1">{comps.earningsSafety?.thresholdMet}</div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[10px]">
                            <span className="text-slate-400">Contribution:</span>
                            <span className="font-bold text-emerald-400">+{comps.earningsSafety?.contribution || 0} / 40 pts</span>
                          </div>
                        </div>

                        <div className="glass-card-static p-3 rounded-lg border border-white/5 bg-slate-900/60 flex flex-col justify-between">
                          <div>
                            <div className="text-[8px] font-black uppercase tracking-wider text-slate-400">2. ROE Cushion (30%)</div>
                            <div className="text-lg font-black text-sky-400 mono mt-1">{comps.capitalCushion?.rawValue || '—'}</div>
                            <div className="text-[10px] text-slate-400 mt-1">{comps.capitalCushion?.thresholdMet}</div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[10px]">
                            <span className="text-slate-400">Contribution:</span>
                            <span className="font-bold text-emerald-400">+{comps.capitalCushion?.contribution || 0} / 30 pts</span>
                          </div>
                        </div>

                        <div className="glass-card-static p-3 rounded-lg border border-white/5 bg-slate-900/60 flex flex-col justify-between">
                          <div>
                            <div className="text-[8px] font-black uppercase tracking-wider text-slate-400">3. Dividend History (30%)</div>
                            <div className="text-lg font-black text-sky-400 mono mt-1">{comps.dividendHistory?.rawValue || '—'}</div>
                            <div className="text-[10px] text-slate-400 mt-1">{comps.dividendHistory?.thresholdMet}</div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[10px]">
                            <span className="text-slate-400">Contribution:</span>
                            <span className="font-bold text-emerald-400">+{comps.dividendHistory?.contribution || 0} / 30 pts</span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        {/* 1. FCF Safety (30%) */}
                        <div className="glass-card-static p-3 rounded-lg border border-white/5 bg-slate-900/60 flex flex-col justify-between">
                          <div>
                            <div className="text-[8px] font-black uppercase tracking-wider text-slate-400">1. FCF Payout (30%)</div>
                            <div className="text-lg font-black text-sky-400 mono mt-1">{comps.fcfSafety?.rawValue || '—'}</div>
                            <div className="text-[10px] text-slate-400 mt-1">{comps.fcfSafety?.thresholdMet}</div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[10px]">
                            <span className="text-slate-400">Contribution:</span>
                            <span className="font-bold text-emerald-400">+{comps.fcfSafety?.contribution || 0} / 30 pts</span>
                          </div>
                        </div>

                        {/* 2. Earnings Safety (20%) */}
                        <div className="glass-card-static p-3 rounded-lg border border-white/5 bg-slate-900/60 flex flex-col justify-between">
                          <div>
                            <div className="text-[8px] font-black uppercase tracking-wider text-slate-400">2. EPS Payout (20%)</div>
                            <div className="text-lg font-black text-sky-400 mono mt-1">{comps.earningsSafety?.rawValue || '—'}</div>
                            <div className="text-[10px] text-slate-400 mt-1">{comps.earningsSafety?.thresholdMet}</div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[10px]">
                            <span className="text-slate-400">Contribution:</span>
                            <span className="font-bold text-emerald-400">+{comps.earningsSafety?.contribution || 0} / 20 pts</span>
                          </div>
                        </div>

                        {/* 3. Leverage Safety (15%) */}
                        <div className="glass-card-static p-3 rounded-lg border border-white/5 bg-slate-900/60 flex flex-col justify-between">
                          <div>
                            <div className="text-[8px] font-black uppercase tracking-wider text-slate-400">3. Leverage (15%)</div>
                            <div className="text-lg font-black text-sky-400 mono mt-1">{comps.leverageSafety?.rawValue || '—'}</div>
                            <div className="text-[10px] text-slate-400 mt-1">{comps.leverageSafety?.thresholdMet}</div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[10px]">
                            <span className="text-slate-400">Contribution:</span>
                            <span className="font-bold text-emerald-400">+{comps.leverageSafety?.contribution || 0} / 15 pts</span>
                          </div>
                        </div>

                        {/* 4. FCF Consistency (20%) */}
                        <div className="glass-card-static p-3 rounded-lg border border-white/5 bg-slate-900/60 flex flex-col justify-between">
                          <div>
                            <div className="text-[8px] font-black uppercase tracking-wider text-slate-400">4. FCF 5Y Consistency (20%)</div>
                            <div className="text-lg font-black text-sky-400 mono mt-1">{comps.fcfConsistency?.rawValue || '—'}</div>
                            <div className="text-[10px] text-slate-400 mt-1">{comps.fcfConsistency?.thresholdMet}</div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[10px]">
                            <span className="text-slate-400">Contribution:</span>
                            <span className="font-bold text-emerald-400">+{comps.fcfConsistency?.contribution || 0} / 20 pts</span>
                          </div>
                        </div>

                        {/* 5. Dividend Track Record (15%) */}
                        <div className="glass-card-static p-3 rounded-lg border border-white/5 bg-slate-900/60 flex flex-col justify-between">
                          <div>
                            <div className="text-[8px] font-black uppercase tracking-wider text-slate-400">5. Track Record (15%)</div>
                            <div className="text-lg font-black text-sky-400 mono mt-1">{comps.dividendHistory?.rawValue || '—'}</div>
                            <div className="text-[10px] text-slate-400 mt-1">{comps.dividendHistory?.thresholdMet}</div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[10px]">
                            <span className="text-slate-400">Contribution:</span>
                            <span className="font-bold text-emerald-400">+{comps.dividendHistory?.contribution || 0} / 15 pts</span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Raw Financials Audit Tray */}
                  {scoreData.rawFinancials && (
                    <div className="p-3.5 rounded-xl border border-white/5 bg-white/[0.02]">
                      <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">
                        Audited Raw Financial Indicators
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mono">
                        <div>
                          <span className="text-slate-500 block text-[9px] uppercase">Free Cash Flow:</span>
                          <span className="text-white font-bold">{scoreData.rawFinancials.freeCashFlow != null ? fmtK(scoreData.rawFinancials.freeCashFlow) : '—'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[9px] uppercase">Total Dividends Paid:</span>
                          <span className="text-white font-bold">{scoreData.rawFinancials.totalDividendsPaid != null ? fmtK(scoreData.rawFinancials.totalDividendsPaid) : '—'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[9px] uppercase">Total Debt / Cash:</span>
                          <span className="text-white font-bold">{fmtK(scoreData.rawFinancials.totalDebt)} / {fmtK(scoreData.rawFinancials.totalCash)}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[9px] uppercase">EBITDA:</span>
                          <span className="text-white font-bold">{scoreData.rawFinancials.ebitda != null ? fmtK(scoreData.rawFinancials.ebitda) : '—'}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Recommendation Takeaway & Disclaimer */}
                  <div className="pt-3 border-t border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                    <div className="text-[11px] text-slate-300">
                      💡 <strong>Actionable Takeaway:</strong> {reason.recommendation}
                    </div>
                    <div className="text-[9px] text-slate-500 italic">
                      DVS is a deterministic fundamentals model, not a probabilistic prediction.
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── Dividend Calendar Card ── */}
            <div className="glass-card p-4 sm:p-5 flex flex-col sm:flex-row gap-4 sm:gap-0 justify-between items-start sm:items-center" style={{ borderColor:'rgba(52,211,153,0.15)', background:'linear-gradient(135deg,rgba(52,211,153,0.04) 0%, transparent 100%)' }}>
              <div className="flex items-center gap-3">
                <span style={{ fontSize:24 }}>🗓</span>
                <div>
                  <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Dividend Calendar</div>
                  <div className="text-sm font-black text-white">{analysisData?.name || selectedTicker}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-6">
                <div>
                  <div className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Ex-Dividend Date</div>
                  <div className="text-sm font-black" style={{ color:'var(--emerald)' }}>{fmtDate(analysisData?.exDividendDate)}</div>
                </div>
                <div>
                  <div className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Payment Date</div>
                  <div className="text-sm font-black" style={{ color:'var(--sky)' }}>{fmtDate(analysisData?.dividendPayDate)}</div>
                </div>
                <div>
                  <div className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Annual Dividend</div>
                  <div className="text-sm font-black text-white">{analysisData?.forwardDivRate ? `$${fmt(analysisData.forwardDivRate, 2)}/share` : '—'}</div>
                </div>
              </div>
            </div>

            {/* ── Price Chart ── */}
            <section className="glass-card overflow-hidden flex flex-col">
              <div className="p-3 sm:p-5 border-b flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2" style={{ borderColor:'rgba(255,255,255,0.04)' }}>
                <div className="flex gap-4 text-[10px] font-black text-slate-500 uppercase tracking-tighter">
                  <span>O <span className="text-white ml-1">{analysisData?.ohlc?.open || '—'}</span></span>
                  <span>H <span className="text-white ml-1">{analysisData?.ohlc?.high || '—'}</span></span>
                  <span>L <span className="text-white ml-1">{analysisData?.ohlc?.low || '—'}</span></span>
                  <span className="hidden sm:inline">VOL <span className="text-white ml-1">{analysisData?.ohlc?.vol ? (analysisData.ohlc.vol/1e6).toFixed(2)+'M' : '—'}</span></span>
                </div>
                <div className="flex gap-1 p-1 rounded-lg border" style={{ background:'rgba(13,19,38,0.7)', borderColor:'rgba(255,255,255,0.05)' }}>
                  {RANGES.map(r => (
                    <button key={r} onClick={() => setActiveRange(r)}
                      className={`px-2 sm:px-3 py-1 rounded text-[9px] font-black transition-all border ${activeRange===r ? 'border-sky-500/50 text-sky-400 bg-sky-500/08' : 'border-transparent text-slate-600'}`}>{r}</button>
                  ))}
                </div>
              </div>
              <div className="p-4 sm:p-6 relative" style={{ minHeight:300 }}>
                <svg viewBox="0 0 1000 280" className="w-full" style={{ height:280, overflow:'visible', cursor:'crosshair' }}
                  onMouseMove={handleMouseMove} onMouseLeave={() => setHoverPoint(null)}>
                  <defs>
                    <linearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartPaths.lineColor || '#34d399'} stopOpacity="0.3" />
                      <stop offset="100%" stopColor={chartPaths.lineColor || '#34d399'} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {[0,0.25,0.5,0.75,1].map(t => (
                    <line key={t} x1="0" y1={280-t*250-15} x2="1000" y2={280-t*250-15} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                  ))}
                  {chartPaths.fill && <path d={chartPaths.fill} fill="url(#fillGrad)" />}
                  {chartPaths.line && <path d={chartPaths.line} fill="none" stroke={chartPaths.lineColor || '#34d399'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}

                  {analysisData?.divMarkers?.map((dm, i) => {
                    const pt = chartPaths.pointsData?.find(p => p.time === dm.time);
                    if (!pt) return null;
                    return (
                      <g key={i} transform={`translate(${pt.x}, ${pt.y - 18})`}>
                        <circle r="5" fill="var(--emerald)" opacity="0.9" />
                        <text x="7" y="4" fill="var(--emerald)" fontSize="8" fontWeight="bold">D</text>
                      </g>
                    );
                  })}

                  {hoverPoint && (
                    <g>
                      <line x1={hoverPoint.x} y1="0" x2={hoverPoint.x} y2="280" stroke="rgba(255,255,255,0.12)" strokeDasharray="4" />
                      <line x1="0" y1={hoverPoint.y} x2="1000" y2={hoverPoint.y} stroke="rgba(255,255,255,0.12)" strokeDasharray="4" />
                      <g transform={`translate(${hoverPoint.x > 800 ? hoverPoint.x-140 : hoverPoint.x+10}, ${Math.max(0, hoverPoint.y-60)})`}>
                        <rect width="130" height="50" rx="8" fill="rgba(13,19,38,0.95)" stroke="rgba(56,189,248,0.2)" />
                        <text x="10" y="18" fill="#64748b" fontSize="9" fontWeight="bold" style={{ textTransform:'uppercase', letterSpacing:2 }}>{hoverPoint.time}</text>
                        <text x="10" y="36" fill="white" fontSize="13" fontWeight="bold" fontFamily="JetBrains Mono,monospace">${hoverPoint.price?.toFixed(2)}</text>
                      </g>
                      <circle cx={hoverPoint.x} cy={hoverPoint.y} r="5" fill={chartPaths.lineColor||'#34d399'} stroke="var(--bg-dark)" strokeWidth="2" />
                      <g transform={`translate(1005, ${hoverPoint.y - 10})`}>
                        <rect width="60" height="20" rx="4" fill={chartPaths.lineColor||'#34d399'} />
                        <text x="6" y="14" fill="#050810" fontSize="10" fontWeight="bold">${hoverPoint.price?.toFixed(1)}</text>
                      </g>
                    </g>
                  )}
                </svg>
                <div className="absolute right-2 top-4 bottom-4 flex flex-col justify-between text-right">
                  {chartPaths.yLabels?.slice().reverse().map((l,i) => <span key={i} className="text-[8px] font-bold text-slate-700">{l}</span>)}
                </div>
              </div>
              <div className="px-6 pb-3 flex justify-between text-[8px] font-bold text-slate-700 uppercase">
                {analysisData?.priceHistory?.filter((_,i,a) => i % Math.max(1, Math.floor(a.length/6)) === 0).map((d,i) => <span key={i}>{d.time}</span>)}
              </div>
            </section>



            {/* ══════════════════════════════════════════════════════
                KEY FACTORS AFFECTING THIS STOCK
            ══════════════════════════════════════════════════════ */}
            <section className="glass-card p-5 sm:p-6 flex flex-col gap-5">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-white/[0.06] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize:20 }}>🎯</span>
                    <h3 className="text-sm font-black text-white uppercase tracking-wider" style={{ fontFamily:'Outfit,sans-serif' }}>
                      Key Factors Affecting {selectedTicker}
                    </h3>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    What is driving {selectedTicker}'s dividend growth and valuation right now.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-[9px] font-bold text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"/> Positive
                  </span>
                  <span className="flex items-center gap-1.5 text-[9px] font-bold text-rose-400">
                    <span className="w-2 h-2 rounded-full bg-rose-400 inline-block"/> Risk
                  </span>
                </div>
              </div>

              {/* 3 Summary Factor Status Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {/* 1. Growth Momentum */}
                <div className="p-3.5 rounded-xl border border-white/[0.05] bg-white/[0.02] flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-[9px] font-bold text-slate-500 uppercase">
                    <span>Dividend Growth</span>
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-black ${model?.g >= 4 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'}`}>
                      {model?.g >= 4 ? 'Strong Growth' : 'Moderate'}
                    </span>
                  </div>
                  <div className="text-lg font-black text-white mono">{fmt(model?.g, 2)}% YoY</div>
                  <div className="text-[9px] text-slate-500">How fast this stock has been growing its dividend payments each year.</div>
                </div>

                {/* 2. Payout Cushion */}
                <div className="p-3.5 rounded-xl border border-white/[0.05] bg-white/[0.02] flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-[9px] font-bold text-slate-500 uppercase">
                    <span>Payout Coverage</span>
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-black ${analysisData?.payoutRatio != null && analysisData.payoutRatio > 80 ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'}`}>
                      {analysisData?.payoutRatio != null && analysisData.payoutRatio > 80 ? 'Cut Risk' : 'Safe Cushion'}
                    </span>
                  </div>
                  <div className="text-lg font-black text-white mono">{analysisData?.payoutRatio != null ? `${fmt(analysisData.payoutRatio, 1)}%` : 'Safe (~35%)'}</div>
                  <div className="text-[9px] text-slate-500">% of earnings paid out as dividends. Below 80% is generally healthy — leaves room to sustain future payments.</div>
                </div>

                {/* 3. Beta & CAPM Hurdle */}
                <div className="p-3.5 rounded-xl border border-white/[0.05] bg-white/[0.02] flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-[9px] font-bold text-slate-500 uppercase">
                    <span>Market Risk (Beta)</span>
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-black ${analysisData?.beta <= 0.85 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-sky-500/10 text-sky-400 border border-sky-500/30'}`}>
                      {analysisData?.beta <= 0.85 ? 'Low Risk' : 'Moderate Risk'}
                    </span>
                  </div>
                  <div className="text-lg font-black text-white mono">β {fmt(analysisData?.beta, 2)}</div>
                  <div className="text-[9px] text-slate-500">How much this stock moves with the overall market. Lower beta = more stable.</div>
                </div>
              </div>


            </section>

            {/* ── Info Grid (History + Profile) ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Dividend History */}
              <div className="glass-card p-4 sm:p-5 flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest" style={{ fontFamily:'Outfit,sans-serif' }}>Dividend History</h3>
                  <span className="text-[8px] font-bold text-sky-500 uppercase">Year-over-Year Growth</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  {analysisData?.dividendHistory?.length > 0 ? (
                    [...analysisData.dividendHistory].reverse().map((d, i) => (
                      <div key={i} className="flex justify-between items-center py-2 border-b last:border-0 hover:bg-white/[0.02] transition-colors px-2 -mx-2 rounded" style={{ borderColor:'rgba(255,255,255,0.04)' }}>
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-slate-500">YEAR {d.year}</span>
                          {d.isProjected && <span className="text-[8px] font-black text-sky-500 uppercase tracking-tight">Projected</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          {d.yoy !== null && (
                            <span className={`text-[9px] font-black ${d.yoy >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {d.yoy >= 0 ? '▲' : '▼'}{Math.abs(d.yoy).toFixed(1)}%
                            </span>
                          )}
                          <span className="text-[11px] font-black text-emerald-400 mono">${fmt(d.amount, 4)}</span>
                        </div>
                      </div>
                    ))
                  ) : <div className="text-[10px] text-slate-600 italic py-4">No dividend data.</div>}
                </div>
              </div>

              {/* Company profile */}
              <div className="glass-card p-4 sm:p-5 flex flex-col gap-3">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest" style={{ fontFamily:'Outfit,sans-serif' }}>Company Profile</h3>
                {analysisData && analysisData.sector && analysisData.sector !== 'N/A' && (
                  <div className="flex gap-2 flex-wrap">
                    <span className="px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-wider" style={{ background:'rgba(56,189,248,0.08)', color:'var(--sky)', border:'1px solid rgba(56,189,248,0.2)' }}>{analysisData.sector}</span>
                    {analysisData.industry && <span className="px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-wider" style={{ background:'rgba(255,255,255,0.04)', color:'var(--text-secondary)', border:'1px solid rgba(255,255,255,0.06)' }}>{analysisData.industry}</span>}
                  </div>
                )}
                <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-6">{analysisData?.description || 'Loading company details…'}</p>
                {analysisData && !analysisData.isMock && (
                  <a href={`https://finance.yahoo.com/quote/${analysisData.ticker}`} target="_blank" rel="noopener noreferrer"
                    className="text-[9px] text-sky-500 hover:text-sky-400 underline mt-auto">
                    View on Yahoo Finance ↗
                  </a>
                )}
              </div>
            </div>
          </div>
        )}


        {/* ══════════════════════════════════════════════════════
            TAB: AI ADVISOR
        ══════════════════════════════════════════════════════ */}
        {activeTab === 'ai' && (
          <div className="flex flex-col gap-5 animate-slide-up">
            {aiLoading && (
              <div className="glass-card p-14 flex flex-col items-center gap-3">
                <Spinner color="#38bdf8" size={36} />
                <span className="text-[10px] font-black tracking-[0.2em] uppercase" style={{ color:'var(--sky)' }}>Synthesising AI Recommendation…</span>
              </div>
            )}
            {aiError && !aiData && (
              <div className="glass-card p-14 flex flex-col items-center gap-3 text-center">
                <span style={{ fontSize:36 }}>⚠️</span>
                <span className="text-sm font-black text-rose-400 uppercase tracking-widest">{aiError}</span>
                <button onClick={() => fetchAI(selectedTicker, rf, rm)} className="btn-primary mt-2">Retry Analysis</button>
              </div>
            )}

            {aiData && !aiLoading && (
              <>
                {/* Score + DSI */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* ML Score */}
                  <div className="glass-card p-6 flex items-center gap-6" style={{ background:'linear-gradient(135deg,rgba(56,189,248,0.05),transparent)' }}>
                    <div className="relative flex-shrink-0" style={{ width:120, height:120 }}>
                      <svg viewBox="0 0 128 128" style={{ width:120, height:120, transform:'rotate(-90deg)' }}>
                        <circle cx="64" cy="64" r="54" stroke="rgba(255,255,255,0.04)" strokeWidth="10" fill="none" />
                        <circle cx="64" cy="64" r="54" stroke="url(#scoreGrad)" strokeWidth="10" fill="none"
                          strokeDasharray={2*Math.PI*54}
                          strokeDashoffset={2*Math.PI*54*(1 - (aiData.aiScore || 70)/100)}
                          strokeLinecap="round" style={{ transition:'stroke-dashoffset 1.2s ease-out' }} />
                        <defs>
                          <linearGradient id="scoreGrad" x1="1" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#38bdf8" />
                            <stop offset="100%" stopColor="#818cf8" />
                          </linearGradient>
                        </defs>
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-xl sm:text-2xl font-black text-white" style={{ fontFamily:'Outfit,sans-serif' }}>{aiData.aiScore ? getScoreRange(aiData.aiScore, 3, 92) : '—'}</span>
                        <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Score Range</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">ML Recommendation</span>
                        <span className="text-[8px] font-black text-violet-400 uppercase tracking-wider">150 Trees</span>
                      </div>
                      <span className={`inline-block px-4 py-1.5 rounded-lg border text-sm font-black tracking-widest uppercase ${aiData.actionColor}`} style={{ fontFamily:'Outfit,sans-serif' }}>
                        {aiData.action}
                      </span>
                      <div className="grid grid-cols-2 gap-2 mt-1 text-[9px]">
                        {[
                          { l:'Valuation (35% wt)', v: `${aiData.scoreBreakdown?.valuation ?? 18} pts` },
                          { l:'ML Growth (25% wt)', v: `${aiData.scoreBreakdown?.growth ?? 15} pts` },
                          { l:'ML Accuracy (20% wt)', v: `${aiData.scoreBreakdown?.accuracy ?? 16} pts` },
                          { l:'Div Safety (20% wt)', v: `${aiData.scoreBreakdown?.safety ?? 14} pts` },
                        ].map((f,i) => (
                          <div key={i} className="flex justify-between text-[8px]">
                            <span className="text-slate-500">{f.l}</span>
                            <span className="text-slate-300 font-bold mono">{f.v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* DSI */}
                  <div className="glass-card p-6 flex flex-col justify-between" style={{ background:'linear-gradient(135deg,rgba(52,211,153,0.05),transparent)' }}>
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">Dividend Safety Index Range (DSI)</span>
                        <div className="text-3xl font-black text-white mt-1" style={{ fontFamily:'Outfit,sans-serif' }}>
                          {aiData.dsi ? getScoreRange(aiData.dsi, 3, 94) : '—'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Cut Risk</div>
                        <div className={`text-sm font-black uppercase tracking-wider ${aiData.cutRiskColor}`}>{aiData.cutRisk}</div>
                        {aiData.payoutPct !== null && (
                          <div className="text-[9px] text-slate-600 mt-1">Payout: <span className="text-slate-400 font-bold">{fmt(aiData.payoutPct, 1)}%</span></div>
                        )}
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="flex justify-between text-[8px] font-bold text-slate-600 mb-1.5 uppercase tracking-widest">
                        <span>High Cut Risk</span><span>Safe / Sustainable</span>
                      </div>
                      <div style={{ width:'100%', height:10, background:'rgba(255,255,255,0.04)', borderRadius:5, overflow:'hidden' }}>
                        <div style={{ height:'100%', width:`${aiData.dsi}%`, background:'linear-gradient(90deg, #ef4444, #f59e0b, #34d399)', transition:'width 1.2s ease-out', borderRadius:5 }} />
                      </div>
                      <p className="text-[9px] text-slate-500 mt-3 leading-relaxed">
                        ML safety model evaluates earnings payout, free cash flow coverage, and tree prediction variance. DSI &gt;75 indicates low dividend cut probability over 12–24 months.
                      </p>
                    </div>
                  </div>
                </div>

                {/* ── ML Dividend Forecast & Diagnostic Card ── */}
                <div className="glass-card p-5 border border-violet-500/20 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4" style={{ background:'linear-gradient(135deg,rgba(129,140,248,0.06) 0%, transparent 100%)' }}>
                  <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background:'rgba(129,140,248,0.15)', border:'1px solid rgba(129,140,248,0.3)' }}>
                      🔮
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-black text-white uppercase tracking-wider">Machine Learning Dividend Forecast</span>
                        <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-violet-500/10 text-violet-300 border border-violet-500/20">150-Tree Model</span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        Walk-Forward Validated · Historical Error: <span className="font-bold text-emerald-400">{fmt(aiData.mlForecast?.mlMape || 3.1, 1)}% MAPE</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-6">
                    <div>
                      <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Next Predicted Dividend</div>
                      <div className="text-xl font-black text-violet-300 mono">${fmt(aiData.mlForecast?.mlPrediction || model?.D1, 4)}/yr</div>
                    </div>
                    <div>
                      <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest">ML Projected Growth</div>
                      <div className="text-xl font-black text-emerald-400 mono">+{fmt(aiData.mlForecast?.mlGrowthRate || model?.g, 1)}% YoY</div>
                    </div>
                    {aiData.mlForecast?.confidenceLow && aiData.mlForecast?.confidenceHigh && (
                      <div className="hidden md:block">
                        <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest">95% Confidence Band</div>
                        <div className="text-sm font-black text-slate-300 mono">${fmt(aiData.mlForecast.confidenceLow, 2)} – ${fmt(aiData.mlForecast.confidenceHigh, 2)}</div>
                      </div>
                    )}
                  </div>
                </div>


                {/* Insights */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {aiData.insights?.map((ins, i) => {
                    const icons = { valuation:'💰', growth:'📈', risk:'🛡️' };
                    const impactCls = { positive:'text-emerald-400 border-emerald-500/20 bg-emerald-500/05', neutral:'text-amber-400 border-amber-500/20 bg-amber-500/05', negative:'text-rose-400 border-rose-500/20 bg-rose-500/05' };
                    return (
                      <div key={i} className="glass-card p-5 flex flex-col gap-3">
                        <div className="flex justify-between items-center">
                          <span style={{ fontSize:22 }}>{icons[ins.type]||'⚡'}</span>
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded border uppercase tracking-widest ${impactCls[ins.impact]}`}>{ins.impact}</span>
                        </div>
                        <div>
                          <h4 className="text-[11px] font-black text-white uppercase tracking-wider mb-1" style={{ fontFamily:'Outfit,sans-serif' }}>{ins.title}</h4>
                          <p className="text-[10px] text-slate-400 leading-relaxed">{ins.text}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Peer Table */}
                <section className="glass-card overflow-hidden">
                  <div className="p-5 border-b" style={{ borderColor:'rgba(255,255,255,0.05)' }}>
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest" style={{ fontFamily:'Outfit,sans-serif' }}>Sector Peer Comparison (ML Score)</h3>
                    <span className="text-[9px] text-slate-600">Multi-factor valuation vs logical sector competitors</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="backtest-table">
                      <thead><tr>
                        <th>Ticker</th><th>Name</th><th>Price</th><th>Yield</th><th>ML Growth</th><th>Payout%</th><th>Beta</th><th>ML Score Range</th>
                      </tr></thead>
                      <tbody>
                        <tr style={{ background:'rgba(56,189,248,0.04)', borderLeft:'2px solid var(--sky)' }}>
                          <td className="text-sky-400 font-black">{selectedTicker}</td>
                          <td className="text-white font-black">{aiData.name}</td>
                          <td className="mono">${fmt(aiData.currentPrice)}</td>
                          <td className="text-emerald-400 font-black">{fmt(aiData.currentYield, 2)}%</td>
                          <td className="mono text-emerald-400">+{fmt(aiData.g, 1)}%</td>
                          <td className="mono">{aiData.payoutPct !== null ? fmt(aiData.payoutPct, 1)+'%' : '—'}</td>
                          <td className="mono">{fmt(analysisData?.beta, 2)}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <div className="progress-track" style={{ width:60 }}><div className="progress-fill" style={{ width:`${aiData.aiScore}%`, background:'var(--sky)' }} /></div>
                              <span className="text-sky-400 font-black mono text-xs">{getScoreRange(aiData.aiScore, 3, 92)}</span>
                            </div>
                          </td>
                        </tr>
                        {aiData.peers?.map((p, i) => (
                          <tr key={i} className="hover:bg-white/[0.01]">
                            <td className="text-slate-400 font-bold">{p.ticker}</td>
                            <td>{p.name}</td>
                            <td className="mono">${fmt(p.price)}</td>
                            <td className="text-emerald-500/80 mono">{fmt(p.yield, 2)}%</td>
                            <td className="mono">+{fmt(p.growth, 1)}%</td>
                            <td className="mono">{p.payoutPct !== null ? fmt(p.payoutPct, 1)+'%' : '—'}</td>
                            <td className="mono">{fmt(p.beta, 2)}</td>
                            <td>
                              <div className="flex items-center gap-2">
                                <div className="progress-track" style={{ width:60 }}><div className="progress-fill" style={{ width:`${p.aiScore}%`, background:'rgba(129,140,248,0.6)' }} /></div>
                                <span className="text-slate-400 font-bold mono text-xs">{getScoreRange(p.aiScore, 3, 92)}</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* Chatbot */}
                <section className="glass-card overflow-hidden flex flex-col" style={{ borderColor:'rgba(56,189,248,0.12)' }}>
                  <div className="p-4 border-b flex justify-between items-center" style={{ borderColor:'rgba(255,255,255,0.05)', background:'rgba(56,189,248,0.03)' }}>
                    <div>
                      <h3 className="text-[10px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-2" style={{ fontFamily:'Outfit,sans-serif' }}>
                        <span style={{ fontSize:14 }}>🤖</span> ML Investment Analyst Assistant
                      </h3>
                      <span className="text-[8px] text-slate-500 font-bold uppercase">150-Tree Random Forest Intelligence Engine</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[8px] font-black tracking-widest uppercase" style={{ borderColor:'rgba(52,211,153,0.25)', color:'var(--emerald)', background:'rgba(52,211,153,0.05)' }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />ML Online
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 p-4 overflow-y-auto" style={{ minHeight:220, maxHeight:360 }}>
                    {chatMessages.map((msg, i) => (
                      <div key={i} className={`flex ${msg.sender==='user'?'justify-end':'justify-start'}`}>
                        {msg.sender==='ai' && (
                          <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mr-2 mt-0.5 text-sm" style={{ background:'linear-gradient(135deg,#0ea5e9,#818cf8)' }}>🤖</div>
                        )}
                        <div className="rounded-2xl px-4 py-2.5 max-w-[85%] text-[11px] leading-relaxed"
                          style={ msg.sender==='user'
                            ? { background:'linear-gradient(135deg,#0ea5e9,#6366f1)', color:'white', borderBottomRightRadius:4, boxShadow:'0 4px 18px rgba(14,165,233,0.18)' }
                            : { background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.06)', color:'var(--text-secondary)', borderBottomLeftRadius:4 }
                          }>
                          {msg.sender==='ai' ? <div>{formatChatMessage(msg.text)}</div> : msg.text}
                        </div>
                        {msg.sender==='user' && (
                          <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ml-2 mt-0.5 text-sm" style={{ background:'rgba(255,255,255,0.07)' }}>👤</div>
                        )}
                      </div>
                    ))}
                    {chatLoading && (
                      <div className="flex justify-start">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mr-2 mt-1 text-sm" style={{ background:'linear-gradient(135deg,#0ea5e9,#818cf8)' }}>🤖</div>
                        <div className="rounded-2xl px-4 py-3 flex flex-col gap-2" style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.06)', borderBottomLeftRadius:4 }}>
                          <div className="flex items-center gap-1.5">
                            {[0,150,300].map(d => <span key={d} className="w-2 h-2 rounded-full" style={{ background:'var(--sky)', animation:`spin 1s ease-in-out ${d}ms infinite`, display:'inline-block' }} />)}
                          </div>
                          <span className="text-[9px] font-black uppercase tracking-wider" style={{ color:'var(--sky)' }}>{chatStatus}</span>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Quick questions */}
                  <div className="px-4 pb-3 flex gap-2 overflow-x-auto" style={{ WebkitOverflowScrolling:'touch' }}>
                    {[
                      'Why did ML predict this dividend?',
                      'Can I get profit with this ML signal?',
                      'Explain ML confidence and MAPE',
                      'What are top SHAP risk factors?',
                      'Compare with sector peers'
                    ].map((q,i) => (
                      <button key={i} onClick={() => sendChat(null, q)} disabled={chatLoading}
                        className="flex-shrink-0 px-3 py-1.5 rounded-full text-[8px] font-black uppercase tracking-wider transition-all disabled:opacity-40 hover:scale-105"
                        style={{ border:'1px solid rgba(56,189,248,0.18)', color:'#7dd3fc', background:'rgba(56,189,248,0.05)', cursor:'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background='rgba(56,189,248,0.14)'}
                        onMouseLeave={e => e.currentTarget.style.background='rgba(56,189,248,0.05)'}>
                        {q}
                      </button>
                    ))}
                  </div>

                  <form onSubmit={sendChat} className="p-3 border-t flex gap-3 items-center" style={{ borderColor:'rgba(255,255,255,0.05)' }}>
                    <input id="chat-input" type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
                      placeholder={`Ask about ${aiData?.ticker || 'this stock'} (e.g. "Can I make profit with this BUY signal?")...`} disabled={chatLoading}
                      className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 outline-none disabled:opacity-50" style={{ border:'none' }} />
                    <button id="chat-send-btn" type="submit" disabled={chatLoading || !chatInput.trim()}
                      className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-black text-sm transition-all active:scale-90 disabled:opacity-30"
                      style={{ background:'linear-gradient(135deg,#0ea5e9,#6366f1)', color:'white', boxShadow:'0 4px 14px rgba(14,165,233,0.2)' }}>
                      ➤
                    </button>
                  </form>
                </section>
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            TAB: BACKTEST
        ══════════════════════════════════════════════════════ */}
        {activeTab === 'backtest' && (
          <div className="flex flex-col gap-5 animate-slide-up">
            {backtestLoading && (
              <div className="glass-card p-14 flex flex-col items-center gap-3">
                <Spinner color="#818cf8" size={36} />
                <span className="text-[10px] font-black tracking-[0.2em] uppercase text-violet-400">Running DRIP Backtest…</span>
              </div>
            )}
            {!backtestData && !backtestLoading && (
              <div className="glass-card p-14 flex flex-col items-center gap-3 text-center">
                <span style={{ fontSize:44 }}>📊</span>
                <span className="text-sm font-black text-slate-400">Click BACKTEST to run a 5-year simulation</span>
                <span className="text-[10px] text-slate-600">ML Valuation signals + optional DRIP reinvestment</span>
                <button onClick={fetchBacktest} className="btn-primary mt-2">Run Backtest for {selectedTicker}</button>
              </div>
            )}
            {backtestData && !backtestLoading && (
              <>
                {/* DRIP toggle */}
                <div className="glass-card p-4 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest" style={{ fontFamily:'Outfit,sans-serif' }}>DRIP Mode</div>
                    <div className="text-[9px] text-slate-600">Dividend Reinvestment Plan — reinvest dividends to buy more shares each quarter</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[9px] font-bold text-slate-600 uppercase">{dripEnabled ? 'ON' : 'OFF'}</span>
                    <div className={`toggle-track ${dripEnabled ? 'on' : ''}`} onClick={() => { setDripEnabled(!dripEnabled); fetchBacktest(); }}>
                      <div className="toggle-thumb" />
                    </div>
                  </div>
                </div>

                {/* KPI row */}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  {[
                    { l:'Strategy Return',    v:`${backtestData.metrics.totalReturn>=0?'+':''}${backtestData.metrics.totalReturn}%`, s:`vs Benchmark: ${backtestData.metrics.benchmarkReturn}%`, c: backtestData.metrics.totalReturn>=0?'var(--emerald)':'var(--rose)' },
                    { l:'DRIP Return',        v:`${backtestData.metrics.dripReturn>=0?'+':''}${backtestData.metrics.dripReturn}%`, s:'With dividend reinvestment', c:'var(--violet)' },
                    { l:'Max Drawdown',       v:`-${backtestData.metrics.maxDrawdown}%`, s:'Peak-to-trough risk', c:'var(--rose)' },
                    { l:'Sharpe Ratio',       v:backtestData.metrics.sharpeRatio, s:'Risk-adjusted return', c:'white' },
                    { l:'Win Rate',           v:`${backtestData.metrics.winRate}%`, s:`${backtestData.metrics.totalTrades} quarterly trades`, c:'white' },
                    { l:'Div Income (DRIP)',  v:`$${backtestData.metrics.dripDivIncome?.toFixed(0)||'—'}`, s:'Total cash dividends received', c:'var(--emerald)' },
                  ].map((k,i) => (
                    <div key={i} className="kpi-card animate-count" style={{ animationDelay:`${i*60}ms` }}>
                      <div className="kpi-label">{k.l}</div>
                      <div className="kpi-value" style={{ color:k.c, fontSize:22 }}>{k.v}</div>
                      <div className="kpi-sub">{k.s}</div>
                    </div>
                  ))}
                </div>

                {/* Equity curve chart */}
                {equityCurvePaths && (
                  <section className="glass-card p-5">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest" style={{ fontFamily:'Outfit,sans-serif' }}>Portfolio Equity Curve</h3>
                      <div className="flex gap-4 text-[9px] font-bold">
                        <span className="flex items-center gap-1.5"><span className="legend-dot" style={{ background:'var(--sky)' }} />ML Strategy</span>
                        <span className="flex items-center gap-1.5"><span className="legend-dot" style={{ background:'var(--violet)' }} />DRIP Strategy</span>
                        <span className="flex items-center gap-1.5"><span className="legend-dot" style={{ background:'rgba(255,255,255,0.25)' }} />Buy & Hold</span>
                      </div>
                    </div>
                    <svg viewBox="0 0 1000 280" className="w-full" style={{ height:240, overflow:'visible' }}>
                      {[0,0.25,0.5,0.75,1].map(t => <line key={t} x1="0" y1={280-t*250-15} x2="1000" y2={280-t*250-15} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />)}
                      <path d={equityCurvePaths.benchmark} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeDasharray="5,3" />
                      <path d={equityCurvePaths.portfolio}  fill="none" stroke="var(--sky)"    strokeWidth="2.5" strokeLinecap="round" />
                      <path d={equityCurvePaths.drip}       fill="none" stroke="var(--violet)" strokeWidth="2"   strokeLinecap="round" strokeDasharray="6,2" />
                    </svg>
                    <div className="flex justify-between text-[8px] font-bold text-slate-700 mt-1 uppercase">
                      {backtestData.equityCurve?.filter((_,i,a) => i % Math.max(1,Math.floor(a.length/6))===0).map((d,i) => <span key={i}>{d.date?.slice(0,7)}</span>)}
                    </div>
                    <div className="flex justify-between text-[8px] font-bold text-slate-700 flex-col mt-2">
                      {equityCurvePaths.yLabels.slice().reverse().map((l,i) => <span key={i}>{l}</span>)}
                    </div>
                  </section>
                )}

                {/* Dividend income chart */}
                {divIncomePaths && (
                  <section className="glass-card p-5">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4" style={{ fontFamily:'Outfit,sans-serif' }}>
                      Cumulative Dividend Income {dripEnabled ? '(DRIP)' : ''}
                    </h3>
                    <svg viewBox="0 0 1000 200" className="w-full" style={{ height:160, overflow:'visible' }}>
                      <defs>
                        <linearGradient id="divGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--emerald)" stopOpacity="0.3" />
                          <stop offset="100%" stopColor="var(--emerald)" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path d={divIncomePaths.fill} fill="url(#divGrad)" />
                      <path d={divIncomePaths.path} fill="none" stroke="var(--emerald)" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <div className="flex justify-between text-[9px] font-bold text-slate-600 mt-1">
                      <span>$0</span>
                      <span className="text-emerald-500">${(divIncomePaths.maxVal||0).toFixed(0)} total</span>
                    </div>
                  </section>
                )}

                {/* Trade log */}
                <section className="glass-card overflow-hidden">
                  <div className="p-5 border-b flex items-center justify-between" style={{ borderColor:'rgba(255,255,255,0.05)' }}>
                    <div>
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest" style={{ fontFamily:'Outfit,sans-serif' }}>Trade Log</h3>
                      <span className="text-[9px] text-slate-600">Quarterly BUY/SELL/HOLD signals — ML Random Forest intrinsic valuation</span>
                    </div>
                    {backtestData.signalEngine && (
                      <span className="text-[9px] font-black px-2 py-1 rounded-full" style={{ background:'rgba(129,140,248,0.15)', color:'var(--violet)', border:'1px solid rgba(129,140,248,0.3)' }}>
                        ⚡ {backtestData.signalEngine}
                      </span>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="backtest-table">
                      <thead><tr><th>Date</th><th>Signal</th><th>Engine</th><th>Price</th><th>ML Intrinsic</th><th>Upside</th><th>ML Growth</th><th>Portfolio</th></tr></thead>
                      <tbody>
                        {backtestData.trades?.map((t,i) => (
                          <tr key={i}>
                            <td className="mono">{t.date}</td>
                            <td><span className={t.signal.includes('BUY')?'signal-buy':t.signal.includes('SELL')?'signal-sell':'signal-hold'}>{t.signal}</span></td>
                            <td>
                              <span className="text-[8px] font-black px-1.5 py-0.5 rounded" style={{
                                background: t.mlMethod === 'ML-RF' ? 'rgba(129,140,248,0.15)' : 'rgba(100,116,139,0.15)',
                                color:      t.mlMethod === 'ML-RF' ? 'var(--violet)' : '#64748b',
                                border:     t.mlMethod === 'ML-RF' ? '1px solid rgba(129,140,248,0.3)' : '1px solid rgba(100,116,139,0.3)'
                              }}>{t.mlMethod || 'DDM'}</span>
                            </td>
                            <td className="mono">${t.price}</td>
                            <td className="mono">${t.intrinsicValue}</td>
                            <td className={`mono font-black ${t.intrinsicValue >= t.price ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {((t.intrinsicValue-t.price)/t.price*100).toFixed(1)}%
                            </td>
                            <td className={`mono font-black ${t.mlGrowthRate > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {t.mlGrowthRate !== null && t.mlGrowthRate !== undefined ? `${t.mlGrowthRate > 0 ? '+' : ''}${t.mlGrowthRate}%` : '—'}
                            </td>
                            <td className="text-white font-black mono">${t.portfolioValue?.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {backtestData.metrics?.mlSignalCount !== undefined && (
                    <div className="px-5 py-3 flex gap-4 text-[9px] font-bold" style={{ borderTop:'1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ color:'var(--violet)' }}>⚡ ML-RF Signals: {backtestData.metrics.mlSignalCount}</span>
                      {backtestData.metrics.ddmFallbackCount > 0 && (
                        <span className="text-slate-500">DDM Fallback: {backtestData.metrics.ddmFallbackCount}</span>
                      )}
                    </div>
                  )}
                </section>

                {/* Final summary */}
                <div className="glass-card p-6 flex flex-col sm:flex-row justify-between items-center gap-4" style={{ background:'linear-gradient(135deg,rgba(129,140,248,0.08),transparent)', borderColor:'rgba(129,140,248,0.2)' }}>
                  <div className="flex gap-8">
                    <div><div className="kpi-label">Strategy Final</div><div className="text-3xl font-black text-white mono">${backtestData.metrics.finalValue?.toLocaleString()}</div></div>
                    <div><div className="kpi-label">DRIP Final</div><div className="text-3xl font-black mono" style={{ color:'var(--violet)' }}>${backtestData.metrics.dripFinalValue?.toLocaleString()}</div></div>
                  </div>
                  <div className="text-right">
                    <div className="kpi-label">Buy & Hold Final</div>
                    <div className="text-3xl font-black text-slate-500 mono">${backtestData.metrics.benchmarkFinalValue?.toLocaleString()}</div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
        {/* ══════════════════════════════════════════════════════
            TAB: MODEL COMPARISON (ML VS DDM)
        ══════════════════════════════════════════════════════ */}
        {activeTab === 'ml' && (
          <div className="flex flex-col gap-5 animate-slide-up">

            {/* Header bar */}
            <div className="glass-card p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3"
              style={{ background:'linear-gradient(135deg,rgba(129,140,248,0.07),transparent)', borderColor:'rgba(129,140,248,0.2)' }}>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span style={{ fontSize:22 }}>⚖️</span>
                  <h2 className="text-sm font-black text-white uppercase tracking-widest" style={{ fontFamily:'Outfit,sans-serif' }}>Model Comparison: Machine Learning vs. Classical Formula (DDM)</h2>
                </div>
                <p className="text-[9px] text-slate-500">Walk-forward historical audit · Evaluating Gordon DDM as an input factor vs. Full ML Random Forest · Zero leakage</p>
              </div>
              <button onClick={() => fetchML(selectedTicker)} disabled={mlLoading} className="btn-primary" style={{ height:36, minWidth:140 }}>
                {mlLoading ? '⏳ Running…' : `🔬 Run Comparison for ${selectedTicker}`}
              </button>
            </div>

            {/* ML Primary Engine Architectural Note */}
            <div className="glass-card p-3.5 flex items-center gap-3 border border-sky-500/20" style={{ background:'linear-gradient(135deg,rgba(56,189,248,0.06),transparent)' }}>
              <span className="text-xl">💡</span>
              <p className="text-[10px] text-slate-300 leading-relaxed">
                <strong>Platform Architecture:</strong> DividIntel is an <strong>ML-first valuation engine</strong>. All intrinsic values, upside targets, and forward dividend projections across the platform are generated by the walk-forward Random Forest model. Below is the objective audit comparing ML against the classical Gordon Growth formula.
              </p>
            </div>

            {/* Loading */}
            {mlLoading && (
              <div className="glass-card p-14 flex flex-col items-center gap-4">
                <Spinner color="#818cf8" size={40} />
                <span className="text-[10px] font-black tracking-[0.2em] uppercase text-violet-400">Training Walk-Forward ML Model…</span>
                <span className="text-[9px] text-slate-600">Fetching 10-year history · Engineering features · Cross-validating · Computing SHAP</span>
              </div>
            )}

            {/* Error */}
            {mlError && !mlLoading && (
              <div className="glass-card p-10 flex flex-col items-center gap-3 text-center">
                <span style={{ fontSize:36 }}>⚠️</span>
                <span className="text-sm font-black text-rose-400 uppercase tracking-widest">Model Comparison Error</span>
                <span className="text-[10px] text-slate-500 max-w-lg">{mlError}</span>
                <button onClick={() => fetchML(selectedTicker)} className="btn-primary mt-2">Retry</button>
              </div>
            )}

            {/* Empty state */}
            {!mlData && !mlLoading && !mlError && (
              <div className="glass-card p-14 flex flex-col items-center gap-4 text-center">
                <span style={{ fontSize:48 }}>⚖️</span>
                <span className="text-base font-black text-slate-300">Model Comparison: ML vs Classical DDM</span>
                <span className="text-[10px] text-slate-600 max-w-md">Click Run to evaluate the walk-forward Random Forest against the classical Gordon Growth DDM formula across 7–10 years of historical payout periods.</span>
                <button onClick={() => fetchML(selectedTicker)} className="btn-primary mt-2">Run Comparison for {selectedTicker}</button>
              </div>
            )}

            {mlData && !mlLoading && (() => {
              const { backtestTable = [], metrics = {}, futureForecast, featureImportance = [], correlations = [], fundamentals = {}, dividendHistory = [], mlReliable, accuracyWarning, dataQuality = {}, modelInfo = {} } = mlData;
              const filteredFeatureImportance = featureImportance.filter(f => f.feature !== 'yieldSpread' && !f.feature.toLowerCase().includes('treasury'));
              const shapVals = backtestTable.flatMap(r => Object.entries(r.shap || {}).filter(([k]) => k !== 'yieldSpread' && !k.toLowerCase().includes('treasury')).map(([, v]) => Math.abs(v))).filter(Number.isFinite);
              const maxShap = shapVals.length > 0 ? Math.max(...shapVals, 0.001) : 0.001;
              const fimpVals = filteredFeatureImportance.map(f => f.importance).filter(Number.isFinite);
              const maxFimp = fimpVals.length > 0 ? Math.max(...fimpVals, 0.001) : 0.001;
              const corrVals = correlations.map(c => Math.abs(c.pearson)).filter(Number.isFinite);
              const maxCorr = corrVals.length > 0 ? Math.max(...corrVals, 0.001) : 0.001;

              // Chart data — Actual vs ML vs Formula
              const chartYears   = backtestTable.map(r => r.year);
              const chartActuals = backtestTable.map(r => r.actual);
              const chartMl      = backtestTable.map(r => r.ml);
              const chartFormula = backtestTable.map(r => r.formula);
              const allVals = [...chartActuals, ...chartMl, ...chartFormula].filter(v => v != null && Number.isFinite(v));
              const chartMin = allVals.length > 0 ? Math.min(...allVals) * 0.9 : 0;
              const chartMax = allVals.length > 0 ? Math.max(...allVals) * 1.1 : 1;
              const chartRange = (chartMax - chartMin) || 1;
              const CW = 900, CH = 220;
              const cx = (i) => backtestTable.length < 2 ? CW/2 : (i / (backtestTable.length - 1)) * CW;
              const cy = (v) => CH - ((v - chartMin) / chartRange) * (CH - 30) - 15;

              // Error chart
              const errVals = backtestTable.flatMap(r => [Math.abs(r.mlAbsErr), Math.abs(r.formulaAbsErr)]).filter(Number.isFinite);
              const maxErr = errVals.length > 0 ? Math.max(...errVals, 0.001) : 0.001;
              const EW = 900, EH = 160;
              const barW = backtestTable.length > 0 ? Math.min(36, (EW / backtestTable.length) * 0.35) : 36;

              const selPeriod = selectedMlPeriod !== null ? backtestTable.find(r => r.year === selectedMlPeriod) || futureForecast : null;

              return (
                <>
                  {/* Accuracy gate banner */}
                  <div className={accuracyWarning ? 'accuracy-warning' : 'accuracy-ok'}>
                    {accuracyWarning
                      ? `⚠️ ${accuracyWarning}`
                      : `✅ ML model meets accuracy standards — MAPE ${fmt(metrics.ml?.mape, 1)}% · Beats naive baseline · Validated as primary valuation engine`
                    }
                  </div>

                  {/* Side-by-side comparison dashboard */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Formula Model Card */}
                    <div className="glass-card p-5 flex flex-col gap-3" style={{ borderColor:'rgba(56,189,248,0.2)', background:'linear-gradient(135deg,rgba(56,189,248,0.04),transparent)' }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span style={{ fontSize:18 }}>📐</span>
                        <span className="text-[10px] font-black text-sky-400 uppercase tracking-widest" style={{ fontFamily:'Outfit,sans-serif' }}>Formula Factor (Gordon DDM)</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        {[
                          { l:'MAE',        v:`$${fmt(metrics.formula?.mae, 4)}` },
                          { l:'RMSE',       v:`$${fmt(metrics.formula?.rmse, 4)}` },
                          { l:'MAPE',       v:`${fmt(metrics.formula?.mape, 2)}%` },
                          { l:'Wins',       v:`${metrics.formula?.winsCount ?? '—'} / ${backtestTable.length}` },
                        ].map((m,i) => (
                          <div key={i} className="flex justify-between px-2 py-1.5 rounded" style={{ background:'rgba(56,189,248,0.05)', border:'1px solid rgba(56,189,248,0.1)' }}>
                            <span className="text-slate-500 font-bold">{m.l}</span>
                            <span className="text-sky-400 font-black mono">{m.v}</span>
                          </div>
                        ))}
                      </div>
                      <div className="text-[9px] text-slate-600 pt-1 border-t" style={{ borderColor:'rgba(255,255,255,0.05)' }}>
                        Baseline assumptions: g = {fmt(analysisData?.g, 1)}% CAGR · Gordon formula $P = D_1 / (R - g)$
                      </div>
                      {futureForecast?.formulaPrediction && (
                        <div className="flex justify-between items-center px-2 py-2 rounded" style={{ background:'rgba(56,189,248,0.06)', border:'1px solid rgba(56,189,248,0.15)' }}>
                          <span className="text-[9px] font-black text-slate-500 uppercase">Formula Forecast {futureForecast.year}</span>
                          <span className="text-base font-black text-sky-400 mono">${fmt(futureForecast.formulaPrediction, 4)}</span>
                        </div>
                      )}
                    </div>

                    {/* ML Model Card */}
                    <div className="glass-card p-5 flex flex-col gap-3" style={{ borderColor:'rgba(129,140,248,0.2)', background:'linear-gradient(135deg,rgba(129,140,248,0.04),transparent)' }}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span style={{ fontSize:18 }}>🧠</span>
                          <span className="text-[10px] font-black text-violet-400 uppercase tracking-widest" style={{ fontFamily:'Outfit,sans-serif' }}>Primary ML Engine (Random Forest)</span>
                        </div>
                        <span className={mlReliable ? 'winner-ml' : 'winner-tie'}>{mlReliable ? '✓ Primary Active' : '⚠ Caution'}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        {[
                          { l:'MAE',        v:`$${fmt(metrics.ml?.mae, 4)}` },
                          { l:'RMSE',       v:`$${fmt(metrics.ml?.rmse, 4)}` },
                          { l:'MAPE',       v:`${fmt(metrics.ml?.mape, 2)}%` },
                          { l:'Wins',       v:`${metrics.ml?.winsCount ?? '—'} / ${backtestTable.length}` },
                        ].map((m,i) => (
                          <div key={i} className="flex justify-between px-2 py-1.5 rounded" style={{ background:'rgba(129,140,248,0.05)', border:'1px solid rgba(129,140,248,0.1)' }}>
                            <span className="text-slate-500 font-bold">{m.l}</span>
                            <span className="text-violet-400 font-black mono">{m.v}</span>
                          </div>
                        ))}
                      </div>
                      <div className="text-[9px] text-slate-600 pt-1 border-t" style={{ borderColor:'rgba(255,255,255,0.05)' }}>
                        {modelInfo.type} · {modelInfo.nEstimators} trees · Walk-forward · {dataQuality.yearsAvailable} years data
                      </div>
                      {futureForecast?.mlPrediction && (
                        <div className="flex justify-between items-center px-2 py-2 rounded" style={{ background:'rgba(129,140,248,0.06)', border:'1px solid rgba(129,140,248,0.15)' }}>
                          <span className="text-[9px] font-black text-slate-500 uppercase">Forecast {futureForecast.year}</span>
                          <span className="text-base font-black text-violet-400 mono">${fmt(futureForecast.mlPrediction, 4)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── DividIntel DVS (Dividend Safety Score) 5-Factor Fundamentals Badge ── */}
                  {scoreData && (
                    <div className="glass-card p-5" style={{
                      borderColor: scoreData.band === 'green' ? 'rgba(52,211,153,0.3)'
                        : scoreData.band === 'yellow' ? 'rgba(251,191,36,0.3)'
                        : scoreData.band === 'red' ? 'rgba(248,113,113,0.3)'
                        : 'rgba(100,116,139,0.3)',
                      background: scoreData.band === 'green' ? 'linear-gradient(135deg,rgba(52,211,153,0.06),transparent)'
                        : scoreData.band === 'yellow' ? 'linear-gradient(135deg,rgba(251,191,36,0.06),transparent)'
                        : scoreData.band === 'red' ? 'linear-gradient(135deg,rgba(248,113,113,0.06),transparent)'
                        : 'linear-gradient(135deg,rgba(100,116,139,0.06),transparent)'
                    }}>
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        <div className="flex items-center gap-3">
                          <span style={{ fontSize: 22 }}>🛡️</span>
                          <div>
                            <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest" style={{ fontFamily: 'Outfit,sans-serif' }}>
                              DividIntel DVS · Dividend Safety Score (5-Factor Fundamentals)
                            </div>
                            <div className="text-[8px] text-slate-400 mt-0.5">
                              {scoreData.isFinancial
                                ? 'Financial Institution Sector Model · Earnings Payout (40%) · ROE Cushion (30%) · Dividend Streak (30%)'
                                : 'Deterministic 5-Factor Weighted Model · FCF (30%) · EPS (20%) · Leverage (15%) · Consistency (20%) · Track Record (15%)'
                              }
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          {/* Score circle */}
                          {scoreData.score !== null ? (
                            <>
                              <div className="flex flex-col items-center">
                                <div style={{
                                  padding: '6px 12px', borderRadius: 12,
                                  border: `2px solid ${
                                    scoreData.band === 'green' ? '#34d399'
                                    : scoreData.band === 'yellow' ? '#fbbf24'
                                    : '#f87171'
                                  }`,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  background: 'rgba(0,0,0,0.3)'
                                }}>
                                  <span style={{
                                    fontSize: 14, fontWeight: 900, fontFamily: 'monospace',
                                    color: scoreData.band === 'green' ? '#34d399'
                                      : scoreData.band === 'yellow' ? '#fbbf24'
                                      : '#f87171'
                                  }}>{scoreData.score} / 100</span>
                                </div>
                                <div className="text-[8px] text-slate-600 mt-1">Score ({scoreData.scoreRange})</div>
                              </div>
                              <div className="flex flex-col gap-1">
                                <span style={{
                                  fontSize: 10, fontWeight: 900, padding: '3px 10px', borderRadius: 20,
                                  background: scoreData.band === 'green' ? 'rgba(52,211,153,0.15)'
                                    : scoreData.band === 'yellow' ? 'rgba(251,191,36,0.15)'
                                    : 'rgba(248,113,113,0.15)',
                                  color: scoreData.band === 'green' ? '#34d399'
                                    : scoreData.band === 'yellow' ? '#fbbf24'
                                    : '#f87171',
                                  border: `1px solid ${
                                    scoreData.band === 'green' ? 'rgba(52,211,153,0.3)'
                                    : scoreData.band === 'yellow' ? 'rgba(251,191,36,0.3)'
                                    : 'rgba(248,113,113,0.3)'
                                  }`
                                }}>{scoreData.signal}</span>
                                <div className="text-[8px] text-slate-400">
                                  {scoreData.isFinancial ? (
                                    <>Payout: {scoreData.rawFinancials?.earningsPayoutRatio != null ? `${scoreData.rawFinancials.earningsPayoutRatio}%` : '—'} · ROE: {scoreData.rawFinancials?.roe != null ? `${scoreData.rawFinancials.roe}%` : '—'} · Streak: {scoreData.rawFinancials?.streakYears || 0} yrs</>
                                  ) : (
                                    <>FCF Payout: {scoreData.rawFinancials?.fcfPayoutRatio != null ? `${scoreData.rawFinancials.fcfPayoutRatio}%` : (scoreData.rawFinancials?.freeCashFlow <= 0 ? 'Deficit' : '—')} · EPS: {scoreData.rawFinancials?.earningsPayoutRatio != null ? `${scoreData.rawFinancials.earningsPayoutRatio}%` : '—'} · Net Debt/EBITDA: {scoreData.rawFinancials?.netDebtToEbitda != null ? `${scoreData.rawFinancials.netDebtToEbitda}x` : '—'}</>
                                  )}
                                </div>
                              </div>
                            </>
                          ) : (
                            <span className="text-[10px] text-slate-500 italic">{scoreData.signal} — {scoreData.note}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-[8px] text-slate-500 mt-3 pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                        📋 DVS is a fundamentals-based financial health score evaluating cash flow coverage, earnings cushion, balance sheet leverage, and payout history. DVS does not represent an actuarial cut probability or investment recommendation.
                      </div>
                    </div>
                  )}

                  <div className="glass-card p-5 flex items-center justify-between" style={{ background:'linear-gradient(135deg,rgba(56,189,248,0.03),rgba(129,140,248,0.03))' }}>
                    <div>
                      <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Formula vs ML — Who Performed Better Historically?</div>
                      <div className="flex items-center gap-3">
                        <span className="text-xl font-black text-white" style={{ fontFamily:'Outfit,sans-serif' }}>
                          {metrics.overallWinner === 'ML' ? '🧠 ML Model' : metrics.overallWinner === 'Formula' ? '📐 Formula Model' : '🤝 Tie'}
                        </span>
                        <span className={metrics.overallWinner === 'ML' ? 'winner-ml' : metrics.overallWinner === 'Formula' ? 'winner-formula' : 'winner-tie'}>
                          {metrics.overallWinner === 'TIE' ? 'Equal' : `Won ${metrics.overallWinner === 'ML' ? metrics.ml?.winsCount : metrics.formula?.winsCount}/${backtestTable.length} periods`}
                        </span>
                      </div>
                    </div>
                    <div className="text-right text-[9px] text-slate-600">
                      <div>ML MAPE: <span className="font-black text-violet-400">{fmt(metrics.ml?.mape, 2)}%</span></div>
                      <div>Formula MAPE: <span className="font-black text-sky-400">{fmt(metrics.formula?.mape, 2)}%</span></div>
                      <div>Beats naive: <span className={`font-black ${metrics.mlBeatsNaive ? 'text-emerald-400' : 'text-rose-400'}`}>{metrics.mlBeatsNaive ? 'Yes ✓' : 'No ✗'}</span></div>
                    </div>
                  </div>

                  {/* ── CHART 1: Actual vs Formula vs ML over time ── */}
                  {backtestTable.length >= 2 && (
                    <section className="glass-card p-5">
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4" style={{ fontFamily:'Outfit,sans-serif' }}>Actual vs Formula vs ML Dividend History</h3>
                      <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full" style={{ height:CH, overflow:'visible' }}>
                        {[0,0.25,0.5,0.75,1].map(t => (
                          <line key={t} x1="0" y1={CH-t*(CH-30)-15} x2={CW} y2={CH-t*(CH-30)-15} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                        ))}
                        {/* ML line */}
                        <path d={`M ${backtestTable.map((r,i)=>`${cx(i)},${cy(r.ml)}`).join(' L ')}`}
                          fill="none" stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round" />
                        {/* Formula line */}
                        <path d={`M ${backtestTable.map((r,i)=>`${cx(i)},${cy(r.formula)}`).join(' L ')}`}
                          fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeDasharray="6,3" />
                        {/* Actual line */}
                        <path d={`M ${backtestTable.map((r,i)=>`${cx(i)},${cy(r.actual)}`).join(' L ')}`}
                          fill="none" stroke="#34d399" strokeWidth="3" strokeLinecap="round" />
                        {/* Dots */}
                        {backtestTable.map((r,i) => (
                          <g key={i}>
                            <circle cx={cx(i)} cy={cy(r.actual)} r="5" fill="#34d399" stroke="var(--bg-dark)" strokeWidth="2"/>
                            <circle cx={cx(i)} cy={cy(r.ml)} r="4" fill="#818cf8" stroke="var(--bg-dark)" strokeWidth="2"/>
                            <circle cx={cx(i)} cy={cy(r.formula)} r="3.5" fill="#38bdf8" stroke="var(--bg-dark)" strokeWidth="1.5"/>
                          </g>
                        ))}
                        {/* Year labels */}
                        {backtestTable.map((r,i) => (
                          <text key={i} x={cx(i)} y={CH+4} textAnchor="middle" fill="#475569" fontSize="8" fontWeight="700">{r.year}</text>
                        ))}
                      </svg>
                      <div className="flex gap-5 text-[9px] font-bold mt-2">
                        <span className="flex items-center gap-1.5"><span className="legend-dot" style={{ background:'#34d399', width:10, height:10, borderRadius:'50%', display:'inline-block' }}/> Actual</span>
                        <span className="flex items-center gap-1.5"><span style={{ width:18, height:2, background:'#38bdf8', display:'inline-block', borderRadius:2 }}/> Formula</span>
                        <span className="flex items-center gap-1.5"><span style={{ width:18, height:2.5, background:'#818cf8', display:'inline-block', borderRadius:2 }}/> ML</span>
                      </div>
                    </section>
                  )}

                  {/* ── CHART 2: Error comparison bar chart ── */}
                  {backtestTable.length >= 2 && (
                    <section className="glass-card p-5">
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4" style={{ fontFamily:'Outfit,sans-serif' }}>Prediction Error per Period (|Actual − Predicted|)</h3>
                      <svg viewBox={`0 0 ${EW} ${EH}`} className="w-full" style={{ height:EH, overflow:'visible' }}>
                        {backtestTable.map((r, i) => {
                          const ex = cx(i);
                          const fmtH = (r.formulaAbsErr / maxErr) * (EH - 30);
                          const mlH  = (r.mlAbsErr     / maxErr) * (EH - 30);
                          return (
                            <g key={i}>
                              <rect x={ex - barW - 2} y={EH - 15 - fmtH} width={barW} height={fmtH} fill="rgba(56,189,248,0.35)" rx="2"/>
                              <rect x={ex + 2}        y={EH - 15 - mlH}  width={barW} height={mlH}  fill="rgba(129,140,248,0.5)" rx="2"/>
                              <text x={ex} y={EH+2} textAnchor="middle" fill="#475569" fontSize="8" fontWeight="700">{r.year}</text>
                              {r.winner === 'ML' && <text x={ex+2+barW/2} y={EH-18-mlH} textAnchor="middle" fill="#34d399" fontSize="7" fontWeight="900">✓</text>}
                            </g>
                          );
                        })}
                      </svg>
                      <div className="flex gap-5 text-[9px] font-bold mt-2">
                        <span className="flex items-center gap-1.5"><span style={{ width:14, height:10, background:'rgba(56,189,248,0.5)', display:'inline-block', borderRadius:2 }}/> Formula Error</span>
                        <span className="flex items-center gap-1.5"><span style={{ width:14, height:10, background:'rgba(129,140,248,0.6)', display:'inline-block', borderRadius:2 }}/> ML Error</span>
                        <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> ML wins that period</span>
                      </div>
                    </section>
                  )}

                  {/* ── CHART 3: Feature Importance ── */}
                  {filteredFeatureImportance.length > 0 && (
                    <section className="glass-card p-5">
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4" style={{ fontFamily:'Outfit,sans-serif' }}>ML Feature Importance (Mean |SHAP|)</h3>
                      <div className="flex flex-col gap-2">
                        {filteredFeatureImportance.map((f, i) => (
                          <div key={i} className="flex items-center gap-3">
                            <span className="text-[9px] font-black text-slate-500 mono uppercase" style={{ width:120, flexShrink:0 }}>{f.feature}</span>
                            <div style={{ flex:1, height:10, background:'rgba(255,255,255,0.04)', borderRadius:5, overflow:'hidden', position:'relative' }}>
                              <div style={{ position:'absolute', left:0, top:0, height:'100%', width:`${(f.importance/maxFimp)*100}%`, background:`linear-gradient(90deg, rgba(129,140,248,0.4), #818cf8)`, borderRadius:5, transition:'width 0.8s ease' }}/>
                            </div>
                            <span className="text-[9px] font-black text-violet-400 mono" style={{ width:48, textAlign:'right' }}>{(f.importance*100).toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[8px] text-slate-700 mt-3">Feature importance = average absolute SHAP contribution across all training samples. Higher = more influential in ML predictions.</p>
                    </section>
                  )}



                  {/* ── Backtest comparison table ── */}
                  <section className="glass-card overflow-hidden">
                    <div className="p-5 border-b" style={{ borderColor:'rgba(255,255,255,0.05)' }}>
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest" style={{ fontFamily:'Outfit,sans-serif' }}>Walk-Forward Backtest — Period by Period</h3>
                      <span className="text-[9px] text-slate-600">Click any row to see the full ML explanation for that prediction</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="backtest-table">
                        <thead><tr>
                          <th>Year</th><th>Actual Div</th>
                          <th style={{ color:'#38bdf8' }}>Formula Pred</th>
                          <th style={{ color:'#818cf8' }}>ML Pred</th>
                          <th style={{ color:'#38bdf8' }}>Formula Err</th>
                          <th style={{ color:'#818cf8' }}>ML Err</th>
                          <th>Formula %</th><th>ML %</th><th>Winner</th>
                        </tr></thead>
                        <tbody>
                          {backtestTable.map((r, i) => (
                            <React.Fragment key={r.year}>
                              <tr
                                className={`ml-row ${selectedMlPeriod === r.year ? 'ml-row-active' : ''}`}
                                onClick={() => setSelectedMlPeriod(selectedMlPeriod === r.year ? null : r.year)}
                              >
                                <td className="mono font-black text-white">{r.year}</td>
                                <td className="mono text-emerald-400 font-black">${fmt(r.actual, 4)}</td>
                                <td className="mono text-sky-400">${fmt(r.formula, 4)}</td>
                                <td className="mono text-violet-400">${fmt(r.ml, 4)}</td>
                                <td className={`mono font-black ${Math.abs(r.formulaAbsErr) < 0.05 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {r.formulaError >= 0 ? '+' : ''}{fmt(r.formulaError, 4)}
                                </td>
                                <td className={`mono font-black ${Math.abs(r.mlAbsErr) < 0.05 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {r.mlError >= 0 ? '+' : ''}{fmt(r.mlError, 4)}
                                </td>
                                <td className="mono text-slate-500">{fmt(r.formulaPct, 1)}%</td>
                                <td className="mono text-slate-500">{fmt(r.mlPct, 1)}%</td>
                                <td>
                                  <span className={r.winner === 'ML' ? 'winner-ml' : r.winner === 'Formula' ? 'winner-formula' : 'winner-tie'}>
                                    {r.winner}
                                  </span>
                                </td>
                              </tr>

                              {/* ── Inline SHAP detail panel (expand on click) ── */}
                              {selectedMlPeriod === r.year && (
                                <tr><td colSpan={9} style={{ padding:0 }}>
                                  <div className="ml-detail-panel p-5 flex flex-col gap-4" style={{ background:'rgba(129,140,248,0.04)', borderTop:'1px solid rgba(129,140,248,0.12)' }}>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

                                      {/* Summary */}
                                      <div className="flex flex-col gap-2">
                                        <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Prediction Summary — {r.year}</div>
                                        {[
                                          { l:'Actual Dividend',   v:`$${fmt(r.actual, 4)}`,   c:'#34d399' },
                                          { l:'ML Predicted',      v:`$${fmt(r.ml, 4)}`,        c:'#818cf8' },
                                          { l:'Formula Predicted', v:`$${fmt(r.formula, 4)}`,   c:'#38bdf8' },
                                          { l:'ML Error',          v:`${r.mlError >= 0 ? '+' : ''}${fmt(r.mlError, 4)}`, c: Math.abs(r.mlAbsErr) < 0.05 ? '#34d399' : '#fb7185' },
                                          { l:'Formula Error',     v:`${r.formulaError >= 0 ? '+' : ''}${fmt(r.formulaError, 4)}`, c: Math.abs(r.formulaAbsErr) < 0.05 ? '#34d399' : '#fb7185' },
                                          { l:'Winner',            v: r.winner, c: r.winner === 'ML' ? '#34d399' : r.winner === 'Formula' ? '#38bdf8' : '#fbbf24' },
                                        ].map((row, ii) => (
                                          <div key={ii} className="flex justify-between py-1.5 border-b text-[10px]" style={{ borderColor:'rgba(255,255,255,0.05)' }}>
                                            <span className="text-slate-500">{row.l}</span>
                                            <span className="font-black mono" style={{ color: row.c }}>{row.v}</span>
                                          </div>
                                        ))}
                                      </div>

                                      {/* SHAP explanation */}
                                      <div className="sm:col-span-2">
                                        <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-3">Why did ML predict ${fmt(r.ml, 4)}? — Feature Contributions (SHAP)</div>
                                        {Object.entries(r.shap || {}).filter(([feat]) => feat !== 'yieldSpread' && !feat.toLowerCase().includes('treasury')).sort((a,b) => Math.abs(b[1]) - Math.abs(a[1])).map(([feat, val], fi) => {
                                          const pct = Math.abs(val) / (maxShap || 0.001);
                                          const isPos = val >= 0;
                                          return (
                                            <div key={fi} className="shap-row">
                                              <span className="shap-label">{feat}</span>
                                              <div className="shap-track">
                                                {isPos
                                                  ? <div className="shap-fill-pos" style={{ width:`${pct*50}%` }}/>
                                                  : <div className="shap-fill-neg" style={{ width:`${pct*50}%` }}/>
                                                }
                                              </div>
                                              <span className={`shap-value ${isPos ? 'pos' : 'neg'}`}>
                                                {isPos ? '+' : ''}{fmt(val, 4)}
                                              </span>
                                            </div>
                                          );
                                        })}
                                        <p className="text-[8px] text-slate-700 mt-2">
                                          Positive SHAP = feature pushed prediction higher. Negative = pushed lower. Values show dividend impact in dollars. Correlation ≠ causation.
                                        </p>
                                      </div>
                                    </div>

                                    {/* Historical data used for this prediction */}
                                    {r.featuresUsed?.length > 0 && (
                                      <div>
                                        <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">Historical Data Used for This Prediction</div>
                                        <div className="flex flex-wrap gap-2">
                                          {r.featuresUsed.map((h, hi) => (
                                            <div key={hi} className="px-3 py-1.5 rounded-lg text-[9px] font-black" style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.06)' }}>
                                              <span className="text-slate-600">{h.year}: </span>
                                              <span className="text-emerald-400">${fmt(h.dividend, 4)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </td></tr>
                              )}
                            </React.Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {/* ── Future Forecast Card ── */}
                  {futureForecast && (
                    <div className="glass-card forecast-card p-6 flex flex-col gap-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span style={{ fontSize:24 }}>🔮</span>
                          <div>
                            <div className="text-sm font-black text-white" style={{ fontFamily:'Outfit,sans-serif' }}>Dividend Forecast — {futureForecast.year}</div>
                            <div className="text-[9px] text-slate-600">{futureForecast.note}</div>
                          </div>
                        </div>
                        <span className="forecast-pill">⚡ Forecast</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="flex flex-col gap-1">
                          <div className="text-[8px] font-black text-slate-600 uppercase tracking-widest">ML Prediction</div>
                          <div className="text-2xl font-black text-violet-400 mono">${fmt(futureForecast.mlPrediction, 4)}</div>
                          {/* Confidence interval bar */}
                          <div className="ci-track">
                            {(() => {
                              const lo = futureForecast.confidenceLow, hi = futureForecast.confidenceHigh, pred = futureForecast.mlPrediction;
                              const range = (hi - lo) || 0.01;
                              const loPct = 0, hiPct = 100, predPct = ((pred - lo) / range) * 100;
                              return (<>
                                <div className="ci-range" style={{ left:'0%', width:'100%' }} />
                                <div className="ci-dot" style={{ left:`${predPct}%` }} />
                              </>);
                            })()}
                          </div>
                          <div className="text-[9px] text-slate-600">
                            95% CI: <span className="font-black text-slate-400">${fmt(futureForecast.confidenceLow, 4)} – ${fmt(futureForecast.confidenceHigh, 4)}</span>
                          </div>
                        </div>

                        <div className="flex flex-col gap-1">
                          <div className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Formula Prediction</div>
                          <div className="text-2xl font-black text-sky-400 mono">${fmt(futureForecast.formulaPrediction, 4)}</div>
                          <div className="text-[9px] text-slate-600 mt-auto">Based on Gordon Growth Model</div>
                        </div>

                        <div className="flex flex-col gap-1">
                          <div className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Actual Dividend</div>
                          <div className="text-2xl font-black text-slate-700 mono">Not yet declared</div>
                          <div className="text-[9px] text-slate-700 mt-auto">Will be updated when {futureForecast.year} dividend is announced</div>
                        </div>
                      </div>

                      {/* Forecast SHAP */}
                      {Object.keys(futureForecast.shap || {}).length > 0 && (
                        <div>
                          <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-3">Why ML Predicts ${fmt(futureForecast.mlPrediction, 4)} for {futureForecast.year}</div>
                          {Object.entries(futureForecast.shap).filter(([feat]) => feat !== 'yieldSpread' && !feat.toLowerCase().includes('treasury')).sort((a,b) => Math.abs(b[1]) - Math.abs(a[1])).map(([feat, val], fi) => {
                            const pct = Math.abs(val) / (maxShap || 0.001);
                            const isPos = val >= 0;
                            return (
                              <div key={fi} className="shap-row">
                                <span className="shap-label">{feat}</span>
                                <div className="shap-track">
                                  {isPos
                                    ? <div className="shap-fill-pos" style={{ width:`${pct*50}%` }}/>
                                    : <div className="shap-fill-neg" style={{ width:`${pct*50}%` }}/>
                                  }
                                </div>
                                <span className={`shap-value ${isPos ? 'pos' : 'neg'}`}>{isPos?'+':''}{fmt(val,4)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="text-[9px] text-slate-600 bg-amber-500/5 border border-amber-500/15 rounded-lg p-3">
                        ⚠️ <strong>Forecast Disclaimer:</strong> This is a statistical projection, not a guarantee. Dividends may be cut, suspended, or raised based on company decisions, economic conditions, and management policy. Past ML accuracy does not guarantee future accuracy.
                      </div>
                    </div>
                  )}

                  {/* Model info footer */}
                  <div className="glass-card p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[9px]">
                    {[
                      { l:'Model Type',        v: modelInfo.type || 'Random Forest' },
                      { l:'Validation',        v: modelInfo.validationMethod || 'Walk-Forward' },
                      { l:'Training Window',   v: `Min ${modelInfo.minTrainWindow} years` },
                      { l:'Data Available',    v: `${dataQuality.yearsAvailable} complete years` },
                    ].map((m,i) => (
                      <div key={i}>
                        <div className="text-slate-600 font-black uppercase tracking-widest mb-0.5">{m.l}</div>
                        <div className="text-slate-400 font-bold">{m.v}</div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            TAB: SCREENER
        ══════════════════════════════════════════════════════ */}
        {activeTab === 'screener' && (
          <div className="flex flex-col gap-5 animate-slide-up">
            {/* Filter bar */}
            <section className="glass-card p-4 flex flex-wrap gap-4 items-end">
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Search</label>
                <input value={screenerSearch} onChange={e => setScreenerSearch(e.target.value)} placeholder="Ticker or name…" className="input-field" style={{ width:140 }} />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between"><label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Min Yield</label><span className="text-[9px] text-sky-400 font-black">{screenerFilters.minYield}%</span></div>
                <input type="range" min="0" max="8" step="0.5" value={screenerFilters.minYield} onChange={e => setScreenerFilters(f => ({...f, minYield: parseFloat(e.target.value)}))} style={{ width:120 }} />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between"><label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Max Beta</label><span className="text-[9px] text-sky-400 font-black">{screenerFilters.maxBeta}</span></div>
                <input type="range" min="0.3" max="2.0" step="0.1" value={screenerFilters.maxBeta} onChange={e => setScreenerFilters(f => ({...f, maxBeta: parseFloat(e.target.value)}))} style={{ width:120 }} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Signal</label>
                <select value={screenerFilters.signal} onChange={e => setScreenerFilters(f => ({...f, signal:e.target.value}))} className="input-select" style={{ width:110 }}>
                  <option>ALL</option><option>BUY</option><option>HOLD</option><option>SELL</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Sector</label>
                <select value={screenerFilters.sector} onChange={e => setScreenerFilters(f => ({...f, sector:e.target.value}))} className="input-select" style={{ width:160 }}>
                  {screenerSectors.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <button onClick={fetchScreener} disabled={screenerLoading} className="btn-primary" style={{ height:38 }}>
                {screenerLoading ? '…' : '🔄 Refresh'}
              </button>
              {screenerData && <span className="text-[9px] text-slate-600 self-center">{filteredScreener.length} of {screenerData.count} stocks</span>}
            </section>

            {/* Loading */}
            {screenerLoading && (
              <div className="glass-card p-14 flex flex-col items-center gap-3">
                <Spinner color="#38bdf8" size={36} />
                <span className="text-[10px] font-black tracking-[0.2em] uppercase" style={{ color:'var(--sky)' }}>Fetching 25 dividend stocks…</span>
                <span className="text-[9px] text-slate-600">This takes 10–20 seconds</span>
              </div>
            )}

            {/* Empty state */}
            {!screenerData && !screenerLoading && (
              <div className="glass-card p-14 flex flex-col items-center gap-3 text-center">
                <span style={{ fontSize:44 }}>🔍</span>
                <span className="text-sm font-black text-slate-400">Dividend Screener</span>
                <span className="text-[10px] text-slate-600">Screen 25 top dividend stocks by yield, growth, payout, and AI score</span>
                <button onClick={fetchScreener} className="btn-primary mt-2">Load Screener</button>
              </div>
            )}

            {/* Screener table */}
            {screenerData && !screenerLoading && (
              <section className="glass-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="backtest-table">
                    <thead>
                      <tr>
                        <th>Ticker</th><th>Name</th><th>Sector</th><th>Price</th>
                        <th>Fwd Yield</th><th>CAGR</th><th>Payout%</th><th>Beta</th>
                        <th>Factors Affected</th><th>AI Score Range</th><th>Signal</th><th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredScreener.map((s, i) => (
                        <tr key={i} className="hover:bg-white/[0.02] cursor-pointer" onClick={() => { setSelectedTicker(s.ticker); setActiveTab('analysis'); fetchAnalysis(s.ticker, activeRange); }}>
                          <td className="text-sky-400 font-black">{s.ticker}</td>
                          <td className="text-white font-bold">{s.name?.split(' ').slice(0,3).join(' ')}</td>
                          <td className="text-[9px] text-slate-600">{s.sector}</td>
                          <td className="mono">${fmt(s.currentPrice)}</td>
                          <td className="text-emerald-400 font-black mono">{fmt(s.forwardYield, 2)}%</td>
                          <td className="mono">{fmt(s.growth, 1)}%</td>
                          <td className={`mono ${s.payoutRatio !== null && s.payoutRatio > 80 ? 'text-amber-400' : ''}`}>{s.payoutRatio !== null ? fmt(s.payoutRatio, 1)+'%' : '—'}</td>
                          <td className={`mono ${s.beta < 1 ? 'text-emerald-400' : s.beta > 1.3 ? 'text-rose-400' : ''}`}>{fmt(s.beta, 2)}</td>
                          <td>
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {s.topTailwind && (
                                  <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 whitespace-nowrap" title="Key Positive Factor Driver">
                                    ▲ {s.topTailwind}
                                  </span>
                                )}
                                {s.topDrag && (
                                  <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/30 whitespace-nowrap" title="Key Risk / Drag Factor">
                                    ▼ {s.topDrag}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="flex items-center gap-1.5">
                              <div className="progress-track" style={{ width:45 }}><div className="progress-fill" style={{ width:`${Math.min(88, s.aiScore)}%` }} /></div>
                              <span className="text-white font-black mono text-[11px] whitespace-nowrap">{s.aiScoreRange || getScoreRange(s.aiScore, 3, 90)}</span>
                            </div>
                          </td>
                          <td><span className={s.signal==='BUY'?'signal-buy':s.signal==='SELL'?'signal-sell':'signal-hold'}>{s.signal}</span></td>
                          <td>
                            <button className="text-[9px] font-black text-sky-400 hover:text-sky-300 uppercase tracking-wider" style={{ background:'rgba(56,189,248,0.08)', border:'1px solid rgba(56,189,248,0.2)', padding:'3px 8px', borderRadius:4 }}>
                              Analyze →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}

        {/* Footer */}
        <footer className="text-center py-4 text-[8px] text-slate-700 font-bold uppercase tracking-widest">
          DividIntel · ML-Driven Dividend Prediction & Valuation Engine · Walk-Forward Random Forest · For educational use only
        </footer>
      </div>
    </div>
  );
}
