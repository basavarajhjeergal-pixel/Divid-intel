"""
news_backtest.py -- does adding NEWS improve the dividend models? (honest backtest)

Run on your Mac from the divfor folder (put dividend_ml_study.py next to it):
    python3 news_backtest.py --csv data/processed/final_research_dataset.csv --email you@example.com

Step 1  Collect DATED company news events (free, with full history):
          US    : SEC EDGAR 8-K filings (item codes, e.g. 2.06 impairment, 5.02 executive exit)
          India : NSE corporate announcements (subjects, e.g. "credit rating", "litigation")
        Saved to data/processed/news_events.csv (re-used next run; delete it to refresh).
Step 2  Turn them into yearly features for each company (only events dated in year t
        are used to predict the dividend of year t+1; dividend announcements themselves
        are EXCLUDED so the model can't just read the answer).
Step 3  Run the same walk-forward backtest WITH vs WITHOUT news features and print both.

Needs: pandas, numpy, scikit-learn, requests (no paid API, no Groq needed).
--email is required by the SEC's fair-access rules (sent only to sec.gov as a contact).
"""
import argparse, re, sys, time
from pathlib import Path

import numpy as np
import pandas as pd
import dividend_ml_study as base

try:
    import requests
except ImportError:
    sys.exit("Please run: pip3 install requests")

EVENTS = Path("data/processed/news_events.csv")

# ---------- event classification ----------------------------------------------------
SEC_NEG_ITEMS = {"1.02": "contract terminated", "1.03": "bankruptcy", "2.04": "debt acceleration",
                 "2.05": "restructuring/exit costs", "2.06": "impairment", "3.01": "delisting notice",
                 "4.01": "auditor change", "4.02": "financials unreliable", "5.02": "executive departure"}
SEC_POS_ITEMS = {"1.01": "material agreement", "2.01": "acquisition completed"}

NEG_WORDS = r"loss|default|downgrad|litigation|lawsuit|penalt|fine imposed|show cause|sebi order|insolven|" \
            r"resign|fraud|investigat|impair|write.?off|strike|shut ?down|closure|suspen|credit rating.*(revis|lower|watch)"
POS_WORDS = r"upgrad|order (win|received|bagged)|award of (contract|order)|buy ?back|bonus|acquisition|" \
            r"capacity (addition|expansion)|commission(ed|ing)"
LEAK_WORDS = r"dividend|record date|book closure|interim|final dividend"     # excluded: would leak the answer


def classify_text(text):
    t = str(text).lower()
    if re.search(LEAK_WORDS, t):
        return None
    if re.search(NEG_WORDS, t):
        return "negative"
    if re.search(POS_WORDS, t):
        return "positive"
    return "neutral"


# ---------- SEC EDGAR (US) -----------------------------------------------------------
def sec_events(tickers, email):
    h = {"User-Agent": f"dividend-research {email}", "Accept-Encoding": "gzip, deflate"}
    try:
        cmap = requests.get("https://www.sec.gov/files/company_tickers.json", headers=h, timeout=30).json()
    except Exception as e:
        print(f"  SEC ticker list failed: {e}"); return []
    cik = {v["ticker"].upper(): int(v["cik_str"]) for v in cmap.values()}
    rows = []
    for t in tickers:
        if t.upper() not in cik:
            print(f"  {t}: no SEC CIK"); continue
        url = f"https://data.sec.gov/submissions/CIK{cik[t.upper()]:010d}.json"
        try:
            sub = requests.get(url, headers=h, timeout=30).json()
            blocks = [sub["filings"]["recent"]]
            for f in sub["filings"].get("files", []):          # older filings live in extra files
                time.sleep(0.15)
                blocks.append(requests.get("https://data.sec.gov/submissions/" + f["name"], headers=h, timeout=30).json())
        except Exception as e:
            print(f"  {t}: SEC fetch failed ({e})"); continue
        n = 0
        for b in blocks:
            for form, date, items in zip(b.get("form", []), b.get("filingDate", []), b.get("items", [])):
                if form != "8-K" or not items:
                    continue
                codes = [c.strip() for c in str(items).split(",")]
                if any(c == "8.01" for c in codes) and len(codes) == 1:
                    continue                                   # 'other events' often = dividend notices
                sig = "negative" if any(c in SEC_NEG_ITEMS for c in codes) else \
                      "positive" if any(c in SEC_POS_ITEMS for c in codes) else "neutral"
                rows.append({"Ticker": t, "Date": date, "Source": "SEC 8-K", "Text": items, "Signal": sig}); n += 1
        print(f"  {t}: {n} 8-K events"); time.sleep(0.2)
    return rows


