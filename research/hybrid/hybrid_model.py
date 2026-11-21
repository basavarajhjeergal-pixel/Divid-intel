"""
hybrid_model.py -- hybrid dividend model (+ optional news), tested walk-forward.

Run from divfor (dividend_ml_study.py in the same folder):
    python3 hybrid_model.py --csv data/processed/final_research_dataset.csv
    python3 hybrid_model.py --csv data/processed/final_research_dataset.csv \
                            --news data/processed/news_features_yearly.csv

THE HYBRID (all parts use only data available before the year being predicted)
  1. Cut-risk signal  : Bayesian hierarchical cut rate per company (group prior from
                        Country x CompanyType, updated with the company's own past cuts),
                        plus a 'big jump' term for dividends far above their 3-year level.
                        It is fed INTO the forecast model as a feature.
  2. ML forecast      : Gradient Boosting trained on absolute error of log growth
                        (= the error the forecast is scored on).
  3. Trust weighting  : for each company group, learn from earlier years' out-of-sample
                        errors how much to trust the ML forecast vs "same as last year".
  4. Ranges           : 80% prediction ranges from each group's own past forecast errors.
  5. Cut warning      : average of Random Forest and Bayesian cut probabilities.

NEWS (optional) is added to the forecast and cut models. It is accepted only if it beats
(a) the same model without news and (b) the same news SHUFFLED between companies in the
same year (a placebo), each in >= 95% of year-block bootstrap re-tests.
"""
import argparse, time, warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

import dividend_ml_study as base

warnings.filterwarnings("ignore")
NEWS_COLS = ["news_neg_vs_avg", "news_serious_8k", "news_neg_share", "news_net", "news_neg_q4"]
W_GRID = np.round(np.arange(0, 1.01, 0.1), 2)


# ----------------------------------------------------------------------------- helpers
def ape(pred_log, y_log):
    """% error vs the actual dividend, capped at 100% (same as the earlier study)."""
    return np.minimum(np.abs(np.exp(np.clip(pred_log - y_log, -3, 3)) - 1), 1) * 100


def build_all(raw):
    """Same features as the study, keeping each company's latest year (no target yet)."""
    import inspect
    src = inspect.getsource(base.build).replace(
        'return d[d["y_log"].notna() & d["g_now"].notna()].reset_index(drop=True)',
        'return d[d["g_now"].notna()].reset_index(drop=True)').replace("def build(", "def _b(")
    ns = dict(base.__dict__); exec(src, ns)
    return ns["_b"](raw)


def add_bayes_cut(d, strength=10):
    """Leak-free Bayesian cut rate for each row: uses only outcomes known by year t."""
    d = d.copy()
    d["group"] = d["Country"] + "|" + d["CompanyType"]
    known = d[["Ticker", "group", "Year", "y_cut"]].copy()
    known["known_by"] = known["Year"] + 1                       # outcome of row t is known at end of t+1
    out = np.full(len(d), np.nan)
    for i, (t, g, yr) in enumerate(zip(d["Ticker"], d["group"], d["Year"])):
        k = known[known["known_by"] <= yr]
        if k.empty:
            continue
        gk = k[k["group"] == g]
        prior = gk["y_cut"].mean() if len(gk) >= 5 else k["y_cut"].mean()
        ck = k[k["Ticker"] == t]
        out[i] = (prior * strength + ck["y_cut"].sum()) / (strength + len(ck))
    d["bayes_cut"] = out
    return d


def merge_news(d, news_path, shuffle_seed=None):
    n = pd.read_csv(news_path)
    if "partial_year" in n.columns:
        n = n[~n["partial_year"].astype(bool)]
    cols = [c for c in NEWS_COLS if c in n.columns]
    n = n[["Ticker", "Year"] + cols]
    if shuffle_seed is not None:        # placebo: give each company another company's news, same year
        rng = np.random.default_rng(shuffle_seed)
        n = n.copy()
        for y, idx in n.groupby("Year").groups.items():
            idx = list(idx)
            n.loc[idx, cols] = n.loc[rng.permutation(idx), cols].values
    return d.drop(columns=[c for c in cols if c in d.columns]).merge(n, on=["Ticker", "Year"], how="left"), cols


