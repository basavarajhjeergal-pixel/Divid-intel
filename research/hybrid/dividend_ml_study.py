"""
dividend_ml_study.py -- structure-aware dividend models + honest walk-forward test.

Input : final_research_dataset.csv (from divfor/data/processed)
Run   : python3 dividend_ml_study.py --csv data/processed/final_research_dataset.csv

Two tasks, both predicted at the end of year t for year t+1, using only past data:
  A) Next year's dividend per share (DPS)          -> accuracy in % of the actual dividend
  B) Will the dividend be CUT next year? (yes/no) -> ROC-AUC, cuts caught, false alarms

Key structural insight used: dividends MEAN-REVERT. A big jump (often a special
dividend or two payments landing in one calendar year) is frequently followed by a
"cut". So features compare this year's dividend with its recent average level.
"""
import argparse
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import (HistGradientBoostingClassifier, HistGradientBoostingRegressor,
                              RandomForestClassifier, RandomForestRegressor)
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")
try:
    from xgboost import XGBClassifier, XGBRegressor
    HAVE_XGB = True
except Exception:
    HAVE_XGB = False

CUT = -0.01            # >1% lower dividend = cut
FIRST_TEST_YEAR = 2005  # walk-forward test years: 2005..last


# ----------------------------------------------------------------------------- features
def build(df):
    df = df[df["Year"] < pd.Timestamp.now().year].copy()
    df = df.sort_values(["Ticker", "Year"])
    rows = []
    for t, g in df.groupby("Ticker"):
        g = g.set_index("Year").reindex(range(g["Year"].min(), g["Year"].max() + 1))
        dps = g["AnnualDividend"].astype(float).where(lambda s: s > 0)
        ld = np.log(dps)
        lg = ld.diff()                                   # log growth this year
        f = pd.DataFrame(index=g.index)
        f["Ticker"] = t
        f["Year"] = g.index
        f["Country"] = g["Country"].ffill().bfill()
        f["CompanyType"] = g["CompanyType"].ffill().bfill()
        f["dps"] = dps
        # --- history / structure features (available for every row)
        f["g_now"] = lg
        f["g_lag1"] = lg.shift(1)
        f["g_avg3"] = lg.rolling(3, min_periods=2).mean()
        f["g_med5"] = lg.rolling(5, min_periods=3).median()
        f["g_std5"] = lg.rolling(5, min_periods=3).std()
        f["spike3"] = ld - ld.shift(1).rolling(3, min_periods=2).mean()   # this year vs prior 3-yr level
        f["spike5"] = ld - ld.rolling(5, min_periods=3).median()
        f["cuts5"] = (lg < np.log1p(CUT)).astype(float).where(lg.notna()).rolling(5, min_periods=1).sum()
        f["years_paying"] = dps.notna().cumsum()
        f["india"] = (f["Country"] == "India").astype(float)
        f["psu"] = (f["CompanyType"] == "PSU").astype(float)
        # --- fundamentals (often missing; trees handle NaN, linear models impute)
        for c in ["PayoutRatio", "FCFPayoutRatio", "DebtToEquity", "ROE", "EPSGrowth", "FCFGrowth", "DividendYield"]:
            f[c] = g[c].astype(float) if c in g.columns else np.nan
        # --- targets
        f["y_log"] = lg.shift(-1)                                 # log(DPS_{t+1}/DPS_t)
        f["y_cut"] = (f["y_log"] < np.log1p(CUT)).astype(float).where(f["y_log"].notna())
        rows.append(f.reset_index(drop=True))
    d = pd.concat(rows, ignore_index=True)
    clip = {"PayoutRatio": (-2, 3), "FCFPayoutRatio": (-3, 5), "DebtToEquity": (-5, 10), "ROE": (-1, 2),
            "EPSGrowth": (-2, 3), "FCFGrowth": (-3, 5), "DividendYield": (0, 0.5)}
    for c, (lo, hi) in clip.items():
        d[c] = d[c].clip(lo, hi)
    for c in ["g_now", "g_lag1", "g_avg3", "g_med5", "spike3", "spike5", "y_log"]:
        d[c] = d[c].clip(-3, 3)
    return d[d["y_log"].notna() & d["g_now"].notna()].reset_index(drop=True)


