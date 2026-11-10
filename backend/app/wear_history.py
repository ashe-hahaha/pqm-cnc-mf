"""HTTP adapter for hot controller compensation history."""
import asyncio
import math
import re
from datetime import datetime, timezone, timedelta
from time import monotonic

import httpx

from app.config import Settings
from app.sources import SourceError


def number(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def tool_key(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    match = re.fullmatch(r"T?([0-9]+)", str(value).strip(), re.IGNORECASE)
    if match is None:
        return None
    return match[1].lstrip("0") or "0"


def normalize(rows, tool=None):
    points = []
    for row in rows:
        actual_tool = tool_key(row.get("process_values.tool_no"))
        if tool is not None and actual_tool != tool_key(tool):
            continue
        stamp = number(row.get("timestamp_epoch"))
        if stamp is None:
            stamp = datetime.fromisoformat(row["timestamp_utc"].replace("Z", "+00:00")).timestamp() * 1000
        points.append({"timestampEpoch": stamp, "timestamp": datetime.fromtimestamp(stamp / 1000, timezone.utc).isoformat(),
                       "toolNo": actual_tool,
                       "xWearMm": number(row.get("process_values.tool_wear_x_mm")),
                       "zWearMm": number(row.get("process_values.tool_wear_z_mm"))})
    points.sort(key=lambda p: p["timestampEpoch"])
    segments = {"x": 0, "z": 0}
    previous_tool = None
    for point in points:
        if previous_tool is not None and point["toolNo"] is not None and previous_tool != point["toolNo"]:
            segments = {axis: value + 1 for axis, value in segments.items()}
        if point["toolNo"] is not None:
            previous_tool = point["toolNo"]
        for axis in segments:
            if point[f"{axis}WearMm"] is None:
                segments[axis] += 1
            point[f"{axis}Segment"] = segments[axis]
    return points


def reduce_points(points, limit):
    if len(points) <= limit:
        return points
    # Keep first/last and both axes' extrema per bucket, across the entire range.
    size = math.ceil(len(points) / max(1, limit // 6))
    selected = set()
    for start in range(0, len(points), size):
        end = min(start + size, len(points))
        selected.update((start, end - 1))
        for key in ("xWearMm", "zWearMm"):
            valid = [i for i in range(start, end) if points[i][key] is not None]
            if valid:
                selected.add(min(valid, key=lambda i: points[i][key]))
                selected.add(max(valid, key=lambda i: points[i][key]))
    return [points[i] for i in sorted(selected)]


class WearHistoryService:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self.settings = settings
        self.client = client or httpx.AsyncClient(base_url=settings.history_base_url.rstrip("/") + "/",
            timeout=settings.history_timeout_seconds,
            headers={"Authorization": f"Bearer {settings.upstream_api_token.get_secret_value()}"} if settings.upstream_api_token.get_secret_value() else {})
        self.cache = {}
        self.lock = asyncio.Lock()

    async def close(self):
        await self.client.aclose()

    async def query(self, machine, tool, start, end, minutes, limit):
        key = (machine, start, end, minutes if start is None else None)
        async with self.lock:
            cached = self.cache.get(key)
            try:
                if cached and monotonic() - cached[0] < 4:
                    start, end, points = cached[1]
                else:
                    if start is None:
                        end = datetime.now(timezone.utc)
                        start = end - timedelta(minutes=minutes)
                    response = await self.client.get("api/history/fanuc_tool_wear", params={
                        "machine_id": machine, "environment": self.settings.history_environment,
                        "start_time_epoch": math.floor(start.timestamp() * 1000),
                        "end_time_epoch": math.ceil(end.timestamp() * 1000), "format": "json_record", "downsampling": "raw",
                    })
                    response.raise_for_status()
                    payload = response.json()
                    if payload.get("machine_id") != machine or not isinstance(payload.get("data"), list):
                        raise ValueError("invalid history response")
                    points = normalize(payload["data"])
                    points = [p for p in points if start.timestamp() * 1000 <= p["timestampEpoch"] < end.timestamp() * 1000]
                    self.cache = {key: (monotonic(), (start, end, points))}
                tools = list(dict.fromkeys(point["toolNo"] for point in points))
                if tool is not None:
                    selected = tool_key(tool)
                    points = [point for point in points if point["toolNo"] == selected]
                return {"machine_id": machine, "tool_no": tool, "start": start, "end": end,
                    "unit": "mm", "source": "history_api", "environment": self.settings.history_environment,
                    "availableToolNos": tools,
                    "data": reduce_points(points, limit), "totalPoints": len(points),
                    "downsampled": len(points) > limit, "truncated": False}
            except (httpx.TimeoutException, TimeoutError):
                raise SourceError("history_upstream_timeout", 504) from None
            except (httpx.HTTPError, ValueError, KeyError, TypeError, OverflowError):
                raise SourceError("history_upstream_unavailable_or_invalid", 502) from None