# ----------------------------------------------------------------------------- walk-forward
def run(d, extra=()):
    d = d.copy(); d["target_year"] = d["Year"] + 1
    rows, hist = [], []          # hist = earlier out-of-sample predictions (for trust weights + ranges)
    for Y in sorted(d["target_year"].unique()):
        if Y < base.FIRST_TEST_YEAR:
            continue
        tr, te = d[d["target_year"] < Y], d[d["target_year"] == Y]
        if te.empty or tr["y_cut"].sum() < 5:
            continue
        F0 = [c for c in base.FEATS if tr[c].nunique() > 1]
        F = F0 + ["bayes_cut"] + [c for c in extra if tr[c].notna().sum() >= 20]
        p = te[["Ticker", "Country", "CompanyType", "group", "target_year", "y_log", "y_cut"]].copy()

        p["Rule: same as last year"] = 0.0
        p["Gradient Boosting (earlier best)"] = base.regressors()["Gradient Boosting"].fit(tr[F0], tr["y_log"]).predict(te[F0])
        ml = base.regressors()["Gradient Boosting"].fit(tr[F], tr["y_log"]).predict(te[F])
        p["GB + cut feature"] = ml

        # trust weight per group, learned from EARLIER out-of-sample predictions only
        H = pd.concat(hist) if hist else None
        w = []
        for g in te["group"]:
            if H is None:
                w.append(1.0); continue
            hg = H[H["group"] == g]
            if len(hg) < 10:
                hg = H
            errs = [ape(wt * hg["ml"].values, hg["y_log"].values).mean() for wt in W_GRID]
            w.append(float(W_GRID[int(np.argmin(errs))]))
        p["trust_w"] = w
        p["ml"] = ml
        p["Hybrid"] = p["trust_w"] * ml

        # 80% range from the group's earlier errors of the hybrid
        lo, hi = [], []
        for g, pr in zip(te["group"], p["Hybrid"]):
            if H is None or len(H) < 15:
                lo.append(np.nan); hi.append(np.nan); continue
            hg = H[H["group"] == g]
            hg = hg if len(hg) >= 15 else H
            r = hg["y_log"] - hg["Hybrid"]
            lo.append(pr + r.quantile(0.10)); hi.append(pr + r.quantile(0.90))
        p["lo80"], p["hi80"] = lo, hi

        # cut warning
        pw = max(1.0, (tr["y_cut"] == 0).sum() / tr["y_cut"].sum())
        rf = base.classifiers(pw)["Random Forest"].fit(tr[F0], tr["y_cut"].astype(int)).predict_proba(te[F0])[:, 1]
        rf_x = base.classifiers(pw)["Random Forest"].fit(tr[F], tr["y_cut"].astype(int)).predict_proba(te[F])[:, 1]
        p["CUT Random Forest (earlier)"] = rf
        p["CUT RF used"] = rf_x
        # Bayesian cut rate + "big jump" signal (a dividend far above its 3-yr level tends to fall back)
        p["CUT Bayesian"] = (te["bayes_cut"].fillna(tr["y_cut"].mean())
                             + 0.3 * te["spike3"].fillna(0).clip(lower=0)).values
        p["CUT Hybrid (RF + Bayesian)"] = (pd.Series(rf_x).rank(pct=True).values + pd.Series(p["CUT Bayesian"].values).rank(pct=True).values) / 2
        rows.append(p)
        hist.append(p[["group", "y_log", "ml", "Hybrid"]])
    return pd.concat(rows, ignore_index=True)