HIST = ["g_now", "g_lag1", "g_avg3", "g_med5", "g_std5", "spike3", "spike5", "cuts5", "years_paying", "india", "psu"]
FUND = ["PayoutRatio", "FCFPayoutRatio", "DebtToEquity", "ROE", "EPSGrowth", "FCFGrowth", "DividendYield"]
FEATS = HIST + FUND


# ----------------------------------------------------------------------------- models
def regressors():
    m = {
        "Ridge": make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), Ridge(alpha=5.0)),
        "Random Forest": make_pipeline(SimpleImputer(strategy="median"),
                                       RandomForestRegressor(400, max_depth=5, min_samples_leaf=8,
                                                             random_state=42, n_jobs=-1)),
        "Gradient Boosting": HistGradientBoostingRegressor(max_depth=3, learning_rate=0.05, max_iter=250,
                                                           min_samples_leaf=15, l2_regularization=1.0,
                                                           loss="absolute_error", random_state=42),
    }
    if HAVE_XGB:
        m["XGBoost"] = XGBRegressor(n_estimators=300, max_depth=3, learning_rate=0.04, subsample=0.8,
                                    colsample_bytree=0.8, min_child_weight=8, reg_lambda=2.0,
                                    objective="reg:absoluteerror", random_state=42, n_jobs=2, verbosity=0)
    return m


def classifiers(pos_weight):
    m = {
        "Logistic Regression": make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                                             LogisticRegression(C=0.5, class_weight="balanced", max_iter=2000)),
        "Random Forest": make_pipeline(SimpleImputer(strategy="median"),
                                       RandomForestClassifier(400, max_depth=5, min_samples_leaf=8,
                                                              class_weight="balanced", random_state=42, n_jobs=-1)),
        "Gradient Boosting": HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=250,
                                                            min_samples_leaf=15, l2_regularization=1.0,
                                                            class_weight="balanced", random_state=42),
    }
    if HAVE_XGB:
        m["XGBoost"] = XGBClassifier(n_estimators=300, max_depth=3, learning_rate=0.04, subsample=0.8,
                                     colsample_bytree=0.8, min_child_weight=5, reg_lambda=2.0,
                                     scale_pos_weight=pos_weight, eval_metric="logloss",
                                     random_state=42, n_jobs=2, verbosity=0)
    return m


def per_company_rf(hist, row):
    """Current app approach (backend/routes/ml.js): RF on this company's own past only."""
    cols = ["g_now", "g_lag1", "g_avg3"]
    if len(hist) < 3:
        return float(hist["y_log"].iloc[-1]) if len(hist) else 0.0
    rf = RandomForestRegressor(150, max_depth=4, min_samples_leaf=1, random_state=42)
    rf.fit(hist[cols].fillna(0).values, hist["y_log"].values)
    return float(rf.predict(row[cols].fillna(0).values.reshape(1, -1))[0])


