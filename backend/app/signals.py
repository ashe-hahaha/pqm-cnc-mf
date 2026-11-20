"""Upstream signals shared by all subscribers (SSE and WebSocket) of a machine.

Default (`SIGNALS_MODE=live`): one long-lived connection to the data service's `/ws/live`, which pushes the trailing
window about every 500 ms. `SIGNALS_MODE=snapshot` keeps the older one-shot query every `SIGNALS_POLL_SECONDS`.
"""
import asyncio
import json
import logging
import math
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from time import monotonic
from typing import Literal
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, Field
from websockets.asyncio.client import connect

from app.config import Settings

CHANNELS = ("spindle.vibration_x", "spindle.vibration_y", "spindle.vibration_z", "ae.rms")
LIVE_MAX_WINDOW_MS = 30000  # the upstream caps /ws/live windows here
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


def live_url(settings: Settings) -> str:
    """`SIGNALS_WS_URL` (…/ws) → the live endpoint (…/ws/live); an URL that already ends in /live is kept."""
    parts = urlsplit(settings.signals_ws_url)
    path = parts.path.rstrip("/")
    if not path.endswith("/live"):
        path += "/live"
    query = parts.query
    if settings.signals_environment != "real":
        query = "&".join(item for item in (query, f"environment={settings.signals_environment}") if item)
    return urlunsplit((parts.scheme, parts.netloc, path, query, ""))


def live_subscribe(settings: Settings, machine: str) -> dict:
    return {"type": "subscribe", "machine_id": machine, "window_ms": min(settings.signals_window_ms, LIVE_MAX_WINDOW_MS),
            "channels": list(CHANNELS), "include_process": True, "width_px": 1000}


def parse_live_update(frame: dict, machine: str) -> tuple[dict, bool]:
    """A `live_update` frame (meta / waveforms / process, like GET /api/window) → (batch, live_idle)."""
    meta = frame["meta"]
    for key in ("start", "end", "t_max"):  # validate dates before sending them to clients
        datetime.fromisoformat(meta[key].replace("Z", "+00:00"))
    if meta["machine_id"] != machine:
        raise ValueError("machine mismatch")
    waves = {}
    for wave in frame["waveforms"].values():
        parsed = Waveform.model_validate(wave)
        waves[parsed.channel] = parsed.model_dump(mode="json")
    if set(waves) != set(CHANNELS):
        raise ValueError("incomplete signal response")
    rows = frame.get("process") or []
    if isinstance(rows, dict):
        rows = rows.get("rows", [])
    batch = {**{key: meta[key] for key in ("start", "end", "t_max", "machine_id")},
             "channels": [waves[channel] for channel in CHANNELS], "process": json_safe(rows)}
    return batch, bool(meta.get("live_idle"))


def row_key(row: dict):
    return row.get("fanuc_raw_id") or row.get("timestamp")


def make_delta(previous: dict | None, batch: dict) -> tuple[str, dict]:
    """What a WebSocket client needs after `previous`: only new or changed points / rows, or the whole batch.

    The whole batch ("snapshot") is sent when there is nothing to compare with or the series do not line up
    (another bucket width, no point in common). Clients drop everything older than `start` themselves.
    """
    if previous is None or previous.get("machine_id") != batch.get("machine_id"):
        return "snapshot", batch
    before = {wave.get("channel"): wave for wave in previous.get("channels", [])}
    channels = []
    for wave in batch.get("channels", []):
        old = before.get(wave.get("channel"))
        if old is None or old.get("bucket_ms") != wave.get("bucket_ms"):
            return "snapshot", batch
        known = {point["t"]: point for point in old.get("points", [])}
        points = wave.get("points", [])
        if known and points and not any(point["t"] in known for point in points):
            return "snapshot", batch
        channels.append({"channel": wave["channel"], "bucket_ms": wave["bucket_ms"],
                         "points": [point for point in points if known.get(point["t"]) != point]})
    known_rows = {row_key(row): row for row in previous.get("process", [])}
    rows = [row for row in batch.get("process", []) if known_rows.get(row_key(row)) != row]
    return "delta", {**{key: batch.get(key) for key in ("machine_id", "start", "end", "t_max")},
                     "channels": channels, "process": rows}


def sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(json_safe(payload), allow_nan=False)}\n\n"


class Feed:
    def __init__(self):
        self.listeners: set[asyncio.Queue] = set()  # SSE: whole batches
        self.streams: set[asyncio.Queue] = set()  # WebSocket: snapshot, then deltas
        self.latest: dict | None = None
        self.last_change = monotonic()
        self.status = {"state": "connecting"}
        self.task: asyncio.Task | None = None
        self.state: dict = {}  # per-feed scratch space for on_batch observers; dropped with the feed

    def publish(self, event: str, payload: dict):
        for queue in self.listeners:
            if queue.full():
                queue.get_nowait()
            queue.put_nowait((event, payload))

    def publish_stream(self, event: str, payload: dict):
        """A client that falls behind would miss deltas, so its queue is replaced by one fresh snapshot."""
        for queue in self.streams:
            if queue.full():
                while not queue.empty():
                    queue.get_nowait()
                if self.latest is not None:
                    event, payload = "snapshot", {**self.latest, "status": self.status}
            queue.put_nowait((event, payload))


