# Hybrid dividend model

Predicts next year's dividend per share, an 80% range, and the chance of a dividend cut,
for the 16 research companies (11 India, 5 US). The app reads the saved predictions from
`backend/data/hybrid_predictions.json`; nothing is trained on request.

## Backtest (walk-forward 2005–2025, 317 predictions, only earlier years used each time)

| Model | Accuracy | Typical error | Within 10% |
|---|---|---|---|
| Same as last year | 77.1% | 12.3% | 43.8% |
| Gradient Boosting | 79.9% | 8.6% | 53.3% |
| **Hybrid** | **80.5%** | **7.0%** | **56.8%** |

- Beats "same as last year" in 100% of re-tests that resample whole years; beats Gradient Boosting in 92% (promising, below the 95% bar).
- 80% ranges contained the real dividend 81.5% of the time.
- Cut warning ROC-AUC 0.823 (Random Forest 0.808, Bayesian 0.819).
- Indian PSUs stay hard (about 33% error): the model learns to trust ML only 32% for them.

Accuracy = 100 − average % error vs the actual dividend, each error capped at 100%.

## How it works

1. **Bayesian cut signal:** each company's cut rate (its group's history + its own past cuts), using only outcomes already known. Fed into the forecast as a feature.
2. **Gradient Boosting forecast:** trained on absolute error of log dividend growth, the error it is scored on.
3. **Trust weighting:** per group (India PSU / India private / US), learned from earlier years: forecast = weight × ML + (1 − weight) × "same as last year".
4. **80% ranges:** from each group's own earlier forecast errors.
5. **Cut warning:** Random Forest + Bayesian (with a "big jump" term), calibrated to real cut rates.

## Retrain and update the app

```
cd research/hybrid
python3 hybrid_model.py --csv data/final_research_dataset.csv \
    --export ../../backend/data/hybrid_predictions.json
```

With news (from `export_news_features.py`):

```
python3 hybrid_model.py --csv data/final_research_dataset.csv \
    --news data/news_features_yearly.csv \
    --export ../../backend/data/hybrid_predictions.json
```

News is kept only if it beats both "no news" and the same news shuffled between companies
(a placebo) in at least 95% of year-resampled re-tests. Otherwise the export uses the no-news
model and the run says so. Random fake news is correctly rejected by this check.

Needs: pandas, numpy, scikit-learn.

## App

- `GET /api/forecast/:ticker`: forecast, 80% range, cut risk, backtest numbers.
- The AI Advisor uses the hybrid forecast and its 80% range for covered stocks, and the old model elsewhere (labelled).
- The hybrid card appears in the AI Advisor and Model Comparison tabs.