# ----------------------------------------------------------------------------- walk-forward
def run(d):
    d = d.copy()
    d["target_year"] = d["Year"] + 1
    out = []
    for Y in sorted(d["target_year"].unique()):
        if Y < FIRST_TEST_YEAR:
            continue
        tr, te = d[d["target_year"] < Y], d[d["target_year"] == Y]
        if te.empty or tr["y_cut"].sum() < 5:
            continue
        F = [c for c in FEATS if tr[c].nunique() > 1]   # skip columns with no data yet (early years)
        p = te[["Ticker", "Country", "CompanyType", "target_year", "y_log", "y_cut", "spike3"]].copy()

        # ---- A) dividend level forecasts (log growth)
        p["Rule: same dividend"] = 0.0
        p["Rule: repeat last growth"] = te["g_now"].values
        p["Rule: 5-yr median growth"] = te["g_med5"].fillna(te["g_now"]).values
        # mean-reversion rule: go back toward the 3-yr level, then add normal growth
        p["Rule: revert to 3-yr level + median growth"] = (
            -te["spike3"].fillna(0) + te["g_med5"].fillna(te["g_now"])).values
        p["Current app (per-company RF)"] = [per_company_rf(tr[tr["Ticker"] == r.Ticker], r)
                                             for _, r in te.iterrows()]
        for name, m in regressors().items():
            m.fit(tr[F], tr["y_log"])
            p[f"ML: {name}"] = m.predict(te[F])
        # hybrid: mean-reversion rule + ML correction (damped)
        rule_tr = (-tr["spike3"].fillna(0) + tr["g_med5"].fillna(tr["g_now"])).values
        rule_te = p["Rule: revert to 3-yr level + median growth"].values
        for name in ["Random Forest", "Gradient Boosting"] + (["XGBoost"] if HAVE_XGB else []):
            m = regressors()[name]
            m.fit(tr[F], tr["y_log"].values - rule_tr)
            p[f"Hybrid: rule + {name}"] = rule_te + 0.5 * m.predict(te[F])

        # ---- B) cut probability
        pw = max(1.0, (tr["y_cut"] == 0).sum() / max(1, tr["y_cut"].sum()))
        p["CUT Rule: base rate"] = tr["y_cut"].mean()
        p["CUT Rule: big spike (>25% above 3-yr level)"] = (te["spike3"] > np.log(1.25)).astype(float).values
        for name, m in classifiers(pw).items():
            m.fit(tr[F], tr["y_cut"].astype(int))
            p[f"CUT {name}"] = m.predict_proba(te[F])[:, 1]
        out.append(p)
    return pd.concat(out, ignore_index=True)


def score_levels(p):
    cols = [c for c in p.columns if c.startswith(("Rule:", "ML:", "Hybrid", "Current"))]
    res = []
    for c in cols:
        ape = np.abs(np.exp(np.clip(p[c] - p["y_log"], -3, 3)) - 1) * 100   # % error vs actual dividend
        ape = np.minimum(ape, 100)                                          # cap one-off outliers at 100%
        dir_true = np.sign(np.where(np.abs(p["y_log"]) < 0.01, 0, p["y_log"]))
        dir_pred = np.sign(np.where(np.abs(p[c]) < 0.01, 0, p[c]))
        res.append({"Model": c,
                    "Accuracy % (100 - avg error)": 100 - ape.mean(),
                    "Avg error %": ape.mean(),
                    "Median error %": np.median(ape),
                    "Within 10%": (ape <= 10).mean() * 100,
                    "Direction right %": (dir_true == dir_pred).mean() * 100,
                    "India avg error %": ape[p["Country"] == "India"].mean(),
                    "USA avg error %": ape[p["Country"] == "USA"].mean()})
    return pd.DataFrame(res).sort_values("Avg error %").reset_index(drop=True)


def score_cuts(p, flag_share=None):
    cols = [c for c in p.columns if c.startswith("CUT ")]
    y = p["y_cut"].astype(int).values
    k = int(round((flag_share or y.mean()) * len(y)))      # flag as many as there are real cuts
    res = []
    for c in cols:
        s = p[c].values.astype(float)
        if np.unique(s).size > 2:
            thr = np.sort(s)[::-1][k - 1]
            flag = s >= thr
            auc, ap = roc_auc_score(y, s), average_precision_score(y, s)
        else:
            flag = s >= 0.5
            auc = roc_auc_score(y, s) if np.unique(s).size > 1 else 0.5
            ap = average_precision_score(y, s) if np.unique(s).size > 1 else y.mean()
        tp = int((flag & (y == 1)).sum())
        res.append({"Model": c.replace("CUT ", ""), "ROC-AUC": auc, "Avg precision": ap,
                    "Cuts caught": f"{tp}/{y.sum()}", "Recall %": tp / y.sum() * 100,
                    "False alarms": int((flag & (y == 0)).sum()),
                    "Precision %": tp / max(1, flag.sum()) * 100})
    return pd.DataFrame(res).sort_values("ROC-AUC", ascending=False).reset_index(drop=True)


