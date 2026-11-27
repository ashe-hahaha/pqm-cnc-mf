"""Demo display fallback; never changes the retained raw measurement."""
from decimal import Decimal

from app.wear_series import PREDICTION_SERIES


def exceeds(raw, reference, limit):
    return abs(Decimal(str(raw)) - Decimal(str(reference))) > Decimal(str(limit))


def tool_measurement(raw, thresholds, settings):
    reference = dict(zip(("diameter", "length"), PREDICTION_SERIES[8][:2]))
    limits = {"diameter": settings.measurement_tool_diameter_max_deviation_mm,
              "length": settings.measurement_tool_length_max_deviation_mm}
    display, fallback = dict(raw), {}
    for key in raw:
        applied = settings.measurement_fallback_enabled and exceeds(raw[key], reference[key], limits[key])
        if applied:
            ratio = 0.9975 if key == "diameter" else 0.98
            display[key] = round(min(reference[key], thresholds[key]) * ratio, 5)
        fallback[key] = {"applied": applied, "reference": reference[key],
                         "reason": f"deviation exceeds {limits[key]} mm" if applied else None}
    return {"rawValue": dict(raw), "displayValue": display, "fallback": fallback}


def quality_measurement(raw):
    """QC always displays the real value, regardless of tool fallback settings."""
    return {"rawValue": raw, "displayValue": raw, "value": raw, "reference": None,
            "fallbackApplied": False, "validationPending": False, "fallbackReason": None}
