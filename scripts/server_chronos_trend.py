"""Läuft auf dem Chronos-Server: Backtest + 52-Wochen-Forecast je Hotspot-Station.

Backtest: letzte 52 Wochen zurückgehalten, Chronos-2 (q50) gegen Seasonal-Naive
(Wert der Vorjahreswoche). Nur Stationen mit >= 208 Wochen Historie.
Forward: 52-Wochen-Forecast auf der vollen Reihe; Trend = Jahressumme Forecast
vs. letzte 52 realisierte Wochen, Band aus q10/q90-Pfaden (Näherung).

Output: /opt/truckonomics-trend/out/trend_results.json
"""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
from chronos import BaseChronosPipeline

BASE = Path("/opt/truckonomics-trend")
OUT = BASE / "out"
MODEL_ID = "amazon/chronos-2"
HORIZON = 52
MIN_WEEKS_BACKTEST = 208
MIN_WEEKS_FORECAST = 156
QUANTILES = [0.1, 0.5, 0.9]


def load_series() -> dict[str, list[tuple[str, float | None]]]:
    rows = defaultdict(list)
    with open(OUT / "weekly_series.csv") as f:
        for row in csv.DictReader(f):
            value = float(row["lkwWeek"]) if row["lkwWeek"] else None
            rows[row["zst"]].append((row["week"], value))
    return {zst: sorted(items) for zst, items in rows.items()}


def interpolate(values: list[float | None]) -> np.ndarray:
    arr = np.array([np.nan if v is None else v for v in values], dtype=float)
    nans = np.isnan(arr)
    if nans.all():
        return arr
    arr[nans] = np.interp(np.flatnonzero(nans), np.flatnonzero(~nans), arr[~nans])
    return arr


def predict(pipeline, contexts: list[np.ndarray]) -> np.ndarray:
    """Liefert (n_series, n_quantile, horizon)."""
    tensors = [torch.tensor(c, dtype=torch.float32) for c in contexts]
    quantiles, _ = pipeline.predict_quantiles(
        tensors, prediction_length=HORIZON, quantile_levels=QUANTILES
    )
    # chronos-2 liefert (batch, n_variate=1, horizont, n_quantile)
    arr = np.asarray(quantiles)[:, 0, :, :]
    return np.transpose(arr, (0, 2, 1))  # -> (batch, n_quantile, horizont)


def main() -> None:
    device = "cuda" if torch.cuda.is_available() else "cpu"
    try:
        pipeline = BaseChronosPipeline.from_pretrained(MODEL_ID, device_map=device)
    except torch.cuda.OutOfMemoryError:
        pipeline = BaseChronosPipeline.from_pretrained(MODEL_ID, device_map="cpu")
        device = "cpu"
    print(f"Modell {MODEL_ID} auf {device}")

    series = load_series()
    results: dict[str, dict] = {}

    backtest_jobs: list[tuple[str, np.ndarray, np.ndarray]] = []
    forecast_jobs: list[tuple[str, np.ndarray]] = []

    for zst, items in series.items():
        values = interpolate([v for _, v in items])
        if np.isnan(values).all():
            continue
        if len(values) >= MIN_WEEKS_BACKTEST:
            backtest_jobs.append((zst, values[:-HORIZON], values[-HORIZON:]))
        if len(values) >= MIN_WEEKS_FORECAST:
            forecast_jobs.append((zst, values))

    print(f"Backtest: {len(backtest_jobs)} Stationen, Forecast: {len(forecast_jobs)}")

    # --- Backtest ---
    if backtest_jobs:
        q = predict(pipeline, [ctx for _, ctx, _ in backtest_jobs])
        for i, (zst, ctx, actual) in enumerate(backtest_jobs):
            q10, q50, q90 = q[i, 0], q[i, 1], q[i, 2]
            naive = ctx[-HORIZON:]  # Wert der Vorjahreswoche
            mae_chronos = float(np.mean(np.abs(q50 - actual)))
            mae_naive = float(np.mean(np.abs(naive - actual)))
            coverage = float(np.mean((actual >= q10) & (actual <= q90)))
            results.setdefault(zst, {})["backtest"] = {
                "maeChronos": round(mae_chronos),
                "maeNaive": round(mae_naive),
                "skill": round(1 - mae_chronos / mae_naive, 3) if mae_naive > 0 else None,
                "coverage80": round(coverage, 3),
                "holdoutWeeks": HORIZON,
            }

    # --- Forward-Forecast ---
    if forecast_jobs:
        q = predict(pipeline, [values for _, values in forecast_jobs])
        for i, (zst, values) in enumerate(forecast_jobs):
            last_year = float(values[-HORIZON:].sum())
            sums = {f"p{int(level * 100)}": float(q[i, j].sum()) for j, level in enumerate(QUANTILES)}
            results.setdefault(zst, {})["trend"] = {
                "lastYearWeeklyAvg": round(last_year / HORIZON),
                "trendPctP10": round((sums["p10"] / last_year - 1) * 100, 1),
                "trendPctP50": round((sums["p50"] / last_year - 1) * 100, 1),
                "trendPctP90": round((sums["p90"] / last_year - 1) * 100, 1),
                "contextWeeks": int(len(values)),
            }

    skills = [
        r["backtest"]["skill"]
        for r in results.values()
        if r.get("backtest", {}).get("skill") is not None
    ]
    coverages = [r["backtest"]["coverage80"] for r in results.values() if r.get("backtest")]
    summary = {
        "model": MODEL_ID,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "horizonWeeks": HORIZON,
        "stationsBacktested": len(skills),
        "medianSkillVsSeasonalNaive": round(float(np.median(skills)), 3) if skills else None,
        "stationsBeatingNaive": int(sum(1 for s in skills if s > 0)),
        "meanCoverage80": round(float(np.mean(coverages)), 3) if coverages else None,
    }

    (OUT / "trend_results.json").write_text(
        json.dumps({"summary": summary, "stations": results}, indent=1), encoding="utf-8"
    )
    print(json.dumps(summary, indent=2))
    print("FERTIG")


if __name__ == "__main__":
    main()
