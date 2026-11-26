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
# (nominal, +upper, -lower) every balloon starts with (the UI uses the same default for the fixed ones): 18 ± 0.05 mm, i.e. 17.95 … 18.05 (editable in the UI, then stored by the backend)
DEFAULT_QUALITY_SPEC = (18.0, 0.05, 0.05)

# (diameter wear mm, tool length wear mm, quality value mm: 18 + the earlier flatness values)
PREDICTION_SERIES: tuple[tuple[float, float, float], ...] = (
    # 1-9: normal, small and slowly drifting values
    (0.1152, 0.0038, 18.0120),
    (0.1166, 0.0040, 18.0100),
    (0.1178, 0.0041, 17.9980),
    (0.1181, 0.0042, 17.9930),
    (0.1188, 0.0043, 17.9920),
    (0.1198, 0.0045, 17.9890),
    (0.1202, 0.0047, 17.9889),
    (0.1208, 0.0049, 17.9798),
    (0.1210, 0.0050, 17.9737),
    # 10: wear exceeds its upper limits; quality falls below LSL 17.95.
    (0.1216, 0.0053, 17.9400),
)

DEFAULT_WEAR_THRESHOLDS = {"diameter": 0.121, "length": 0.005}
HISTORICAL_WEAR_MEASUREMENTS = {
    3: {"diameter": 0.11779, "length": 0.00408},
    6: {"diameter": 0.11982, "length": 0.00449},
    9: {"diameter": 0.12098, "length": 0.00499},
}

# Finished balloons B1–B8 have a separate, entirely passing quality history.
FIXED_QUALITY_SERIES = (18.0120, 18.0100, 17.9980, 17.9930, 17.9920,
                        17.9890, 17.9889, 17.9798, 17.9737, 17.9700)
FIXED_QUALITY_MEASUREMENTS = {3: 17.9981, 6: 17.9889, 9: 17.9738}
B9_QUALITY_MEASUREMENTS = {3: 17.9981, 6: 17.9889, 9: 17.9738}
