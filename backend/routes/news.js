// GET /api/news/:ticker  -> recent headlines + a dividend "news risk" score (0-100)
//
// 1. Headlines come from Yahoo Finance search (same shared, cached client as other routes).
// 2. Each headline is labelled  negative / positive / neutral  for the DIVIDEND:
//      - with GROQ_API_KEY set: Groq LLM labels them (one batched call, JSON output)
//      - otherwise (or if Groq fails): transparent keyword rules below
// 3. Risk = share of recent dividend-negative news, weighted toward newer headlines.
// The whole result is cached for 30 minutes per ticker, so Groq is called rarely.

const express = require('express');
const Groq = require('groq-sdk');
const yf = require('../lib/yahoo');
const { cached } = require('../lib/cache');

const router = express.Router();

const NEG = [
    'loss', 'losses', 'net loss', 'plunge', 'slump', 'decline', 'falls', 'drops', 'miss', 'misses',
    'downgrade', 'cut', 'cuts', 'slash', 'suspend', 'suspends', 'default', 'debt', 'lawsuit', 'probe',
    'fraud', 'penalty', 'fine', 'ban', 'layoff', 'layoffs', 'warning', 'weak', 'impairment', 'write-off',
    'writedown', 'bankrupt', 'resigns', 'investigation', 'sebi order', 'strike', 'shutdown', 'recall'
];
const POS = [
    'record', 'profit rises', 'profit jumps', 'beat', 'beats', 'upgrade', 'raises dividend', 'hikes dividend',
    'special dividend', 'bonus', 'buyback', 'strong', 'growth', 'surge', 'jumps', 'rallies', 'order win',
    'wins order', 'expansion', 'outperform', 'higher dividend', 'dividend increase'
];

function keywordLabel(title) {
    const t = ` ${String(title).toLowerCase()} `;
    const neg = NEG.filter(w => t.includes(` ${w}`)).length;
    const pos = POS.filter(w => t.includes(w)).length;
    if (neg > pos) return 'negative';
    if (pos > neg) return 'positive';
    return 'neutral';
}

// Words that identify the company in a headline (ticker root + main words of its name)
function companyTerms(ticker, name) {
    const root = ticker.replace(/\.(NS|BO)$/, '').replace(/[^A-Z0-9&]/g, '');
    const stop = new Set(['the', 'company', 'co', 'inc', 'ltd', 'limited', 'corp', 'corporation', 'plc', 'of', 'and', 'india', 'group']);
    const words = String(name || '').toLowerCase().replace(/[^a-z0-9&\- ]/g, ' ').split(/\s+/)
        .filter(w => w.length > 2 && !stop.has(w));
    const terms = new Set([root.toLowerCase(), ...words]);
    if (words.length) terms.add(words.slice(0, 2).join(' '));
    return [...terms].filter(Boolean);
}

function isRelevant(title, terms) {
    const t = ` ${String(title).toLowerCase()} `;
    return terms.some(w => w.length <= 4 ? new RegExp(`[^a-z0-9]${w.replace(/[&]/g, '\\&')}[^a-z0-9]`).test(t) : t.includes(w));
}

async function groqLabels(ticker, items, name) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey || !items.length) return null;
    const groq = new Groq({ apiKey });
    const list = items.map((h, i) => `${i + 1}. ${h.title}`).join('\n');
    const prompt =
