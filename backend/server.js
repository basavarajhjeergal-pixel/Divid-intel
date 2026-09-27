require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

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

app.use('/api/dividends', dividendRoute);
app.use('/api/ddm', ddmRoute);
app.use('/api/backtest', backtestRoute);
app.use('/api/ai', aiRoute);
app.use('/api/screener', screenerRoute);
app.use('/api/ml', mlRoute);

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;
