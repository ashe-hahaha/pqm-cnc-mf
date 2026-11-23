"""Fixed mock prediction series for the demo.

Each manual trigger consumes one entry (cycling through all of them) and produces one tool wear
prediction (diameter, length) plus one quality prediction for a single "live" balloon. The other
balloons of the demo drawing are treated as already machined: the UI shows this same series for them
as a fixed, finished record that triggers never change. Replace the values below with the real series
when it is available; the UI reads the list from the snapshot.
"""

TOOL_NO = "25"
QUALITY_BALLOON_ID = "b9"  # the one balloon whose quality prediction is live (changes on every trigger)
QUALITY_BALLOON_CODE = QUALITY_BALLOON_ID.upper()  # shown in events and notifications
# (nominal, +upper, -lower) every balloon starts with (the UI uses the same default for the fixed ones): 18 ± 0.1 mm, i.e. 17.9 … 18.1 (editable in the UI, then stored by the backend)
DEFAULT_QUALITY_SPEC = (18.0, 0.1, 0.1)

# (diameter wear mm, tool length wear mm, quality value mm: 18 + the earlier flatness values)
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
    # 10: abnormal, clearly higher than the rest (quality above the 18.1 mm upper limit)
    (0.350, 0.180, 18.1500),
)

# Finished balloons B1–B8 have a separate, entirely passing quality history.
FIXED_QUALITY_SERIES = tuple(row[2] for row in PREDICTION_SERIES[:9]) + (18.0095,)
