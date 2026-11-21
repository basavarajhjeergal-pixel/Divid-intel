// GET /api/forecast          -> hybrid model info, backtest scores and all companies
// GET /api/forecast/:ticker  -> next-year dividend forecast, 80% range and cut risk for one stock
//
// Served from backend/data/hybrid_predictions.json (see research/hybrid/README.md).

const express = require('express');
const { loadAll, getHybrid } = require('../lib/hybrid');

const router = express.Router();
const MISSING = 'Hybrid predictions not found. Run research/hybrid/hybrid_model.py with --export first.';

router.get('/', (req, res) => {
    const d = loadAll();
    if (!d) return res.status(503).json({ error: MISSING });
    res.json({ model: d.model, trainedAt: d.trainedAt, usesNews: d.usesNews, backtest: d.backtest,
               trustInML: d.trustInML, stocks: Object.values(d.stocks) });
});

router.get('/:ticker', (req, res) => {
    const d = loadAll();
    if (!d) return res.status(503).json({ error: MISSING });
    const ticker = String(req.params.ticker || '').toUpperCase().trim();
    const s = getHybrid(ticker);
    if (!s) {
        return res.status(404).json({ error: `${ticker} is not covered by the hybrid model yet.`,
                                      available: Object.keys(d.stocks) });
    }
    res.json(s);
});

module.exports = router;