# ----------------------------------------------------------------------------- export for the app
def export(d, p, path, extra=()):
    """Train on ALL years, predict next year per company, write JSON for the app.
    Trust weights, ranges and cut-risk calibration come from the walk-forward results p."""
    import json
    from sklearn.isotonic import IsotonicRegression
    d = d.copy(); d["target_year"] = d["Year"] + 1
    full = d[d["y_log"].notna()]
    F0 = [c for c in base.FEATS if full[c].nunique() > 1]
    F = F0 + ["bayes_cut"] + [c for c in extra if full[c].notna().sum() >= 20]

    # latest row per company (its outcome is not known yet) + leak-free bayes_cut for it
    allrows = add_bayes_cut(_build_latest(d))
    last = allrows[allrows["Year"] == allrows.groupby("Ticker")["Year"].transform("max")].copy()
    for c in extra:
        if c not in last.columns:
            last = last.merge(d[["Ticker", "Year", c]].drop_duplicates(), on=["Ticker", "Year"], how="left")

    reg = base.regressors()["Gradient Boosting"].fit(full[F], full["y_log"])
    ml = reg.predict(last[F])

    # trust weight per group from ALL walk-forward history
    w = {}
    for g, hg in p.groupby("group"):
        hg = hg if len(hg) >= 10 else p
        errs = [ape(wt * hg["ml"].values, hg["y_log"].values).mean() for wt in W_GRID]
        w[g] = float(W_GRID[int(np.argmin(errs))])
    trust = last["group"].map(w).fillna(1.0).values
    pred = trust * ml

    # 80% ranges from each group's walk-forward errors
    def rng(g):
        hg = p[p["group"] == g]; hg = hg if len(hg) >= 15 else p
        r = hg["y_log"] - hg["Hybrid"]
        return r.quantile(0.10), r.quantile(0.90)

    # cut risk: same RF + Bayesian blend, calibrated to real cut frequencies from the walk-forward
    pw = (full["y_cut"] == 0).sum() / full["y_cut"].sum()
    rf = base.classifiers(pw)["Random Forest"].fit(full[F], full["y_cut"].astype(int)).predict_proba(last[F])[:, 1]
    bay = (last["bayes_cut"].fillna(full["y_cut"].mean()) + 0.3 * last["spike3"].fillna(0).clip(lower=0)).values
    # place each new score within the walk-forward distribution (same rank scale as the backtest)
    rf_hist = p["CUT RF (news)"] if "CUT RF (news)" in p else p["CUT RF used"]
    pct = lambda x, h: (np.searchsorted(np.sort(h.values), x, side="right") / len(h))
    score = (pct(rf, rf_hist) + pct(bay, p["CUT Bayesian"])) / 2
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.01, y_max=0.95).fit(p["CUT Hybrid (RF + Bayesian)"], p["y_cut"])
    cut = iso.predict(score) * 100

    e = ape(p["Hybrid"], p["y_log"])
    ok = p["lo80"].notna()
    cov = ((p.loc[ok, "y_log"] >= p.loc[ok, "lo80"]) & (p.loc[ok, "y_log"] <= p.loc[ok, "hi80"])).mean() * 100
    out = {
        "model": "Hybrid (Gradient Boosting + Bayesian cut signal + group trust weights)",
        "trainedAt": time.strftime("%Y-%m-%d"),
        "usesNews": bool(extra),
        "backtest": {
            "years": f"{int(p['target_year'].min())}-{int(p['target_year'].max())}",
            "predictions": int(len(p)),
            "accuracyPct": round(float(100 - e.mean()), 1),
            "medianErrorPct": round(float(np.median(e)), 1),
            "within10Pct": round(float((e <= 10).mean() * 100), 1),
            "range80CoveragePct": round(float(cov), 1),
            "cutAuc": round(float(roc_auc_score(p["y_cut"], p["CUT Hybrid (RF + Bayesian)"])), 3),
            "realCuts": int(p["y_cut"].sum()),
            "baselineAccuracyPct": round(float(100 - ape(p["Rule: same as last year"], p["y_log"]).mean()), 1),
            "oldAppAccuracyPct": 72.5,
        },
        "trustInML": {k: round(v, 2) for k, v in w.items()},
        "stocks": {},
    }
    for i, (_, r) in enumerate(last.iterrows()):
        cur = float(r["dps"]); lo, hi = rng(r["group"])
        risk = float(cut[i])
        out["stocks"][r["Ticker"]] = {
            "ticker": r["Ticker"], "country": r["Country"], "companyType": r["CompanyType"],
            "lastYear": int(r["Year"]), "forecastYear": int(r["Year"]) + 1,
            "lastDividend": round(cur, 4),
            "forecastDividend": round(cur * float(np.exp(pred[i])), 4),
            "changePct": round(float(np.expm1(pred[i])) * 100, 1),
            "range80Low": round(cur * float(np.exp(pred[i] + lo)), 4),
            "range80High": round(cur * float(np.exp(pred[i] + hi)), 4),
            "trustInML": round(float(trust[i]), 2),
            "cutRiskPct": round(risk, 1),
            "cutRiskLevel": "High" if risk >= 35 else "Medium" if risk >= 15 else "Low",
            "drivers": {
                "thisYearGrowthPct": round(float(np.expm1(r["g_now"])) * 100, 1),
                "vsThreeYearLevelPct": None if pd.isna(r["spike3"]) else round(float(np.expm1(r["spike3"])) * 100, 1),
                "cutsLast5Years": None if pd.isna(r["cuts5"]) else int(r["cuts5"]),
                "groupCutRatePct": None if pd.isna(r["bayes_cut"]) else round(float(r["bayes_cut"]) * 100, 1),
            },
        }
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(out, indent=2))
    print(f"\nExported {path}: {len(out['stocks'])} companies")
    for t, s_ in sorted(out["stocks"].items(), key=lambda kv: -kv[1]["cutRiskPct"]):
        print(f"  {t:13s} {s_['lastDividend']:>9.2f} -> {s_['forecastDividend']:>9.2f} ({s_['changePct']:+5.1f}%) "
              f"80% range {s_['range80Low']:.2f}-{s_['range80High']:.2f}  cut risk {s_['cutRiskPct']:4.1f}% {s_['cutRiskLevel']}")


