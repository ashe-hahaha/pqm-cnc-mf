"""Fixed mock prediction series for the demo.

Each manual trigger consumes one entry (cycling through all of them) and produces one tool wear
prediction (diameter, length) plus one quality prediction for a single balloon. Replace the values
below with the real series when it is available; the UI reads the list from the snapshot.
"""

TOOL_NO = "25"
QUALITY_BALLOON_ID = "b1"  # B1: Datum A flatness
# (nominal, +upper, -lower) used when a trigger request carries no spec: 0 … 0.02 mm
DEFAULT_QUALITY_SPEC = (0.0, 0.02, 0.0)

# (diameter wear mm, tool length wear mm, B1 flatness mm)
PREDICTION_SERIES: tuple[tuple[float, float, float], ...] = (
    # 1-9: normal, small and slowly drifting values
    (0.050, 0.020, 0.0050),
    (0.052, 0.021, 0.0062),
    (0.055, 0.022, 0.0055),
    (0.057, 0.023, 0.0073),
    (0.060, 0.024, 0.0068),
    (0.062, 0.026, 0.0085),
    (0.065, 0.027, 0.0079),
    (0.067, 0.028, 0.0092),
    (0.070, 0.030, 0.0088),
    # 10: abnormal, clearly higher than the rest (B1 above its 0.02 mm upper limit)
    (0.350, 0.180, 0.0270),
)
