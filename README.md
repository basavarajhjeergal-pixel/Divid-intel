# 📈 Dividend Analytics Platform & AI Valuation Terminal

A modern, full-stack financial analytics platform for **Dividend Discount Model (DDM)** intrinsic valuation, dividend safety scoring, multi-year backtesting, and AI-powered stock insights using Groq Llama 3.

---

## ✨ Features

- 🏛️ **DDM Valuation Engine**: Calculates intrinsic stock value using Dividend Discount Models (Gordon Growth) and required rate of return (CAPM).
- 🤖 **AI Stock Analyst (Groq / Llama 3.3)**: Real-time conversational AI answering queries about dividend sustainability, risk-adjusted returns, and company profiles.
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
│   │   ├── backtest.js     # Historical simulation engine
│   │   ├── ddm.js          # DDM calculation & Yahoo Finance live data
│   │   └── dividend.js     # Dividend history endpoints
│   ├── db.js               # Database connection pool (with safe fallbacks)
│   ├── server.js           # Express API server
│   ├── vercel.json         # Vercel serverless deployment config
│   ├── package.json
│   └── .env.example
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