def _build_latest(d):
    """Rows for every company-year including the latest one (whose next year is unknown)."""
    return _LATEST

# ----------------------------------------------------------------------------- scoring
FC = ["Rule: same as last year", "Gradient Boosting (earlier best)", "GB + cut feature", "Hybrid"]
CC = ["CUT Random Forest (earlier)", "CUT Bayesian", "CUT Hybrid (RF + Bayesian)"]


def year_boot(p, a, b, n=2000, seed=0, kind="ape"):
    """% of re-tests (resampling whole YEARS) in which a beats b."""
    rng = np.random.default_rng(seed)
    yrs = p["target_year"].unique()
    by = {y: g for y, g in p.groupby("target_year")}
    wins = 0
    for _ in range(n):
        s = pd.concat([by[y] for y in rng.choice(yrs, len(yrs))])
        if kind == "ape":
            wins += ape(s[a], s["y_log"]).mean() < ape(s[b], s["y_log"]).mean()
        else:
            if s["y_cut"].nunique() < 2:
                continue
            wins += roc_auc_score(s["y_cut"], s[a]) > roc_auc_score(s["y_cut"], s[b])
    return wins / n * 100


def report(p, title):
    print(f"\n=== {title}: {len(p)} predictions ({p['target_year'].min()}-{p['target_year'].max()}), "
          f"{int(p['y_cut'].sum())} cuts ===")
    rows = []
    for c in FC:
        e = ape(p[c], p["y_log"])
        rows.append({"Model": c, "Accuracy %": 100 - e.mean(), "Median error %": np.median(e),
                     "Within 10%": (e <= 10).mean() * 100,
                     "India error %": e[p["Country"] == "India"].mean(), "US error %": e[p["Country"] == "USA"].mean(),
                     "Indian PSU error %": e[(p["Country"] == "India") & (p["CompanyType"] == "PSU")].mean()})
    lv = pd.DataFrame(rows)
    print(lv.round(1).to_string(index=False))
    ok = p["lo80"].notna()
    cov = ((p.loc[ok, "y_log"] >= p.loc[ok, "lo80"]) & (p.loc[ok, "y_log"] <= p.loc[ok, "hi80"])).mean() * 100
    print(f"80% ranges contained the real dividend {cov:.1f}% of the time ({ok.sum()} predictions)")
    print("Hybrid beats 'same as last year' in "
          f"{year_boot(p, 'Hybrid', 'Rule: same as last year'):.1f}% of year-resampled re-tests")
    print("Hybrid beats Gradient Boosting in "
          f"{year_boot(p, 'Hybrid', 'Gradient Boosting (earlier best)'):.1f}% of year-resampled re-tests")
    tw = p.groupby("group")["trust_w"].mean().round(2)
    print("Average trust in ML by group (1 = all ML, 0 = same as last year):", tw.to_dict())
    crow = []
    for c in CC:
        crow.append({"Cut model": c.replace("CUT ", ""), "ROC-AUC": roc_auc_score(p["y_cut"], p[c])})
    ct = pd.DataFrame(crow)
    print(ct.round(3).to_string(index=False))
    print("Hybrid cut beats Random Forest in "
          f"{year_boot(p, 'CUT Hybrid (RF + Bayesian)', 'CUT Random Forest (earlier)', kind='auc', n=500):.1f}% of re-tests")
    return lv, ct


