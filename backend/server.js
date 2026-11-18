require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

const rateLimit = require('./lib/rateLimit');

// Only your own frontend may call the API from a browser.
// Set ALLOWED_ORIGINS in .env / Vercel, comma-separated, e.g.
//   ALLOWED_ORIGINS=https://your-frontend.vercel.app,http://localhost:5173
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
    .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
    origin: (origin, cb) => {
        // allow same-origin / server-to-server / curl (no Origin header)
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '100kb' }));

// Health check routes
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Dividend Analytics API is running' });
});
app.get('/api', (req, res) => {
    res.json({ status: 'ok', message: 'Dividend Analytics API is running' });
});

const dividendRoute = require('./routes/dividend');
const ddmRoute = require('./routes/ddm');
const backtestRoute = require('./routes/backtest');
const aiRoute = require('./routes/ai');
const screenerRoute = require('./routes/screener');
const mlRoute       = require('./routes/ml');
const scoreRoute    = require('./routes/score');   // divfor integration
const newsRoute     = require('./routes/news');    // live news risk (Groq or keyword rules)

app.use('/api/dividends', dividendRoute);
app.use('/api/ddm', ddmRoute);
app.use('/api/backtest', backtestRoute);
app.use('/api/news', rateLimit({ max: 40 }), newsRoute);   // cached 30 min per ticker
app.use('/api/ai', rateLimit(), aiRoute);            // paid Groq calls: 20 req / 10 min / IP
app.use('/api/screener', rateLimit({ max: 30 }), screenerRoute);
app.use('/api/ml', mlRoute);
app.use('/api/score', scoreRoute);                // Dividend Variation Score (Formula B)

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;