# ---------- NSE (India) -------------------------------------------------------------
def nse_events(tickers, start_year):
    s = requests.Session()
    s.headers.update({"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                                    "(KHTML, like Gecko) Chrome/124 Safari/537.36",
                      "Accept": "application/json,text/plain,*/*", "Referer": "https://www.nseindia.com/"})
    try:
        s.get("https://www.nseindia.com/", timeout=20)           # sets the cookies NSE requires
    except Exception as e:
        print(f"  NSE homepage failed: {e}"); return []
    rows, this_year = [], pd.Timestamp.now().year
    for t in tickers:
        sym = t.replace(".NS", "")
        n = 0
        for y in range(start_year, this_year + 1):
            url = ("https://www.nseindia.com/api/corporate-announcements?index=equities"
                   f"&symbol={requests.utils.quote(sym)}&from_date=01-01-{y}&to_date=31-12-{y}")
            for attempt in range(3):
                try:
                    r = s.get(url, timeout=30)
                    data = r.json() if r.ok else []
                    break
                except Exception:
                    time.sleep(2 * (attempt + 1)); s.get("https://www.nseindia.com/", timeout=20); data = []
            for a in (data if isinstance(data, list) else []):
                text = f"{a.get('desc', '')} {a.get('attchmntText', '')}"
                date = pd.to_datetime(a.get("an_dt") or a.get("sort_date"), errors="coerce", dayfirst=True)
                if pd.isna(date):
                    continue
                rows.append({"Ticker": t, "Date": date.strftime("%Y-%m-%d"), "Source": "NSE",
                             "Text": text[:300], "Signal": classify_text(text)}); n += 1
            time.sleep(0.4)
        print(f"  {t}: {n} NSE announcements")
    return rows


