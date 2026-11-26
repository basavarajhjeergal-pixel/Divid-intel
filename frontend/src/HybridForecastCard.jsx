import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from './config';

// Hybrid model card: next-year dividend forecast, honest 80% range, cut risk, backtest proof.
// Usage:  <HybridForecastCard ticker={selectedTicker} />
const RISK = {
  High:   { color: '#fb7185', bg: 'rgba(244,63,94,0.10)' },
  Medium: { color: '#fbbf24', bg: 'rgba(245,158,11,0.10)' },
  Low:    { color: '#34d399', bg: 'rgba(16,185,129,0.10)' },
};

const money = (v, t) => `${String(t).endsWith('.NS') ? '₹' : '$'}${Number(v).toFixed(2)}`;

export default function HybridForecastCard({ ticker }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!ticker) return;
    let alive = true;
    setD(null); setErr(null);
    axios.get(`${API_BASE_URL}/api/forecast/${encodeURIComponent(ticker)}`)
      .then(r => alive && setD(r.data))
      .catch(e => alive && setErr(e.response?.status === 404
        ? `${ticker} is not covered by the hybrid model yet (it covers 16 research companies).`
        : 'Hybrid forecast unavailable.'))
    return () => { alive = false; };
  }, [ticker]);

  if (err) return <div className="glass-card p-4 text-xs" style={{ color: '#94a3b8' }}>🧠 {err}</div>;
  if (!d) return null;

  const r = RISK[d.cutRiskLevel] || RISK.Medium;
  const bt = d.backtest;
  // this company's own walk-forward results (same capped % error as the overall accuracy)
  const hist = (d.history || []).filter(x => x.actualGrowthPct != null && x.predictedGrowthPct != null);
  const errs = hist.map(x => Math.min(Math.abs((1 + x.predictedGrowthPct / 100) / (1 + x.actualGrowthPct / 100) - 1), 1) * 100);
  const ownAcc = errs.length ? (100 - errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(1) : null;
  const ownCuts = hist.filter(x => x.actualGrowthPct < -1).length;
  // position of the forecast inside its 80% range, for the small range bar
  const span = Math.max(1e-9, d.range80High - d.range80Low);
  const pos = Math.min(100, Math.max(0, ((d.forecastDividend - d.range80Low) / span) * 100));

  return (
    <div className="glass-card p-5" style={{ borderColor: 'rgba(56,189,248,0.3)' }}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] font-black tracking-[0.2em] uppercase" style={{ color: '#94a3b8' }}>
            🧠 Hybrid model · {d.forecastYear} dividend forecast
          </div>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-3xl font-black text-white">{money(d.forecastDividend, d.ticker)}</span>
            <span className="text-sm font-black" style={{ color: d.changePct >= 0 ? '#34d399' : '#fb7185' }}>
              {d.changePct >= 0 ? '+' : ''}{d.changePct}% vs {money(d.lastDividend, d.ticker)} in {d.lastYear}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-black tracking-[0.2em] uppercase" style={{ color: '#94a3b8' }}>Cut risk</div>
          <div className="text-xl font-black px-2 py-0.5 rounded inline-block mt-1" style={{ color: r.color, background: r.bg }}>
            {d.cutRiskPct}% · {d.cutRiskLevel}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-[11px]" style={{ color: '#94a3b8' }}>
          <span>80% range: {money(d.range80Low, d.ticker)}</span>
          <span>{money(d.range80High, d.ticker)}</span>
        </div>
        <div className="relative h-2 rounded-full mt-1" style={{ background: 'rgba(148,163,184,0.2)' }}>
          <div className="absolute top-1/2 w-3 h-3 rounded-full -translate-y-1/2 -translate-x-1/2"
               style={{ left: `${pos}%`, background: '#38bdf8', boxShadow: '0 0 0 2px #0b1220' }} />
        </div>
        <div className="text-[11px] mt-1" style={{ color: '#64748b' }}>
          In the backtest, 80% ranges contained the real dividend {bt.range80CoveragePct}% of the time.
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
        <Stat label="Backtest accuracy" value={`${bt.accuracyPct}%`} note={`all 16 companies (rule: ${bt.baselineAccuracyPct}%)${ownAcc ? ` · ${d.ticker}: ${ownAcc}%` : ''}`} />
        <Stat label="Typical error" value={`${bt.medianErrorPct}%`} note={`all companies, ${bt.predictions} predictions, ${bt.years}`} />
        <Stat label="Cut warning AUC" value={bt.cutAuc} note={`${bt.realCuts} real cuts, all companies · ${d.ticker}: ${ownCuts}`} />
        <Stat label="Trust in ML" value={`${Math.round(d.trustInML * 100)}%`} note={`for ${d.country === 'India' ? (d.companyType === 'PSU' ? 'Indian PSUs' : 'Indian private cos.') : 'US companies'}; rest: same as last year`} />
      </div>
      <div className="text-[10px] mt-3" style={{ color: '#64748b' }}>
        Trained {d.trainedAt}{d.usesNews ? ' · includes news features' : ''}. Each backtest prediction used only earlier years.
      </div>
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="rounded-lg p-2" style={{ background: 'rgba(15,23,42,0.5)' }}>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: '#94a3b8' }}>{label}</div>
      <div className="text-base font-black text-white">{value}</div>
      <div className="text-[10px]" style={{ color: '#64748b' }}>{note}</div>
    </div>
  );
}
