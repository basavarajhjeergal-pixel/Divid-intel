"""
export_news_features.py -- turn dated company news into model-ready yearly features.

Run from divfor (after news_backtest.py has created data/processed/news_events.csv):
    python3 export_news_features.py
Output:
    data/processed/news_features_yearly.csv   (one row per Ticker x Year)

Sources: SEC 8-K filings (US) and NSE corporate announcements (India), each labelled
negative / positive / neutral. Dividend announcements are removed so the model can't
read the answer.

HOW TO USE IN A MODEL (no look-ahead):
    features of year t  -> predict the dividend of year t+1
    merge on ["Ticker", "Year"] with the row for year t.
"""
import re
from pathlib import Path

import numpy as np
import pandas as pd

EVENTS = Path("data/processed/news_events.csv")
OUT = Path("data/processed/news_features_yearly.csv")

SEC_NEG = {"1.02", "1.03", "2.04", "2.05", "2.06", "3.01", "4.01", "4.02", "5.02"}
LEAK = r"dividend|record date|book closure|interim|final dividend"


def main():
    if not EVENTS.exists():
        raise SystemExit(f"{EVENTS} not found. Run news_backtest.py first (it collects the news).")
    ev = pd.read_csv(EVENTS)
    ev["Date"] = pd.to_datetime(ev["Date"], errors="coerce")
    ev = ev.dropna(subset=["Date"])
    # drop dividend-related items (would leak the answer) -- they have Signal = NaN
    ev = ev[ev["Signal"].notna()]
    ev = ev[~ev["Text"].astype(str).str.lower().str.contains(LEAK, regex=True)]
    ev["Year"] = ev["Date"].dt.year
    ev["neg"] = (ev["Signal"] == "negative").astype(int)
    ev["pos"] = (ev["Signal"] == "positive").astype(int)
    ev["q4"] = (ev["Date"].dt.month >= 10).astype(int)          # last quarter of the year
    ev["neg_q4"] = ev["neg"] * ev["q4"]
    ev["sec_serious"] = ev["Text"].astype(str).apply(
        lambda t: int(any(c.strip() in SEC_NEG for c in t.split(",")))) * (ev["Source"] == "SEC 8-K")

    g = ev.groupby(["Ticker", "Year"])
    f = g.agg(news_total=("Signal", "size"), news_neg=("neg", "sum"), news_pos=("pos", "sum"),
              news_neg_q4=("neg_q4", "sum"), news_serious_8k=("sec_serious", "sum")).reset_index()
    f["Source"] = np.where(f["Ticker"].str.endswith(".NS"), "NSE announcements", "SEC 8-K")

    # make every year present for each company (a year with no news = 0, not missing)
    full = []
    for t, grp in f.groupby("Ticker"):
        yrs = range(grp["Year"].min(), grp["Year"].max() + 1)
        grp = grp.set_index("Year").reindex(yrs)
        grp["Ticker"] = t
        grp["Source"] = grp["Source"].ffill().bfill()
        for c in ["news_total", "news_neg", "news_pos", "news_neg_q4", "news_serious_8k"]:
            grp[c] = grp[c].fillna(0).astype(int)
        full.append(grp.reset_index().rename(columns={"index": "Year"}))
    f = pd.concat(full, ignore_index=True).sort_values(["Ticker", "Year"])

    tot = f["news_total"].replace(0, np.nan)
    f["news_neg_share"] = (f["news_neg"] / tot).fillna(0).round(4)
    f["news_net"] = ((f["news_pos"] - f["news_neg"]) / tot).fillna(0).round(4)
    # vs the company's own normal level (prior 3 years only -> no look-ahead)
    prev = f.groupby("Ticker")["news_neg_share"].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    f["news_neg_vs_avg"] = (f["news_neg_share"] - prev).round(4)
    f["partial_year"] = f["Year"] == pd.Timestamp.now().year

    cols = ["Ticker", "Year", "Source", "news_total", "news_neg", "news_pos", "news_neg_share",
            "news_net", "news_neg_vs_avg", "news_neg_q4", "news_serious_8k", "partial_year"]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    f[cols].to_csv(OUT, index=False)
    print(f"Saved {OUT}: {len(f)} rows, {f['Ticker'].nunique()} companies, years {f['Year'].min()}-{f['Year'].max()}")
    print(f[cols].tail(5).to_string(index=False))


if __name__ == "__main__":
    main()
