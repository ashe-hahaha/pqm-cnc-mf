"""Measurement serialization: display values always equal retained raw values."""


def tool_measurement(raw):
    return {"rawValue": dict(raw), "displayValue": dict(raw)}


def quality_measurement(raw):
    return {"rawValue": raw, "displayValue": raw, "value": raw, "reference": None,
            "fallbackApplied": False, "validationPending": False, "fallbackReason": None}