def main():
    ap_ = argparse.ArgumentParser()
    ap_.add_argument("--csv", required=True)
    ap_.add_argument("--news")
    ap_.add_argument("--out", default="hybrid_results")
    ap_.add_argument("--export", help="write app predictions JSON here, e.g. ../backend/data/hybrid_predictions.json")
    a = ap_.parse_args()
    out = Path(a.out); out.mkdir(exist_ok=True)
    t0 = time.time()

    raw = pd.read_csv(a.csv)
    global _LATEST
    _LATEST = build_all(raw)
    d = add_bayes_cut(base.build(raw))
    print(f"Run {time.strftime('%Y-%m-%d %H:%M')} | {d['Ticker'].nunique()} companies | {len(d)} rows")
    p = run(d)
    lv, ct = report(p, "HYBRID WITHOUT NEWS")
    p.to_csv(out / "hybrid_predictions.csv", index=False)
    lv.to_csv(out / "hybrid_forecast.csv", index=False); ct.to_csv(out / "hybrid_cut.csv", index=False)

    if a.news:
        dn, cols = merge_news(d, a.news)
        pn = run(dn, extra=cols)
        report(pn, "HYBRID WITH REAL NEWS")
        dz, _ = merge_news(d, a.news, shuffle_seed=7)
        pz = run(dz, extra=cols)
        report(pz, "HYBRID WITH SHUFFLED NEWS (placebo)")
        m = p[["target_year", "y_log", "y_cut", "Ticker"]].copy()
        m["no_news"], m["real_news"], m["fake_news"] = p["Hybrid"].values, pn["Hybrid"].values, pz["Hybrid"].values
        for c in ["no_news", "real_news", "fake_news"]:
            m["c_" + c] = {"no_news": p, "real_news": pn, "fake_news": pz}[c]["CUT Hybrid (RF + Bayesian)"].values
        a1 = year_boot(m, "real_news", "no_news"); a2 = year_boot(m, "real_news", "fake_news")
        c1 = year_boot(m, "c_real_news", "c_no_news", kind="auc", n=500)
        c2 = year_boot(m, "c_real_news", "c_fake_news", kind="auc", n=500)
        print("\n=== NEWS VERDICT ===")
        print(f"Forecast: real news beats no news in {a1:.1f}%, beats shuffled news in {a2:.1f}% of re-tests")
        print(f"Cut warning: real news beats no news in {c1:.1f}%, beats shuffled news in {c2:.1f}% of re-tests")
        keep_f, keep_c = a1 >= 95 and a2 >= 95, c1 >= 95 and c2 >= 95
        print(f"Keep news in forecast: {'YES' if keep_f else 'NO'} | in cut warning: {'YES' if keep_c else 'NO'}")
        pn.to_csv(out / "hybrid_news_predictions.csv", index=False)
        if keep_f or keep_c:      # news earned its place -> export the news version
            if a.export:
                _LATEST_N, _ = merge_news(_LATEST, a.news)
                globals()["_LATEST"] = _LATEST_N
                export(dn, pn, a.export, extra=cols)
            a.export = None
    if a.export:
        export(d, p, a.export)
    print(f"\nFinished in {time.time() - t0:.0f} s. Results in {out}/")


if __name__ == "__main__":
    main()