def boot_win(p, a, b, n=3000, seed=1):
    rng = np.random.default_rng(seed)
    ea = np.minimum(np.abs(np.exp(np.clip(p[a] - p["y_log"], -3, 3)) - 1), 1).values
    eb = np.minimum(np.abs(np.exp(np.clip(p[b] - p["y_log"], -3, 3)) - 1), 1).values
    idx = rng.integers(0, len(ea), (n, len(ea)))
    return float((ea[idx].mean(1) < eb[idx].mean(1)).mean() * 100)


def boot_auc(p, a, b, n=2000, seed=2):
    rng = np.random.default_rng(seed)
    y = p["y_cut"].astype(int).values
    sa, sb = p[f"CUT {a}"].values, p[f"CUT {b}"].values
    wins = 0
    for _ in range(n):
        i = rng.integers(0, len(y), len(y))
        if y[i].min() == y[i].max():
            continue
        wins += roc_auc_score(y[i], sa[i]) > roc_auc_score(y[i], sb[i])
    return wins / n * 100


def shap_summary(d):
    """Global feature importance for the cut model via XGBoost's built-in TreeSHAP."""
    if not HAVE_XGB:
        return None
    import xgboost as xgb
    pw = (d["y_cut"] == 0).sum() / d["y_cut"].sum()
    m = classifiers(pw)["XGBoost"].fit(d[FEATS], d["y_cut"].astype(int))
    contrib = m.get_booster().predict(xgb.DMatrix(d[FEATS]), pred_contribs=True)[:, :-1]
    return (pd.DataFrame({"Feature": FEATS, "Mean |SHAP|": np.abs(contrib).mean(0)})
            .sort_values("Mean |SHAP|", ascending=False).reset_index(drop=True))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--outdir", default="ml_study_results")
    a = ap.parse_args()
    out = Path(a.outdir); out.mkdir(exist_ok=True)

    d = build(pd.read_csv(a.csv))
    print(f"Rows: {len(d)}  companies: {d['Ticker'].nunique()}  cuts: {int(d['y_cut'].sum())}  "
          f"rows with fundamentals: {d['PayoutRatio'].notna().sum()}  XGBoost: {HAVE_XGB}")
    p = run(d)
    print(f"Test predictions: {len(p)} (years {p['target_year'].min()}-{p['target_year'].max()}), "
          f"real cuts in test: {int(p['y_cut'].sum())}\n")

    lv, ct = score_levels(p), score_cuts(p)
    pd.set_option("display.width", 220); pd.set_option("display.max_columns", 20)
    print("A) NEXT-YEAR DIVIDEND FORECAST"); print(lv.round(1).to_string(index=False))
    print("\nB) DIVIDEND CUT WARNING"); print(ct.round(3).to_string(index=False))

    best = lv.iloc[0]["Model"]
    rule = lv[lv["Model"].str.startswith("Rule")].iloc[0]["Model"]
    print(f"\nBest forecast: {best}")
    if best != rule:
        print(f"  beats best rule ({rule}) in {boot_win(p, best, rule):.0f}% of bootstrap resamples")
    ml_ct = ct[~ct["Model"].str.startswith("Rule")].iloc[0]["Model"]
    print(f"Best cut model: {ml_ct}; beats spike rule on AUC in "
          f"{boot_auc(p, ml_ct, 'Rule: big spike (>25% above 3-yr level)'):.0f}% of resamples")

    sh = shap_summary(d)
    if sh is not None:
        print("\nWhat drives cut risk (XGBoost SHAP importance)"); print(sh.round(4).head(10).to_string(index=False))
        sh.to_csv(out / "cut_model_shap_importance.csv", index=False)
    lv.to_csv(out / "forecast_accuracy.csv", index=False)
    ct.to_csv(out / "cut_warning_results.csv", index=False)
    p.to_csv(out / "all_predictions.csv", index=False)
    print(f"\nSaved results to {out}/")


if __name__ == "__main__":
    main()