`You assess news for dividend investors in ${name || ticker} (${ticker}).
For each headline, answer how it affects the chance that the company's NEXT dividend is cut:
"negative" = raises cut risk (losses, debt stress, legal/regulatory trouble, demand collapse),
"positive" = lowers cut risk (strong profits, cash flow, dividend hikes),
"neutral"  = little or no effect, OR the headline is mainly about a different company.
Return ONLY JSON: {"labels":["negative"|"positive"|"neutral", ...]} with exactly ${items.length} labels in order.

${list}`;
    // Groq retires models over time: try GROQ_MODEL from .env first, then known ones.
    const models = [process.env.GROQ_MODEL, 'openai/gpt-oss-20b', 'openai/gpt-oss-120b',
        'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'].filter(Boolean);
    let out, lastErr;
    for (const model of models) {
        try {
            const req = {
                model, temperature: 0, max_tokens: 2000,     // reasoning models need room to think
                messages: [{ role: 'user', content: prompt }]
            };
            if (model.startsWith('openai/gpt-oss')) req.reasoning_effort = 'low';
            out = await groq.chat.completions.create(req);
            break;
        } catch (e) {
            lastErr = e;
            console.warn(`Groq model ${model} failed: ${e.status || ''} ${e.message}`.slice(0, 200));
            if (e.status === 401 || e.status === 403) break;   // bad key: other models won't help
        }
    }
    if (!out) throw lastErr || new Error('no Groq model available');
    const txt = String(out.choices[0].message.content || '').replace(/<think>[\s\S]*?<\/think>/g, '');
    console.log(`News scored by Groq (${out.model})`);
    let labels;
    try { labels = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)).labels; }
    catch { labels = (txt.match(/negative|positive|neutral/g) || []); }   // plain-text fallback
    if (!Array.isArray(labels) || labels.length !== items.length) throw new Error('bad Groq output');
    return labels.map(l => (['negative', 'positive', 'neutral'].includes(l) ? l : 'neutral'));
}

function riskScore(items) {
    // newer headlines count more: weight halves every 14 days
    const now = Date.now();
    let wNeg = 0, wPos = 0, wAll = 0;
    for (const h of items) {
        const ageDays = h.date ? Math.max(0, (now - new Date(h.date).getTime()) / 864e5) : 30;
        const w = Math.pow(0.5, ageDays / 14);
        wAll += w;
        if (h.signal === 'negative') wNeg += w;
        if (h.signal === 'positive') wPos += w;
    }
    if (wAll === 0) return 50;
    // 50 = neutral; all-negative -> 100, all-positive -> 0
    return Math.round(Math.min(100, Math.max(0, 50 + 50 * (wNeg - wPos) / wAll)));
}

async function buildNewsRisk(ticker) {
    const res = await yf.search(ticker, { newsCount: 15, quotesCount: 0 });
    const items = (res?.news || []).slice(0, 15).map(n => ({
        title: n.title,
        publisher: n.publisher,
        link: n.link,
        date: n.providerPublishTime ? new Date(n.providerPublishTime).toISOString() : null
    })).filter(n => n.title);

    const q = await yf.quote(ticker).catch(() => null);
    const name = q?.longName || q?.shortName || '';
    const terms = companyTerms(ticker, name);
    items.forEach(h => { h.relevant = isRelevant(h.title, terms); });

    let method = 'keyword rules';
    let labels = null;
    try {
        labels = await groqLabels(ticker, items, name);
        if (labels) method = 'Groq LLM';
    } catch (e) {
        console.warn('Groq news labelling failed, using keyword rules:', e.message);
    }
    // headlines not mentioning the company can't move its dividend risk
    items.forEach((h, i) => { h.signal = !h.relevant ? 'neutral' : labels ? labels[i] : keywordLabel(h.title); });

    const relevant = items.filter(h => h.relevant);
    const score = riskScore(relevant);   // headlines about other companies don't count
    return {
        ticker,
        newsRisk: score,
        level: relevant.length === 0 ? 'No data' : score >= 60 ? 'High' : score <= 40 ? 'Low' : 'Neutral',
        counts: {
            negative: items.filter(h => h.signal === 'negative').length,
            positive: items.filter(h => h.signal === 'positive').length,
            neutral: items.filter(h => h.signal === 'neutral').length,
            unrelated: items.filter(h => !h.relevant).length
        },
        method,
        headlines: items,
        note: 'Live signal from recent headlines. Not part of the backtested models.',
        updatedAt: new Date().toISOString()
    };
}

router.get('/:ticker', async (req, res) => {
    const ticker = String(req.params.ticker || '').toUpperCase().trim();
    if (!/^[A-Z0-9.&\-^]{1,20}$/.test(ticker)) return res.status(400).json({ error: 'Invalid ticker' });
    try {
        const data = await cached(`news:${ticker}`, 30 * 60 * 1000, () => buildNewsRisk(ticker));
        res.json(data);
    } catch (e) {
        res.status(502).json({ error: `News unavailable for ${ticker} right now.`, detail: e.message });
    }
});

module.exports = router;
module.exports._test = { keywordLabel, riskScore, companyTerms, isRelevant };
