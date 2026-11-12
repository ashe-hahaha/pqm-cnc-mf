"""Fixed mock prediction series for the demo.

Each manual trigger consumes one entry (cycling through all of them) and produces one tool wear
prediction (diameter, length) plus one quality prediction for a single balloon. Replace the values
below with the real series when it is available; the UI reads the list from the snapshot.
"""

TOOL_NO = "25"
QUALITY_BALLOON_ID = "b1"  # B1: Datum A flatness
# (nominal, +upper, -lower) B1 starts with: 18 ± 0.1 mm, i.e. 17.9 … 18.1 (editable in the UI, then stored by the backend)
DEFAULT_QUALITY_SPEC = (18.0, 0.1, 0.1)

# (diameter wear mm, tool length wear mm, B1 value mm: 18 + the earlier flatness values)
PREDICTION_SERIES: tuple[tuple[float, float, float], ...] = (
    # 1-9: normal, small and slowly drifting values
    (0.050, 0.020, 18.0050),
    (0.052, 0.021, 18.0062),
    (0.055, 0.022, 18.0055),
    (0.057, 0.023, 18.0073),
    (0.060, 0.024, 18.0068),
    (0.062, 0.026, 18.0085),
    (0.065, 0.027, 18.0079),
    (0.067, 0.028, 18.0092),
    (0.070, 0.030, 18.0088),
    # 10: abnormal, clearly higher than the rest (B1 above the 18.1 mm upper limit)
    (0.350, 0.180, 18.1500),
)
