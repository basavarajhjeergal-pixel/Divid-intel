import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from './config';

// Live news-risk card: recent headlines labelled for dividend risk.
// Usage:  <NewsRiskCard ticker={selectedTicker} />
const LEVEL_STYLE = {
  High:   { color: '#fb7185', bg: 'rgba(244,63,94,0.10)',  border: 'rgba(244,63,94,0.35)',  icon: '▲' },
  Medium: { color: '#fbbf24', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.35)', icon: '●' },
  Neutral: { color: '#cbd5e1', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.30)', icon: '●' },
  'No data': { color: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.30)', icon: '–' },
  Low:    { color: '#34d399', bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.35)', icon: '▼' },
};
const SIGNAL = {
  negative: { label: 'Risk ↑', color: '#fb7185' },
  positive: { label: 'Risk ↓', color: '#34d399' },
  neutral:  { label: 'Neutral', color: '#94a3b8' },
};

export default function NewsRiskCard({ ticker }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    let alive = true;
    setLoading(true); setError(null); setData(null);
    axios.get(`${API_BASE_URL}/api/news/${encodeURIComponent(ticker)}`)
      .then(r => { if (alive) setData(r.data); })
      .catch(e => { if (alive) setError(e.response?.data?.error || 'News unavailable'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [ticker]);

  if (loading) return <div className="glass-card p-5 text-xs" style={{ color: '#94a3b8' }}>Reading latest news for {ticker}…</div>;
  if (error) return <div className="glass-card p-5 text-xs" style={{ color: '#94a3b8' }}>📰 {error}</div>;
  if (!data) return null;

  const s = LEVEL_STYLE[data.level] || LEVEL_STYLE.Medium;
  return (
    <div className="glass-card p-5" style={{ border: `1px solid ${s.border}` }}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] font-black tracking-[0.2em] uppercase" style={{ color: '#94a3b8' }}>📰 News risk (live)</div>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-3xl font-black" style={{ color: s.color }}>{data.newsRisk}</span>
            <span className="text-sm font-black px-2 py-0.5 rounded" style={{ color: s.color, background: s.bg }}>
              {s.icon} {data.level}
            </span>
          </div>
          <div className="text-[11px] mt-1" style={{ color: '#94a3b8' }}>
            {data.counts.negative} negative · {data.counts.positive} positive · {data.counts.neutral} neutral{data.counts.unrelated ? ` (${data.counts.unrelated} not about this company)` : ''} · scored by {data.method}
          </div>
        </div>
        <button className="btn-primary text-xs" onClick={() => setOpen(o => !o)}>
          {open ? 'Hide headlines' : `Show ${data.headlines.length} headlines`}
        </button>
      </div>

      {open && (
        <ul className="mt-4 flex flex-col gap-2">
          {data.headlines.map((h, i) => (
            <li key={i} className="flex gap-3 items-start text-xs">
              <span className="font-black shrink-0 w-16" style={{ color: h.relevant === false ? '#475569' : SIGNAL[h.signal]?.color }}>{h.relevant === false ? 'Other co.' : SIGNAL[h.signal]?.label}</span>
              <span className="flex-1">
                <a href={h.link} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: '#e2e8f0' }}>{h.title}</a>
                <span style={{ color: '#64748b' }}> · {h.publisher}{h.date ? ` · ${new Date(h.date).toLocaleDateString()}` : ''}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="text-[10px] mt-3" style={{ color: '#64748b' }}>{data.note}</div>
    </div>
  );
}
