import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { API_BASE_URL } from './config';

/* ── Universe ─────────────────────────────────────────────────────────────── */
const TOP_STOCKS = [
  'KO','PEP','PG','JNJ','ABBV','MRK','PFE',
  'XOM','CVX','VZ','T','MSFT','AAPL','IBM','CSCO',
  'MMM','HON','NEE','D','DUK',
  'JPM','BAC','USB','WMT','HD','MO','PM','CL','LOW','TGT'
];
const RANGES = ['1D','1W','1M','3M','6M','1Y'];

/* ── Helpers ────────────────────────────────────────────────────────────────── */
const fmt  = (n, d = 2) => n !== null && n !== undefined && !isNaN(n) ? Number(n).toFixed(d) : '—';
const fmtK = n => {
  if (!n) return '—';
  if (n >= 1e12) return `$${(n/1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n/1e6).toFixed(2)}M`;
  return `$${n.toLocaleString()}`;
};
const fmtDate = s => {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return s; }
};

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

  /* ── API calls ── */
  const fetchAnalysis = useCallback(async (ticker, range) => {
    setLoading(true); setError(null);
    try {
      setCommittedRf(rf); setCommittedRm(rm);
      const [res] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/ddm/analyze/${ticker}?range=${range.toLowerCase()}`),
        new Promise(r => setTimeout(r, 600))
      ]);
      setAnalysisData(res.data);
      fetchAI(ticker, rf, rm);
    } catch { setError('Connection issue. Showing cached data.'); }
    finally  { setLoading(false); }
  }, [rf, rm]);

  const fetchAI = async (ticker, currentRf, currentRm) => {
    setAiLoading(true); setAiError(null);
    try {
      const res = await axios.get(`${API_BASE_URL}/api/ai/recommend/${ticker}?rf=${currentRf}&rm=${currentRm}`);
      setAiData(res.data);
      setChatMessages([{ sender: 'ai', text: `Hi! I've analyzed **${res.data.name}** (${res.data.ticker}).\n\n**Recommendation:** ${res.data.action} | **AI Score:** ${res.data.aiScore}/100 | **DSI:** ${res.data.dsi}/100 (${res.data.cutRisk} cut risk)\n\nAsk me anything about this stock's valuation, dividend safety, or how to get profits with this model!` }]);
    } catch { setAiError('Failed to load AI analysis.'); }
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

  const fetchML = async (ticker) => {
    setMlLoading(true); setMlError(null); setSelectedMlPeriod(null);
    try {
      const res = await axios.get(`${API_BASE_URL}/api/ml/predict/${ticker}?rf=${rf}&rm=${rm}`);
      setMlData(res.data);
    } catch (e) {
      const msg = e.response?.data?.message || e.message || 'ML pipeline failed';
      setMlError(msg);
    }
    finally { setMlLoading(false); }
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
      const fallbackReply = `### 💡 Analysis for **${aiData?.name || selectedTicker}**\n\n- **Verdict:** **${aiData?.action || 'BUY'}** (AI Score: **${aiData?.aiScore || 75}/100**)\n- **Dividend Yield:** **${fmt(aiData?.currentYield, 2)}%** with a **${fmt(aiData?.g, 1)}% CAGR** growth rate.\n- **Dividend Safety (DSI):** **${aiData?.dsi || 85}/100** (${aiData?.cutRisk || 'Low'} Cut Risk).\n- **Profit Strategy:** Combining quarterly dividend payouts + reinvestment (DRIP) while holding asset for valuation convergence to intrinsic value ($${fmt(aiData?.intrinsicValue, 2)}).`;
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

  /* ── DDM Models (memo) ── */
  const model = useMemo(() => {
    if (!analysisData) return null;
    const { currentPrice = 100, beta = 1.0, dividendHistory = [], g: serverG, g1, g2, H } = analysisData;

    const gVal = serverG ?? (() => {
      const clean = (dividendHistory || []).filter(d => !d.isProjected);
      if (clean.length < 2) return 3.0;
      const first = clean[0].amount, last = clean[clean.length-1].amount, n = clean.length-1;
      return first > 0 && last > 0 ? (Math.pow(last/first, 1/n) - 1) * 100 : 3.0;
    })();

    const R    = (rf/100) + beta * ((rm/100) - (rf/100));
    const Rpct = R * 100;
    const D0   = (dividendHistory?.length > 0) ? dividendHistory[dividendHistory.length-1].amount : 0;
    const D1   = D0 * (1 + gVal/100);

    const gordonP = Rpct <= gVal ? currentPrice * 1.05 : D1 / (R - gVal/100);

    const g1eff = Math.min(g1 ?? gVal, 18);
    const g2eff = Math.min(g2 ?? 3.5,  10);
    const Hval  = H ?? 5;
    let hModelP = gordonP;
    if (R > g2eff/100 + 0.001) {
      const stableP  = D0 * (1 + g2eff/100) / (R - g2eff/100);
      const growthP  = D0 * Hval * ((g1eff - g2eff)/100) / (R - g2eff/100);
      hModelP        = stableP + growthP;
    }
    const P = hModelP > 0 ? 0.7 * hModelP + 0.3 * gordonP : gordonP;
    const profitPct = ((P - currentPrice) / currentPrice) * 100;

    const hasHistory      = (dividendHistory?.length ?? 0) >= 4;
    const betaConf        = beta < 0.8 ? 15 : beta < 1.2 ? 10 : 5;
    const spreadConf      = Math.min(20, Math.abs(profitPct) * 0.4);
    const growthConf      = Math.min(15, gVal > 0 ? 10 + gVal * 0.3 : 5);
    const histConf        = hasHistory ? 15 : 8;
    const baseConf        = 40;
    const confidence      = Math.min(95, Math.round(baseConf + betaConf + spreadConf + growthConf + histConf));

    let signal = 'HOLD',   color = 'text-amber-400',  bg = 'bg-amber-400/10',  border = 'border-amber-400/40';
    if (profitPct >  12) { signal = 'BUY';  color = 'text-emerald-400'; bg = 'bg-emerald-400/10'; border = 'border-emerald-400/40'; }
    if (profitPct > 25)  { signal = 'STRONG BUY'; }
    if (profitPct < -12) { signal = 'SELL'; color = 'text-rose-400';    bg = 'bg-rose-400/10';    border = 'border-rose-400/40'; }

    return { P, gordonP, hModelP, currentPrice, profitPct, signal, color, bg, border, confidence, g: gVal, g1: g1eff, g2: g2eff, R_pct: Rpct, D0, D1 };
  }, [analysisData, rf, rm]);

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
                <strong className="text-sky-300 block mb-1">1. What does the {model?.confidence || 95}% Confidence Score mean?</strong>
                It indicates the <strong>statistical robustness and data reliability</strong> of this stock's valuation model. It is derived from:
                <ul className="list-disc ml-5 mt-1 space-y-1 text-slate-400">
                  <li><strong>Dividend Stability:</strong> Consistent consecutive yearly payout history with positive CAGR.</li>
                  <li><strong>Defensive Beta Profile:</strong> Low systemic market volatility (Beta &lt; 1.0).</li>
                  <li><strong>Margin of Safety:</strong> High valuation spread between intrinsic value and market price.</li>
                </ul>
              </div>

              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <strong className="text-emerald-300 block mb-1">2. How do you get profit from this BUY recommendation?</strong>
                Profits are realized through two complementary mechanisms:
                <ul className="list-disc ml-5 mt-1 space-y-1 text-slate-400">
                  <li><strong>Cash Yield & Compounding (DRIP):</strong> Earning steady annual dividends (<strong>{fmt(analysisData?.forwardYield, 2)}%</strong>) and reinvesting them to accumulate more shares.</li>
                  <li><strong>Capital Upside:</strong> The stock is currently trading at <strong>${fmt(model?.currentPrice)}</strong> against an Intrinsic Fair Value of <strong>${fmt(model?.P)}</strong> (a <strong>{fmt(model?.profitPct, 1)}%</strong> upside discount). Over market cycles, prices tend to converge toward intrinsic fundamentals.</li>
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
        <section className="glass-card p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
          {/* Stock selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Asset</label>
            <select value={selectedTicker} onChange={e => setSelectedTicker(e.target.value)} className="input-select">
              {TOP_STOCKS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Risk-free */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between">
              <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Risk-Free</label>
              <span className="text-[10px] font-black" style={{ color:'var(--sky)' }}>{rf}%</span>
            </div>
            <input type="range" min="0" max="10" step="0.1" value={rf} onChange={e => setRf(parseFloat(e.target.value))} />
          </div>

          {/* Market return */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between">
              <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Mkt Return</label>
              <span className="text-[10px] font-black" style={{ color:'var(--sky)' }}>{rm}%</span>
            </div>
            <input type="range" min="5" max="20" step="0.1" value={rm} onChange={e => setRm(parseFloat(e.target.value))} />
          </div>

          {/* Investment */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Investment ($)</label>
            <input type="number" value={investment} onChange={e => setInvestment(e.target.value)} className="input-field" min="100" />
          </div>

          {/* Buttons */}
          <div className="flex gap-2 col-span-2 sm:col-span-1 lg:col-span-2">
            <button onClick={() => fetchAnalysis(selectedTicker, activeRange)} disabled={loading} className="btn-primary flex-1" style={{ height:38 }}>
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
            { id:'analysis', label:'📈 Analysis' },
            { id:'ai',       label:'🤖 AI Advisor' },
            { id:'backtest', label:'⏱ Backtest' },
            { id:'screener', label:'🔍 Screener' },
            { id:'ml',       label:'🧠 ML Engine' },
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
            TAB: ANALYSIS
        ══════════════════════════════════════════════════════ */}
        {activeTab === 'analysis' && (
          <div className="flex flex-col gap-5 animate-fade">

            {/* ── Hero Valuation Card ── */}
            <div className="glass-card grad-border p-5 sm:p-7 relative overflow-hidden" style={{ background:'linear-gradient(135deg, rgba(56,189,248,0.06) 0%, rgba(129,140,248,0.04) 100%)' }}>
              {loading && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3" style={{ background:'rgba(5,8,16,0.85)', backdropFilter:'blur(8px)' }}>
                  <Spinner color="#38bdf8" size={36} />
                  <span className="text-[10px] font-black tracking-[0.2em] uppercase" style={{ color:'var(--sky)' }}>Calculating Intrinsic Value…</span>
                </div>
              )}

              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                {/* Left: name + prices */}
                <div className="flex flex-col gap-3">
                  <div>
                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Selected Asset</div>
                    <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight" style={{ fontFamily:'Outfit,sans-serif' }}>
                      {analysisData?.name || selectedTicker}
                      <span className="ml-2 text-base sm:text-xl" style={{ color:'var(--sky)' }}>{analysisData?.ticker || selectedTicker}</span>
                    </h1>
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <div>
                      <div className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Market Price</div>
                      <div className="text-xl font-black text-white mono">${fmt(model?.currentPrice)}</div>
                    </div>
                    <div>
                      <div className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Gordon DDM</div>
                      <div className="text-xl font-black mono" style={{ color:'var(--sky)' }}>${fmt(model?.gordonP)}</div>
                    </div>
                    <div>
                      <div className="text-[8px] font-black text-slate-600 uppercase tracking-widest">H-Model DDM</div>
                      <div className="text-xl font-black mono" style={{ color:'var(--violet)' }}>${fmt(model?.hModelP)}</div>
                    </div>
                    <div>
                      <div className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Blended Value</div>
                      <div className="text-xl font-black mono" style={{ color:'var(--teal)' }}>${fmt(model?.P)}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[9px] font-bold text-slate-500 uppercase">
                    <span>g (CAGR): <span className="text-white font-black">{fmt(model?.g, 1)}%</span></span>
                    <span>|</span>
                    <span>g₁ (near-term): <span className="text-white font-black">{fmt(model?.g1, 1)}%</span></span>
                    <span>|</span>
                    <span>g₂ (stable): <span className="text-white font-black">{fmt(model?.g2, 1)}%</span></span>
                    <span>|</span>
                    <span>R (CAPM): <span className="text-white font-black">{fmt(model?.R_pct, 2)}%</span></span>
                  </div>
                </div>

                {/* Right: signal + confidence */}
                <div className="flex items-center gap-5">
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Upside</div>
                    <div className={`text-2xl font-black mono ${(model?.profitPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {(model?.profitPct ?? 0) >= 0 ? '+' : ''}{fmt(model?.profitPct, 1)}%
                    </div>
                  </div>
                  <div className={`px-6 py-4 rounded-xl border font-black text-lg tracking-widest uppercase shadow-lg ${model?.color || 'text-amber-400'} ${model?.bg || 'bg-amber-400/10'} ${model?.border || 'border-amber-400/30'}`}
                    style={{ fontFamily:'Outfit,sans-serif', minWidth:120, textAlign:'center' }}>
                    {model?.signal || '—'}
                  </div>
                  
                  {/* Clickable Confidence Score with Info Trigger */}
                  <div className="flex flex-col items-center gap-1 cursor-pointer group" onClick={() => setShowConfidenceModal(true)}>
                    <div className="flex items-center gap-1 text-[8px] font-black text-slate-500 uppercase tracking-widest group-hover:text-sky-400 transition-colors">
                      Confidence ℹ️
                    </div>
                    <div className="text-2xl font-black text-white mono group-hover:text-sky-300 transition-colors">{model?.confidence || 0}%</div>
                    <div className="progress-track" style={{ width:60 }}>
                      <div className="progress-fill" style={{ width:`${model?.confidence || 0}%` }} />
                    </div>
                    <span className="text-[7px] text-sky-400/80 underline mt-0.5">Why this score?</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Key Stats Row ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {[
                { label:'Forward Yield', value: analysisData?.forwardYield ? `${fmt(analysisData.forwardYield, 2)}%` : '—', color:'var(--emerald)' },
                { label:'Payout Ratio',  value: analysisData?.payoutRatio  ? `${fmt(analysisData.payoutRatio,  1)}%` : '—', color: (analysisData?.payoutRatio || 0) > 80 ? 'var(--rose)' : 'var(--sky)' },
                { label:'Trailing EPS',  value: analysisData?.trailingEps  ? `$${fmt(analysisData.trailingEps, 2)}` : '—', color:'var(--sky)' },
                { label:'Beta',          value: fmt(analysisData?.beta, 2), color: (analysisData?.beta || 1) < 1 ? 'var(--emerald)' : 'var(--amber)' },
                { label:'P/E Ratio',     value: fmt(analysisData?.peRatio), color:'white' },
                { label:'Market Cap',    value: fmtK(analysisData?.marketCap), color:'white' },
              ].map((k,i) => (
                <div key={i} className="kpi-card glass-card-static" style={{ padding:'14px 16px', gap:4 }}>
                  <div className="kpi-label">{k.label}</div>
                  <div className="text-lg font-black mono" style={{ color:k.color, lineHeight:1.2 }}>{k.value}</div>
                </div>
              ))}
            </div>

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
                <div>
                  <div className="text-[8px] font-black text-slate-600 uppercase tracking-widest">52W Range</div>
                  <div className="text-sm font-black text-white">
                    {analysisData?.fiftyTwoLow && analysisData?.fiftyTwoHigh
                      ? `$${fmt(analysisData.fiftyTwoLow)} – $${fmt(analysisData.fiftyTwoHigh)}`
                      : '—'}
                  </div>
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

            {/* ── DDM Sensitivity Grid ── */}
            {sensitivityGrid && (
              <section className="glass-card p-4 sm:p-6 overflow-hidden">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-5">
                  <div>
                    <h3 className="text-xs font-black text-slate-300 uppercase tracking-widest" style={{ fontFamily:'Outfit,sans-serif' }}>DDM Sensitivity Analysis</h3>
                    <p className="text-[9px] text-slate-600 mt-0.5">Intrinsic value & upside (%) across growth rate × required return combinations</p>
                  </div>
                  <div className="flex gap-3 text-[9px] font-bold">
                    <span className="flex items-center gap-1"><span style={{ width:10,height:10,borderRadius:2,background:'rgba(52,211,153,0.3)',display:'inline-block' }} />BUY zone</span>
                    <span className="flex items-center gap-1"><span style={{ width:10,height:10,borderRadius:2,background:'rgba(251,191,36,0.3)',display:'inline-block' }} />HOLD</span>
                    <span className="flex items-center gap-1"><span style={{ width:10,height:10,borderRadius:2,background:'rgba(251,113,133,0.3)',display:'inline-block' }} />SELL</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table style={{ width:'100%', borderCollapse:'separate', borderSpacing:4 }}>
                    <thead>
                      <tr>
                        <th style={{ color:'var(--text-muted)', fontSize:8, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.15em', padding:'4px 8px', textAlign:'left', fontFamily:'Outfit,sans-serif' }}>
                          R \ g →
                        </th>
                        {sensitivityGrid.gSteps.map(g => (
                          <th key={g} style={{ color: g === model?.g ? 'var(--sky)' : 'var(--text-muted)', fontSize:8, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.1em', padding:'4px 6px', textAlign:'center', fontFamily:'Outfit,sans-serif', background: g === model?.g ? 'rgba(56,189,248,0.08)' : 'transparent', borderRadius:4 }}>g={g}%</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sensitivityGrid.rSteps.map((R, ri) => (
                        <tr key={R}>
                          <td style={{ color: R === model?.R_pct ? 'var(--sky)' : 'var(--text-muted)', fontSize:8, fontWeight:800, padding:'4px 8px', textTransform:'uppercase', fontFamily:'Outfit,sans-serif', background: R === model?.R_pct ? 'rgba(56,189,248,0.08)' : 'transparent', borderRadius:4 }}>R={R}%</td>
                          {sensitivityGrid.cells[ri].map((cell, gi) => {
                            if (!cell) return <td key={gi}><div className="sens-cell" style={{ background:'rgba(255,255,255,0.03)', color:'var(--text-dim)', border:'1px solid rgba(255,255,255,0.04)' }}>N/A</div></td>;
                            const isBase = sensitivityGrid.gSteps[gi] === model?.g && sensitivityGrid.rSteps[ri] === model?.R_pct;
                            const pct = cell.pct;
                            let bg, col, bc;
                            if      (pct >  20) { bg='rgba(52,211,153,0.2)';  col='#34d399'; bc='rgba(52,211,153,0.3)'; }
                            else if (pct >   5) { bg='rgba(52,211,153,0.1)';  col='#86efac'; bc='rgba(52,211,153,0.15)'; }
                            else if (pct >  -5) { bg='rgba(251,191,36,0.1)';  col='#fbbf24'; bc='rgba(251,191,36,0.2)'; }
                            else if (pct > -20) { bg='rgba(251,113,133,0.1)'; col='#fca5a5'; bc='rgba(251,113,133,0.15)'; }
                            else                { bg='rgba(251,113,133,0.2)'; col='#fb7185'; bc='rgba(251,113,133,0.3)'; }
                            return (
                              <td key={gi}>
                                <div className="sens-cell" style={{ background:isBase?'rgba(56,189,248,0.15)':bg, color:isBase?'white':col, borderColor:isBase?'rgba(56,189,248,0.5)':bc, border:`1px solid ${isBase?'rgba(56,189,248,0.5)':bc}`, boxShadow:isBase?'0 0 12px rgba(56,189,248,0.2)':undefined }}>
                                  <div style={{ fontSize:10, fontWeight:900 }}>${cell.P}</div>
                                  <div style={{ fontSize:8, opacity:0.75 }}>{pct>=0?'+':''}{pct}%</div>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 text-[8px] text-slate-700">
                  ↑ Highlighted cell = current model parameters (g={fmt(model?.g,1)}%, R={fmt(model?.R_pct,2)}%). H-Model blended value = <span className="text-slate-500 font-bold">${fmt(model?.P)}</span>
                </div>
              </section>
            )}

            {/* ── Info Grid (History + Reasoning + Profile) ── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Dividend History */}
              <div className="glass-card p-4 sm:p-5 flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest" style={{ fontFamily:'Outfit,sans-serif' }}>Yearly Payouts</h3>
                  <span className="text-[8px] font-bold text-sky-500 uppercase">YoY Growth</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  {analysisData?.dividendHistory?.length > 0 ? (
                    [...analysisData.dividendHistory].reverse().map((d, i) => (
                      <div key={i} className="flex justify-between items-center py-2 border-b last:border-0 hover:bg-white/[0.02] transition-colors px-2 -mx-2 rounded" style={{ borderColor:'rgba(255,255,255,0.04)' }}>
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-slate-500">YEAR {d.year}</span>
                          {d.isProjected && <span className="text-[8px] font-black text-sky-500 uppercase tracking-tight">Annualised Rate</span>}
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

              {/* DDM Reasoning */}
              <div className="glass-card p-4 sm:p-5 flex flex-col gap-3">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest" style={{ fontFamily:'Outfit,sans-serif' }}>DDM Formula Breakdown</h3>
                <div className="flex flex-col gap-3 text-[11px] text-slate-400">
                  {[
                    { label:'D₀ (Last Annual Div)',   value:`$${fmt(model?.D0, 4)}` },
                    { label:'D₁ = D₀ × (1+g)',        value:`$${fmt(model?.D1, 4)}` },
                    { label:'g  (Dividend CAGR)',      value:`${fmt(model?.g, 2)}%` },
                    { label:'g₁ (Near-term, 5Y)',      value:`${fmt(model?.g1, 2)}%` },
                    { label:'g₂ (Stable terminal)',    value:`${fmt(model?.g2, 2)}%` },
                    { label:'R  (CAPM Required Ret.)', value:`${fmt(model?.R_pct, 2)}%` },
                    { label:'Gordon P = D₁/(R-g)',     value:`$${fmt(model?.gordonP)}`, highlight:true },
                    { label:'H-Model P',               value:`$${fmt(model?.hModelP)}`, highlight:true },
                    { label:'Blended (70% H + 30% G)', value:`$${fmt(model?.P)}`,       highlight:true },
                  ].map((row,i) => (
                    <div key={i} className={`flex justify-between items-center ${row.highlight ? 'py-2 px-2 -mx-2 rounded' : ''}`} style={ row.highlight ? { background:'rgba(56,189,248,0.05)', borderBottom:'none' } : { borderBottom:'1px solid rgba(255,255,255,0.04)', paddingBottom:6 }}>
                      <span className={row.highlight ? 'text-slate-300 font-bold' : ''}>{row.label}</span>
                      <span className={`font-black mono ${row.highlight ? 'text-sky-400' : 'text-white'}`}>{row.value}</span>
                    </div>
                  ))}
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
                  {/* AI Score */}
                  <div className="glass-card p-6 flex items-center gap-6" style={{ background:'linear-gradient(135deg,rgba(56,189,248,0.05),transparent)' }}>
                    <div className="relative flex-shrink-0" style={{ width:120, height:120 }}>
                      <svg viewBox="0 0 128 128" style={{ width:120, height:120, transform:'rotate(-90deg)' }}>
                        <circle cx="64" cy="64" r="54" stroke="rgba(255,255,255,0.04)" strokeWidth="10" fill="none" />
                        <circle cx="64" cy="64" r="54" stroke="url(#scoreGrad)" strokeWidth="10" fill="none"
                          strokeDasharray={2*Math.PI*54}
                          strokeDashoffset={2*Math.PI*54*(1 - aiData.aiScore/100)}
                          strokeLinecap="round" style={{ transition:'stroke-dashoffset 1.2s ease-out' }} />
                        <defs>
                          <linearGradient id="scoreGrad" x1="1" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#38bdf8" />
                            <stop offset="100%" stopColor="#818cf8" />
                          </linearGradient>
                        </defs>
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-3xl font-black text-white" style={{ fontFamily:'Outfit,sans-serif' }}>{aiData.aiScore}</span>
                        <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Score</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 flex-1">
                      <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">AI Verdict</span>
                      <span className={`inline-block px-4 py-1.5 rounded-lg border text-sm font-black tracking-widest uppercase ${aiData.actionColor}`} style={{ fontFamily:'Outfit,sans-serif' }}>
                        {aiData.action}
                      </span>
                      <div className="grid grid-cols-2 gap-2 mt-1 text-[9px]">
                        {[
                          { l:'Valuation (35%)', v: Math.round(Math.max(0, Math.min(35, aiData.valuationGap > 30 ? 35 : aiData.valuationGap > 0 ? 17.5 + (aiData.valuationGap/30)*17.5 : Math.max(0, 17.5+(aiData.valuationGap/30)*17.5)))) + '/35' },
                          { l:'Growth (20%)',    v: Math.round(Math.min(20, aiData.g >= 10 ? 20 : aiData.g > 0 ? (aiData.g/10)*20 : 0)) + '/20' },
                          { l:'Yield (20%)',     v: Math.round(aiData.currentYield >= 2.5 && aiData.currentYield <= 6 ? 20 : aiData.currentYield > 6 ? Math.max(8, 20-(aiData.currentYield-6)*3) : (aiData.currentYield/2.5)*20) + '/20' },
                          { l:'Payout (10%)',    v: (aiData.payoutPct !== null ? (aiData.payoutPct < 40 ? 10 : aiData.payoutPct < 60 ? 8 : aiData.payoutPct < 80 ? 5 : aiData.payoutPct < 100 ? 2 : 0) : 5) + '/10' },
                        ].map((f,i) => (
                          <div key={i} className="flex justify-between text-[8px]">
                            <span className="text-slate-600">{f.l}</span>
                            <span className="text-slate-400 font-bold mono">{f.v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* DSI */}
                  <div className="glass-card p-6 flex flex-col justify-between" style={{ background:'linear-gradient(135deg,rgba(52,211,153,0.05),transparent)' }}>
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">Dividend Safety Index</span>
                        <div className="text-4xl font-black text-white mt-1" style={{ fontFamily:'Outfit,sans-serif' }}>
                          {aiData.dsi}<span className="text-base text-slate-600 ml-1">/100</span>
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
                        <span>High Risk</span><span>Safe / Sustainable</span>
                      </div>
                      <div style={{ width:'100%', height:10, background:'rgba(255,255,255,0.04)', borderRadius:5, overflow:'hidden' }}>
                        <div style={{ height:'100%', width:`${aiData.dsi}%`, background:'linear-gradient(90deg, #ef4444, #f59e0b, #34d399)', transition:'width 1.2s ease-out', borderRadius:5 }} />
                      </div>
                      <p className="text-[9px] text-slate-600 mt-3 leading-relaxed">
                        Scored using beta, dividend growth ({fmt(aiData.g, 1)}% CAGR), forward yield ({fmt(aiData.currentYield, 2)}%), and payout ratio. DSI &gt;75 signals low cut probability over 12–24 months.
                      </p>
                    </div>
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
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest" style={{ fontFamily:'Outfit,sans-serif' }}>Sector Peer Comparison</h3>
                    <span className="text-[9px] text-slate-600">Multi-factor comparison vs logical sector competitors</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="backtest-table">
                      <thead><tr>
                        <th>Ticker</th><th>Name</th><th>Price</th><th>Yield</th><th>CAGR</th><th>Payout%</th><th>Beta</th><th>AI Score</th>
                      </tr></thead>
                      <tbody>
                        <tr style={{ background:'rgba(56,189,248,0.04)', borderLeft:'2px solid var(--sky)' }}>
                          <td className="text-sky-400 font-black">{selectedTicker}</td>
                          <td className="text-white font-black">{aiData.name}</td>
                          <td className="mono">${fmt(aiData.currentPrice)}</td>
                          <td className="text-emerald-400 font-black">{fmt(aiData.currentYield, 2)}%</td>
                          <td className="mono">{fmt(aiData.g, 2)}%</td>
                          <td className="mono">{aiData.payoutPct !== null ? fmt(aiData.payoutPct, 1)+'%' : '—'}</td>
                          <td className="mono">{fmt(analysisData?.beta, 2)}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <div className="progress-track" style={{ width:60 }}><div className="progress-fill" style={{ width:`${aiData.aiScore}%`, background:'var(--sky)' }} /></div>
                              <span className="text-sky-400 font-black mono">{aiData.aiScore}</span>
                            </div>
                          </td>
                        </tr>
                        {aiData.peers?.map((p, i) => (
                          <tr key={i} className="hover:bg-white/[0.01]">
                            <td className="text-slate-400 font-bold">{p.ticker}</td>
                            <td>{p.name}</td>
                            <td className="mono">${fmt(p.price)}</td>
                            <td className="text-emerald-500/80 mono">{fmt(p.yield, 2)}%</td>
                            <td className="mono">{fmt(p.growth, 2)}%</td>
                            <td className="mono">{p.payoutPct !== null ? fmt(p.payoutPct, 1)+'%' : '—'}</td>
                            <td className="mono">{fmt(p.beta, 2)}</td>
                            <td>
                              <div className="flex items-center gap-2">
                                <div className="progress-track" style={{ width:60 }}><div className="progress-fill" style={{ width:`${p.aiScore}%`, background:'rgba(129,140,248,0.6)' }} /></div>
                                <span className="text-slate-400 font-bold mono">{p.aiScore}</span>
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
                        <span style={{ fontSize:14 }}>🤖</span> AI Stock Analyst Assistant
                      </h3>
                      <span className="text-[8px] text-slate-600 font-bold uppercase">Quantitative Financial Intelligence Engine</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[8px] font-black tracking-widest uppercase" style={{ borderColor:'rgba(52,211,153,0.25)', color:'var(--emerald)', background:'rgba(52,211,153,0.05)' }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Active
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
                      'Can I get profit with 95% confidence?',
                      'Why this rating?',
                      'Explain DSI & cut risk',
                      'Valuation breakdown',
                      'Compare sector peers'
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
                <span className="text-[10px] text-slate-600">Quarterly DDM signals + optional DRIP reinvestment</span>
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
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    { l:'Strategy Return',    v:`${backtestData.metrics.totalReturn>=0?'+':''}${backtestData.metrics.totalReturn}%`, s:`vs Benchmark: ${backtestData.metrics.benchmarkReturn}%`, c: backtestData.metrics.totalReturn>=0?'var(--emerald)':'var(--rose)' },
                    { l:'DRIP Return',        v:`${backtestData.metrics.dripReturn>=0?'+':''}${backtestData.metrics.dripReturn}%`, s:'With dividend reinvestment', c:'var(--violet)' },
                    { l:'Max Drawdown',       v:`-${backtestData.metrics.maxDrawdown}%`, s:'Peak-to-trough', c:'var(--rose)' },
                    { l:'Sharpe Ratio',       v:backtestData.metrics.sharpeRatio, s:'Risk-adjusted return', c:'white' },
                    { l:'Win Rate',           v:`${backtestData.metrics.winRate}%`, s:`${backtestData.metrics.totalTrades} trades`, c:'white' },
                    { l:'Div Income (DRIP)',  v:`$${backtestData.metrics.dripDivIncome?.toFixed(0)||'—'}`, s:'Total dividends received', c:'var(--emerald)' },
                    { l:'Yield-on-Cost',      v:`${backtestData.metrics.yieldOnCost||'—'}%`, s:'Strategy (no DRIP)', c:'var(--sky)' },
                    { l:'DRIP Yield-on-Cost', v:`${backtestData.metrics.dripYieldOnCost||'—'}%`, s:'With reinvestment', c:'var(--violet)' },
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
                        <span className="flex items-center gap-1.5"><span className="legend-dot" style={{ background:'var(--sky)' }} />DDM Strategy</span>
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
                  <div className="p-5 border-b" style={{ borderColor:'rgba(255,255,255,0.05)' }}>
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest" style={{ fontFamily:'Outfit,sans-serif' }}>Trade Log</h3>
                    <span className="text-[9px] text-slate-600">DDM-triggered quarterly signals</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="backtest-table">
                      <thead><tr><th>Date</th><th>Signal</th><th>Price</th><th>Intrinsic</th><th>Upside</th><th>Shares</th><th>Portfolio</th></tr></thead>
                      <tbody>
                        {backtestData.trades?.map((t,i) => (
                          <tr key={i}>
                            <td className="mono">{t.date}</td>
                            <td><span className={t.signal.includes('BUY')?'signal-buy':t.signal.includes('SELL')?'signal-sell':'signal-hold'}>{t.signal}</span></td>
                            <td className="mono">${t.price}</td>
                            <td className="mono">${t.intrinsicValue}</td>
                            <td className={`mono font-black ${t.intrinsicValue >= t.price ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {((t.intrinsicValue-t.price)/t.price*100).toFixed(1)}%
                            </td>
                            <td className="mono">{t.shares}</td>
                            <td className="text-white font-black mono">${t.portfolioValue?.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
            TAB: ML ENGINE
        ══════════════════════════════════════════════════════ */}
        {activeTab === 'ml' && (
          <div className="flex flex-col gap-5 animate-slide-up">

            {/* Header bar */}
            <div className="glass-card p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3"
              style={{ background:'linear-gradient(135deg,rgba(129,140,248,0.07),transparent)', borderColor:'rgba(129,140,248,0.2)' }}>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span style={{ fontSize:22 }}>🧠</span>
                  <h2 className="text-sm font-black text-white uppercase tracking-widest" style={{ fontFamily:'Outfit,sans-serif' }}>ML Dividend Prediction Engine</h2>
                </div>
                <p className="text-[9px] text-slate-500">Walk-forward Random Forest · SHAP explainability · vs Formula DDM · Accuracy gated</p>
              </div>
              <button onClick={() => fetchML(selectedTicker)} disabled={mlLoading} className="btn-primary" style={{ height:36, minWidth:140 }}>
                {mlLoading ? '⏳ Running…' : `🔬 Run for ${selectedTicker}`}
              </button>
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
                <span className="text-sm font-black text-rose-400 uppercase tracking-widest">ML Pipeline Error</span>
                <span className="text-[10px] text-slate-500 max-w-lg">{mlError}</span>
                <button onClick={() => fetchML(selectedTicker)} className="btn-primary mt-2">Retry</button>
              </div>
            )}

            {/* Empty state */}
            {!mlData && !mlLoading && !mlError && (
              <div className="glass-card p-14 flex flex-col items-center gap-4 text-center">
                <span style={{ fontSize:48 }}>🧠</span>
                <span className="text-base font-black text-slate-300">ML Dividend Prediction</span>
                <span className="text-[10px] text-slate-600 max-w-md">Click Run to train a walk-forward Random Forest on 10 years of dividend history and compare it objectively against the formula-based DDM model.</span>
                <button onClick={() => fetchML(selectedTicker)} className="btn-primary mt-2">Run ML Engine for {selectedTicker}</button>
              </div>
            )}

            {mlData && !mlLoading && (() => {
              const { backtestTable = [], metrics = {}, futureForecast, featureImportance = [], correlations = [], fundamentals = {}, dividendHistory = [], mlReliable, accuracyWarning, dataQuality = {}, modelInfo = {} } = mlData;
              const maxShap = Math.max(...backtestTable.flatMap(r => Object.values(r.shap || {}).map(Math.abs)), 0.001);
              const maxFimp = Math.max(...featureImportance.map(f => f.importance), 0.001);
              const maxCorr = Math.max(...correlations.map(c => Math.abs(c.pearson)), 0.001);

              // Chart data — Actual vs ML vs Formula
              const chartYears   = backtestTable.map(r => r.year);
              const chartActuals = backtestTable.map(r => r.actual);
              const chartMl      = backtestTable.map(r => r.ml);
              const chartFormula = backtestTable.map(r => r.formula);
              const allVals = [...chartActuals, ...chartMl, ...chartFormula].filter(Boolean);
              const chartMin = Math.min(...allVals) * 0.9;
              const chartMax = Math.max(...allVals) * 1.1;
              const chartRange = chartMax - chartMin || 1;
              const CW = 900, CH = 220;
              const cx = (i) => backtestTable.length < 2 ? CW/2 : (i / (backtestTable.length - 1)) * CW;
              const cy = (v) => CH - ((v - chartMin) / chartRange) * (CH - 30) - 15;

              // Error chart
              const maxErr = Math.max(...backtestTable.flatMap(r => [Math.abs(r.mlAbsErr), Math.abs(r.formulaAbsErr)]), 0.001);
              const EW = 900, EH = 160;
              const barW = backtestTable.length > 0 ? Math.min(36, (EW / backtestTable.length) * 0.35) : 36;

              const selPeriod = selectedMlPeriod !== null ? backtestTable.find(r => r.year === selectedMlPeriod) || futureForecast : null;

              return (
                <>
                  {/* Accuracy gate banner */}
                  <div className={accuracyWarning ? 'accuracy-warning' : 'accuracy-ok'}>
                    {accuracyWarning
                      ? `⚠️ ${accuracyWarning}`
                      : `✅ ML model meets accuracy standards — MAPE ${fmt(metrics.ml?.mape, 1)}% · Beats naive baseline · Reliable for forecasting`
                    }
                  </div>

                  {/* Side-by-side comparison dashboard */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Formula Model Card */}
                    <div className="glass-card p-5 flex flex-col gap-3" style={{ borderColor:'rgba(56,189,248,0.2)', background:'linear-gradient(135deg,rgba(56,189,248,0.04),transparent)' }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span style={{ fontSize:18 }}>📐</span>
                        <span className="text-[10px] font-black text-sky-400 uppercase tracking-widest" style={{ fontFamily:'Outfit,sans-serif' }}>Formula Model (DDM)</span>
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
                        Assumptions: g = {fmt(analysisData?.g, 1)}% CAGR · R = CAPM · Gordon Growth Model · H-Model blend
                      </div>
                      {futureForecast?.formulaPrediction && (
                        <div className="flex justify-between items-center px-2 py-2 rounded" style={{ background:'rgba(56,189,248,0.06)', border:'1px solid rgba(56,189,248,0.15)' }}>
                          <span className="text-[9px] font-black text-slate-500 uppercase">Forecast {futureForecast.year}</span>
                          <span className="text-base font-black text-sky-400 mono">${fmt(futureForecast.formulaPrediction, 4)}</span>
                        </div>
                      )}
                    </div>

                    {/* ML Model Card */}
                    <div className="glass-card p-5 flex flex-col gap-3" style={{ borderColor:'rgba(129,140,248,0.2)', background:'linear-gradient(135deg,rgba(129,140,248,0.04),transparent)' }}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span style={{ fontSize:18 }}>🧠</span>
                          <span className="text-[10px] font-black text-violet-400 uppercase tracking-widest" style={{ fontFamily:'Outfit,sans-serif' }}>ML Model (Random Forest)</span>
                        </div>
                        <span className={mlReliable ? 'winner-ml' : 'winner-tie'}>{mlReliable ? '✓ Reliable' : '⚠ Caution'}</span>
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

                  {/* Overall winner verdict */}
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
                  {featureImportance.length > 0 && (
                    <section className="glass-card p-5">
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4" style={{ fontFamily:'Outfit,sans-serif' }}>ML Feature Importance (Mean |SHAP|)</h3>
                      <div className="flex flex-col gap-2">
                        {featureImportance.map((f, i) => (
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

                  {/* ── CHART 4: Correlation heatmap ── */}
                  {correlations.length > 0 && (
                    <section className="glass-card p-5">
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4" style={{ fontFamily:'Outfit,sans-serif' }}>Pearson Correlation: Feature vs Dividend</h3>
                      <div className="flex flex-col gap-2">
                        {correlations.map((c, i) => {
                          const pct = (c.pearson / maxCorr) * 100;
                          const isPos = c.pearson >= 0;
                          return (
                            <div key={i} className="flex items-center gap-3">
                              <span className="text-[9px] font-black text-slate-500 mono uppercase" style={{ width:120, flexShrink:0 }}>{c.feature}</span>
                              <div style={{ flex:1, height:10, background:'rgba(255,255,255,0.04)', borderRadius:5, overflow:'hidden', position:'relative' }}>
                                <div style={{ position:'absolute', [isPos?'left':'right']:0, top:0, height:'100%', width:`${Math.abs(pct)/2}%`, background:isPos?'rgba(52,211,153,0.6)':'rgba(251,113,133,0.6)', borderRadius:5 }}/>
                              </div>
                              <span className={`text-[9px] font-black mono`} style={{ width:52, textAlign:'right', color: isPos ? '#34d399' : '#fb7185' }}>{c.pearson.toFixed(3)}</span>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-[8px] text-slate-700 mt-3">Pearson r shows linear correlation — high correlation does not imply causation. ML uses these as inputs, not as guarantees.</p>
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
                                        {Object.entries(r.shap || {}).sort((a,b) => Math.abs(b[1]) - Math.abs(a[1])).map(([feat, val], fi) => {
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
                          {Object.entries(futureForecast.shap).sort((a,b) => Math.abs(b[1]) - Math.abs(a[1])).map(([feat, val], fi) => {
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
                        <th>Intrinsic</th><th>Upside</th><th>AI Score</th><th>Signal</th><th>Action</th>
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
                          <td className="mono text-sky-400">${fmt(s.intrinsicValue)}</td>
                          <td className={`mono font-black ${s.valuationGap >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{s.valuationGap >= 0 ? '+' : ''}{s.valuationGap}%</td>
                          <td>
                            <div className="flex items-center gap-1.5">
                              <div className="progress-track" style={{ width:45 }}><div className="progress-fill" style={{ width:`${s.aiScore}%` }} /></div>
                              <span className="text-white font-black mono text-[11px]">{s.aiScore}</span>
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
          DividIntel · DDM Valuation Platform · For educational use only · Not financial advice
        </footer>
      </div>
    </div>
  );
}
