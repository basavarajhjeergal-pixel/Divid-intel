// Loads the hybrid model's saved predictions (backend/data/hybrid_predictions.json).
// The file is produced offline by research/hybrid/hybrid_model.py --export ...
// and reloaded automatically when it changes. Nothing is trained on request.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'hybrid_predictions.json');
let cache = null, mtime = 0;

function loadAll() {
    try {
        const st = fs.statSync(FILE);
        if (!cache || st.mtimeMs !== mtime) {
            cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
            mtime = st.mtimeMs;
        }
        return cache;
    } catch {
        return null;            // no file yet -> callers fall back to the old model
    }
}

function getHybrid(ticker) {
    const all = loadAll();
    const s = all?.stocks?.[String(ticker || '').toUpperCase().trim()];
    if (!s) return null;
    return { ...s, model: all.model, trainedAt: all.trainedAt, usesNews: all.usesNews, backtest: all.backtest };
}

module.exports = { loadAll, getHybrid };