# ---------- features ----------------------------------------------------------------
def yearly_features(ev):
    ev = ev[ev["Signal"].notna()].copy()                      # drop dividend-related (leak) items
    ev["Year"] = pd.to_datetime(ev["Date"]).dt.year
    g = ev.groupby(["Ticker", "Year"])
    f = pd.DataFrame({
        "news_total": g.size(),
        "news_neg": g["Signal"].apply(lambda s: (s == "negative").sum()),
        "news_pos": g["Signal"].apply(lambda s: (s == "positive").sum()),
    }).reset_index()
    f["news_neg_share"] = f["news_neg"] / f["news_total"]
    f["news_net"] = (f["news_pos"] - f["news_neg"]) / f["news_total"]
    # change vs the company's own normal level (a spike in bad news matters more than the count)
    f = f.sort_values(["Ticker", "Year"])
    f["news_neg_vs_avg"] = f["news_neg_share"] - f.groupby("Ticker")["news_neg_share"].transform(
        lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    return f


NEWS = ["news_total", "news_neg", "news_neg_share", "news_net", "news_neg_vs_avg"]


def compare(d):
    """Walk-forward: same models, with vs without news features."""
    d = d.copy(); d["target_year"] = d["Year"] + 1
    out = []
    for Y in sorted(d["target_year"].unique()):
        if Y < base.FIRST_TEST_YEAR:
            continue
        tr, te = d[d["target_year"] < Y], d[d["target_year"] == Y]
        if te.empty or tr["y_cut"].sum() < 5:
            continue
        F0 = [c for c in base.FEATS if tr[c].nunique() > 1]
        F1 = F0 + [c for c in NEWS if tr[c].notna().sum() >= 20]
        p = te[["Ticker", "Country", "CompanyType", "target_year", "y_log", "y_cut", "spike3"]].copy()
        p["has_news"] = te["news_total"].notna().values
        pw = max(1.0, (tr["y_cut"] == 0).sum() / tr["y_cut"].sum())
        for tag, F in (("without news", F0), ("WITH news", F1)):
            p[f"ML: Gradient Boosting {tag}"] = base.regressors()["Gradient Boosting"].fit(tr[F], tr["y_log"]).predict(te[F])
            p[f"CUT Random Forest {tag}"] = base.classifiers(pw)["Random Forest"].fit(tr[F], tr["y_cut"].astype(int)).predict_proba(te[F])[:, 1]
            p[f"CUT Gradient Boosting {tag}"] = base.classifiers(pw)["Gradient Boosting"].fit(tr[F], tr["y_cut"].astype(int)).predict_proba(te[F])[:, 1]
        out.append(p)
    return pd.concat(out, ignore_index=True)


def report(p, title):
    if p["y_cut"].sum() < 3 or p["y_cut"].nunique() < 2:
        print(f"\n{title}: too few cuts to judge"); return
    lv = base.score_levels(p)[["Model", "Accuracy % (100 - avg error)", "Within 10%", "India avg error %", "USA avg error %"]]
    ct = base.score_cuts(p)[["Model", "ROC-AUC", "Cuts caught", "False alarms"]]
    print(f"\n=== {title}: {len(p)} predictions, {int(p['y_cut'].sum())} cuts ===")
    print(lv.round(1).to_string(index=False)); print(); print(ct.round(3).to_string(index=False))
    a, b = "ML: Gradient Boosting WITH news", "ML: Gradient Boosting without news"
    print(f"News helps the forecast in {base.boot_win(p, a, b):.0f}% of bootstrap re-tests "
          f"(>95% = convincing, <80% = could be luck)")
    print(f"News helps the cut warning (Random Forest) in "
          f"{base.boot_auc(p, 'Random Forest WITH news', 'Random Forest without news'):.0f}% of re-tests")
    return lv, ct


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--email", help="your contact email for SEC requests (required unless events file exists)")
    ap.add_argument("--start-year", type=int, default=2000)
    a = ap.parse_args()

    raw = pd.read_csv(a.csv)
    if EVENTS.exists():
        ev = pd.read_csv(EVENTS); print(f"Using saved {EVENTS} ({len(ev)} events)")
    else:
        if not a.email:
            sys.exit("Add --email you@example.com (SEC asks for a contact address).")
        tick = raw.groupby("Ticker")["Country"].first()
        print("Collecting SEC 8-K events (US)...")
        rows = sec_events([t for t, c in tick.items() if c == "USA"], a.email)
        print("Collecting NSE announcements (India)... (can take ~10 min)")
        rows += nse_events([t for t, c in tick.items() if c == "India"], a.start_year)
        ev = pd.DataFrame(rows)
        if ev.empty:
            sys.exit("No news events collected (network blocked?). Nothing to test.")
        EVENTS.parent.mkdir(parents=True, exist_ok=True); ev.to_csv(EVENTS, index=False)
        print(f"Saved {len(ev)} events to {EVENTS}")

    cov = ev.assign(Year=pd.to_datetime(ev["Date"]).dt.year).groupby("Ticker")["Year"].agg(["min", "max", "size"])
    print("\nNews coverage per company:"); print(cov.to_string())

    d = base.build(raw).merge(yearly_features(ev), on=["Ticker", "Year"], how="left")
    p = compare(d)
    report(p, "ALL test predictions")
    sub = p[p["has_news"]]
    if len(sub) >= 40:
        report(sub, "Only years that HAVE news coverage")
    p.to_csv("news_backtest_predictions.csv", index=False)
    print("\nSaved news_backtest_predictions.csv. Screenshot this window for your report.")


if __name__ == "__main__":
    main()
