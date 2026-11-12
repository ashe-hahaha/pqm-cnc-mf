"""One-shot upstream queries shared by all SSE subscribers for a machine."""
import asyncio
import json
import logging
import math
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from time import monotonic
from typing import Literal

from pydantic import BaseModel, Field
from websockets.asyncio.client import connect

from app.config import Settings

CHANNELS = ("spindle.vibration_x", "spindle.vibration_y", "spindle.vibration_z", "ae.rms")
logger = logging.getLogger(__name__)


def json_safe(value):
    """Represent missing/non-finite upstream measurements as JSON null."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    return value


class Point(BaseModel):
    model_config = {"allow_inf_nan": False}
    t: datetime
    min: float
    max: float
    first: float
    last: float


class Waveform(BaseModel):
    channel: Literal["spindle.vibration_x", "spindle.vibration_y", "spindle.vibration_z", "ae.rms"]
    method: Literal["m4"]
    bucket_ms: int = Field(ge=1)
    points: list[Point] = Field(max_length=4000)


async def fetch_signals(settings: Settings, machine: str) -> dict:
    async with asyncio.timeout(settings.upstream_timeout_seconds):
        async with connect(settings.signals_ws_url, max_size=8 * 1024 * 1024, close_timeout=1) as ws:
            await ws.send(json.dumps({
                "type": "subscribe", "mode": "latest", "window_kind": "duration",
                "machine_id": machine, "window_ms": settings.signals_window_ms,
                "channels": CHANNELS, "include_process": True, "width_px": 1000,
            }))
            meta = None
            waves = {}
            process = []
            async for message in ws:
                frame = json.loads(message)
                if frame["type"] == "error":
                    raise ValueError("upstream reported an error")
                if frame["type"] == "meta":
                    # Validate dates before sending them to clients.
                    for key in ("start", "end", "t_max"):
                        datetime.fromisoformat(frame[key].replace("Z", "+00:00"))
                    meta = {key: frame[key] for key in ("start", "end", "t_max", "machine_id")}
                    if meta["machine_id"] != machine:
                        raise ValueError("machine mismatch")
                elif frame["type"] == "waveform":
                    wave = Waveform.model_validate(frame)
                    waves[wave.channel] = wave.model_dump(mode="json")
                elif frame["type"] == "process":
                    process = json_safe(frame.get("rows", []))
                elif frame["type"] == "done":
                    if meta is None or set(waves) != set(CHANNELS):
                        raise ValueError("incomplete signal response")
                    batch = {**meta, "channels": list(waves.values()), "process": process}
                    latest = max(process, key=lambda row: row.get("timestamp") or "", default={})
                    print(json.dumps({
                        "event": "upstream_controller",
                        "machine_id": machine,
                        "row_count": len(process),
                        **{key: latest.get(key) for key in (
                            "timestamp", "tool_no", "feed_rate", "spindle_speed", "AP", "AE",
                        )},
                    }, ensure_ascii=False, allow_nan=False), flush=True)
                    return batch
            raise ValueError("upstream closed before done")


def sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(json_safe(payload), allow_nan=False)}\n\n"


class Feed:
    def __init__(self):
        self.listeners: set[asyncio.Queue] = set()
        self.latest: dict | None = None
        self.status = {"state": "connecting"}
        self.task: asyncio.Task | None = None
        self.state: dict = {}  # per-feed scratch space for on_batch observers; dropped with the feed

    def publish(self, event: str, payload: dict):
        for queue in self.listeners:
            if queue.full():
                queue.get_nowait()
            queue.put_nowait((event, payload))


class SignalHub:
    def __init__(self, settings: Settings, fetcher=fetch_signals, on_batch=None):
        self.settings = settings
        self.fetcher = fetcher
        self.on_batch = on_batch  # called as on_batch(machine, batch, feed.state) after every successful query
        self.feeds: dict[str, Feed] = {}

    async def poll(self, machine: str, feed: Feed):
        last_change = monotonic()
        while True:
            try:
                batch = await self.fetcher(self.settings, machine)
                if self.on_batch:
                    try:
                        self.on_batch(machine, batch, feed.state)
                    except Exception:
                        logger.warning("Signal observer failed for %s", machine, exc_info=True)
                if feed.latest is None or batch != feed.latest:
                    feed.latest = batch
                    last_change = monotonic()
                    feed.publish("signals", batch)
                data_time = datetime.fromisoformat(batch["t_max"].replace("Z", "+00:00"))
                age = max(0, (datetime.now(timezone.utc) - data_time).total_seconds())
                empty = not any(channel["points"] for channel in batch["channels"])
                stale = age > self.settings.signals_stale_seconds or monotonic() - last_change > self.settings.signals_stale_seconds
                feed.status = {"state": "empty" if empty else "stale" if stale else "live", "dataTime": batch["t_max"], "ageSeconds": round(age, 1)}
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("Signal query failed for %s", machine, exc_info=True)
                feed.status = {"state": "unavailable", "message": "Signal source unavailable; retrying"}
            feed.publish("status", feed.status)
            await asyncio.sleep(self.settings.signals_poll_seconds)

    @asynccontextmanager
    async def subscribe(self, machine: str):
        feed = self.feeds.get(machine)
        if feed is None:
            feed = self.feeds[machine] = Feed()
        queue = asyncio.Queue(maxsize=8)
        feed.listeners.add(queue)
        if feed.latest is not None:
            queue.put_nowait(("signals", feed.latest))
        queue.put_nowait(("status", feed.status))
        if feed.task is None:
            feed.task = asyncio.create_task(self.poll(machine, feed))
        try:
            yield queue
        finally:
            feed.listeners.discard(queue)
            if not feed.listeners:
                self.feeds.pop(machine, None)
                feed.task.cancel()
                await asyncio.gather(feed.task, return_exceptions=True)

    async def close(self):
        tasks = [feed.task for feed in self.feeds.values() if feed.task]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.feeds.clear()
