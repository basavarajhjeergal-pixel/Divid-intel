# 📈 Dividend Analytics Platform & AI Valuation Terminal

A modern, full-stack financial analytics platform for **Dividend Discount Model (DDM)** intrinsic valuation, dividend safety scoring, multi-year backtesting, hybrid machine-learning dividend forecasts, live news risk, and AI-powered stock insights using Groq.

---

## ✨ Features

- 🏛️ **DDM Valuation Engine**: Calculates intrinsic stock value using Dividend Discount Models (Gordon Growth) and required rate of return (CAPM).
- 🧠 **Hybrid Dividend Forecast**: Next-year dividend, an honest 80% range and cut risk for 16 research companies (11 India, 5 US). Gradient Boosting + Bayesian cut signal + per-group trust weights; walk-forward backtest 2005–2025: 80.5% accuracy ("same as last year": 77.1%), cut-warning AUC 0.823. See `research/hybrid/README.md`.
- 📰 **Live News Risk**: Recent headlines scored for dividend risk by Groq (keyword rules as fallback); headlines about other companies are ignored. Shown as a live signal, not a model input.
- 🤖 **AI Stock Analyst (Groq, gpt-oss models)**: Conversational AI answering questions about dividend sustainability, risk and valuation, grounded in the model outputs.
- 🌲 **Per-stock Random Forest (legacy)**: Used for stocks outside the hybrid model's coverage and in the Model Comparison and Strategy Backtest tabs.
- 🛡️ **Dividend Safety Index (DSI)**: Quantitative dividend cut risk analyzer (Low / Medium / High).
- 📊 **Interactive SVG Price Charts**: Clean OHLC & high-precision price charting with hover inspect tooltips.
- 🔁 **Historical Backtesting Engine**: Simulates quarterly DDM trading signals vs buy-and-hold benchmarks with Sharpe ratio, maximum drawdown, and win rates.
- 👥 **Sector Peer Group Benchmarks**: Multi-factor valuation comparison against industry peers.

---

## 🏗️ Project Architecture

The project is structured with clean separation between frontend and backend:

```text
dividend-analytics-platform/
├── backend/
│   ├── routes/
│   │   ├── ai.js           # Groq AI analyst & recommendation endpoints
│   │   ├── forecast.js     # Hybrid model forecast, 80% range, cut risk
│   │   ├── news.js         # Live news risk (Groq / keyword rules)
│   │   ├── ml.js           # Per-stock Random Forest (legacy)
│   │   ├── backtest.js     # Historical simulation engine
│   │   ├── ddm.js          # DDM calculation & Yahoo Finance live data
│   │   └── dividend.js     # Dividend history endpoints
│   ├── data/hybrid_predictions.json  # Saved hybrid model predictions
│   ├── lib/                # Cached Yahoo client, rate limit, hybrid loader
│   ├── db.js               # Database connection pool (with safe fallbacks)
│   ├── server.js           # Express API server
│   ├── vercel.json         # Vercel serverless deployment config
│   ├── package.json
│   └── .env.example
│
├── research/hybrid/        # Hybrid model, backtest, news tests, dataset
│
└── frontend/
    ├── src/
    │   ├── App.jsx         # Main UI application terminal
    │   ├── config.js       # Dynamic API URL configuration
    │   ├── index.css       # Tailwind & custom CSS glassmorphism styles
    │   └── main.jsx        # React root
    ├── vite.config.js      # Vite dev proxy configuration
    ├── vercel.json         # Vercel SPA routing rewrites
    ├── package.json
    └── .env.example
```

---

## 🚀 Local Development Setup

### 1. Backend Setup
```bash
cd backend
npm install
cp .env.example .env
# Add your GROQ_API_KEY inside backend/.env
npm start
```
*Backend runs on `http://localhost:5000`.*

### 2. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
*Frontend runs on `http://localhost:5173`.*

---


## 🔑 Environment Variables

| Variable | Location | Description |
|---|---|---|
| `GROQ_API_KEY` | Backend | Groq API Key for Llama 3 AI Analyst |
| `VITE_API_URL` | Frontend | Live backend URL for production API requests |
| `PORT` | Backend | Port number (default: 5000) |

---

## 📄 License
MIT License