class SignalHub:
    def __init__(self, settings: Settings, fetcher=None, on_batch=None):
        self.settings = settings
        self.fetcher = fetcher  # a one-shot query function; when set (tests, snapshot mode) the hub polls it
        self.on_batch = on_batch  # called as on_batch(machine, batch, feed.state) after every successful query
        self.feeds: dict[str, Feed] = {}

    def observe(self, machine: str, feed: Feed, batch: dict):
        if self.on_batch:
            try:
                self.on_batch(machine, batch, feed.state)
            except Exception:
                logger.warning("Signal observer failed for %s", machine, exc_info=True)

    def handle_batch(self, machine: str, feed: Feed, batch: dict, idle: bool = False):
        """One successful upstream response: observers, change detection, status and fan-out."""
        self.observe(machine, feed, batch)
        kind = frame = None  # what WebSocket clients get besides the status
        if idle and feed.latest is not None:
            batch = feed.latest  # the upstream sends an empty frame when nothing new arrives: keep the last picture
        elif feed.latest is None or batch != feed.latest:
            if feed.streams:
                kind, frame = make_delta(feed.latest, batch)
            feed.latest = batch
            feed.last_change = monotonic()
            feed.publish("signals", batch)
        data_time = datetime.fromisoformat(batch["t_max"].replace("Z", "+00:00"))
        age = max(0, (datetime.now(timezone.utc) - data_time).total_seconds())
        empty = not any(channel["points"] for channel in batch["channels"])
        stale = idle or age > self.settings.signals_stale_seconds or monotonic() - feed.last_change > self.settings.signals_stale_seconds
        feed.status = {"state": "empty" if empty else "stale" if stale else "live", "dataTime": batch["t_max"], "ageSeconds": round(age, 1)}
        feed.publish("status", feed.status)
        if kind is None:
            feed.publish_stream("status", feed.status)
        else:
            feed.publish_stream(kind, {**frame, "status": feed.status})

    def mark_unavailable(self, feed: Feed):
        feed.status = {"state": "unavailable", "message": "Signal source unavailable; retrying"}
        feed.publish("status", feed.status)
        feed.publish_stream("status", feed.status)

    async def poll(self, machine: str, feed: Feed):
        while True:
            try:
                self.handle_batch(machine, feed, await (self.fetcher or fetch_signals)(self.settings, machine))
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("Signal query failed for %s", machine, exc_info=True)
                self.mark_unavailable(feed)
            await asyncio.sleep(self.settings.signals_poll_seconds)

    async def live(self, machine: str, feed: Feed):
        """Keep one `/ws/live` connection open and turn every `live_update` into a batch; reconnect with a back-off."""
        settings, delay = self.settings, 1.0
        while True:
            try:
                async with connect(live_url(settings), max_size=16 * 1024 * 1024, close_timeout=1) as ws:
                    await ws.send(json.dumps(live_subscribe(settings, machine)))
                    delay, last_frame = 1.0, monotonic()
                    while True:
                        try:
                            message = await asyncio.wait_for(ws.recv(), timeout=settings.signals_poll_seconds)
                        except TimeoutError:
                            if monotonic() - last_frame > settings.signals_live_timeout_seconds:
                                raise TimeoutError("no frames from the upstream")
                            if feed.latest is not None:  # quiet upstream: tell observers the feed is still being watched
                                self.observe(machine, feed, feed.latest)
                            continue
                        last_frame = monotonic()
                        frame = json.loads(message)
                        if frame.get("type") == "live_update":
                            batch, idle = parse_live_update(frame, machine)
                            self.handle_batch(machine, feed, batch, idle)
                        elif frame.get("type") == "error":
                            raise ValueError("upstream reported an error")
                        # "idle" keepalives and other frames only prove that the connection is alive
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("Live signal connection failed for %s", machine, exc_info=True)
                self.mark_unavailable(feed)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30.0)

    @asynccontextmanager
    async def subscribe(self, machine: str, stream: bool = False):
        """Queue of (event, payload). SSE: signals / status. `stream=True` (WebSocket): snapshot / delta / status."""
        feed = self.feeds.get(machine)
        if feed is None:
            feed = self.feeds[machine] = Feed()
        queue = asyncio.Queue(maxsize=16 if stream else 8)
        (feed.streams if stream else feed.listeners).add(queue)
        if feed.latest is not None:
            queue.put_nowait(("snapshot", {**feed.latest, "status": feed.status}) if stream else ("signals", feed.latest))
        if not stream or feed.latest is None:
            queue.put_nowait(("status", feed.status))
        if feed.task is None:
            run = self.poll if self.fetcher is not None or self.settings.signals_mode == "snapshot" else self.live
            feed.task = asyncio.create_task(run(machine, feed))
        try:
            yield queue
        finally:
            feed.listeners.discard(queue)
            feed.streams.discard(queue)
            if not feed.listeners and not feed.streams:
                self.feeds.pop(machine, None)
                feed.task.cancel()
                await asyncio.gather(feed.task, return_exceptions=True)

    async def close(self):
        tasks = [feed.task for feed in self.feeds.values() if feed.task]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.feeds.clear()
