"""Durable latest-capture storage and independent Kafka-to-SSE delivery."""
import asyncio
import base64
import hashlib
import io
import json
import logging
import os
import sqlite3
import warnings
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from aiokafka import AIOKafkaConsumer, TopicPartition
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, ValidationError

from app.config import Settings
from app.signals import json_safe

logger = logging.getLogger("uvicorn.error")


class InvalidCapture(ValueError):
    pass


class Capture(BaseModel):
    schemaVersion: str
    captureId: UUID
    machineId: str = Field(min_length=1, max_length=128)
    toolNo: str = Field(min_length=1, max_length=64)
    timestampUtc: datetime
    contentType: str
    payloadEncoding: str
    payload: str | None = None
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    imageBytes: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[a-fA-F0-9]{64}$")
    prediction: float | None = None
    threshold: float | None = None
    inspectionResult: str | None = None
    measurements: list = Field(default_factory=list)
    device: dict = Field(default_factory=dict)


class ImageStore:
    def __init__(self, directory: str, max_bytes: int):
        self.root = Path(directory).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.database = self.root / "captures.sqlite3"
        self.max_bytes = max_bytes
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS captures (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, sha TEXT NOT NULL, filename TEXT NOT NULL, metadata TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS rejected (topic TEXT, partition_id INTEGER, offset_id INTEGER, reason TEXT, received_at TEXT, PRIMARY KEY(topic, partition_id, offset_id))")

    def connect(self):
        return sqlite3.connect(self.database, timeout=10)

    def latest(self):
        with self.connect() as db:
            row = db.execute("SELECT metadata FROM captures ORDER BY seq DESC LIMIT 1").fetchone()
        return json.loads(row[0]) if row else None

    def image(self, capture_id: str):
        with self.connect() as db:
            row = db.execute("SELECT filename, metadata FROM captures WHERE id = ?", (capture_id,)).fetchone()
        if row is None:
            return None
        return self.root / row[0], json.loads(row[1])["contentType"]

    def reject(self, topic: str, partition: int, offset: int, reason: str):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO rejected VALUES (?, ?, ?, ?, ?)",
                       (topic, partition, offset, reason, datetime.now(timezone.utc).isoformat()))

    def save(self, value: bytes):
        try:
            capture = Capture.model_validate(json_safe(json.loads(value)))
        except (ValidationError, ValueError, TypeError, UnicodeError):
            raise InvalidCapture("invalid_capture_schema") from None
        if capture.schemaVersion != "1.0.0" or capture.timestampUtc.tzinfo is None:
            raise InvalidCapture("unsupported_schema_or_timestamp")
        if capture.payloadEncoding != "base64" or not capture.payload:
            raise InvalidCapture("image_payload_not_provided")
        if capture.contentType not in ("image/png", "image/jpeg"):
            raise InvalidCapture("unsupported_image_type")
        if capture.imageBytes > self.max_bytes or len(capture.payload) > 4 * ((self.max_bytes + 2) // 3):
            raise InvalidCapture("image_too_large")
        try:
            data = base64.b64decode(capture.payload, validate=True)
        except ValueError:
            raise InvalidCapture("invalid_base64") from None
        digest = hashlib.sha256(data).hexdigest()
        if len(data) != capture.imageBytes or digest != capture.sha256.lower():
            raise InvalidCapture("image_size_or_hash_mismatch")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(data)) as image:
                    actual_type = {"PNG": "image/png", "JPEG": "image/jpeg"}.get(image.format)
                    if actual_type != capture.contentType or image.size != (capture.width, capture.height):
                        raise InvalidCapture("image_format_or_dimensions_mismatch")
                    image.verify()
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise InvalidCapture("invalid_image") from None
        capture_id = str(capture.captureId)
        suffix = ".png" if capture.contentType == "image/png" else ".jpg"
        filename = capture_id + suffix
        metadata = capture.model_dump(mode="json", exclude={"payload"})
        metadata.update(sha256=digest, receivedAt=datetime.now(timezone.utc).isoformat(),
                        imageUrl=f"/api/tool-images/{capture_id}/image")
        metadata = json_safe(metadata)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT sha FROM captures WHERE id = ?", (capture_id,)).fetchone()
            if old:
                if old[0] != digest:
                    raise InvalidCapture("capture_id_hash_conflict")
                return None
            temp = self.root / f"{uuid4()}.tmp"
            try:
                with temp.open("wb") as out:
                    out.write(data)
                    out.flush()
                    os.fsync(out.fileno())
                os.replace(temp, self.root / filename)
                cursor = db.execute("INSERT INTO captures(id,sha,filename,metadata) VALUES (?,?,?,?)",
                                    (capture_id, digest, filename, json.dumps(metadata, allow_nan=False)))
                metadata["receivedSequence"] = cursor.lastrowid
                db.execute("UPDATE captures SET metadata=? WHERE id=?",
                           (json.dumps(metadata, allow_nan=False), capture_id))
            finally:
                temp.unlink(missing_ok=True)
        return metadata


class ToolImageService:
    def __init__(self, settings: Settings, consumer_factory=AIOKafkaConsumer):
        self.settings = settings
        self.store = ImageStore(settings.microscope_image_dir, settings.microscope_max_image_bytes)
        self.consumer_factory = consumer_factory
        self.task = None
        self.listeners: set[asyncio.Queue] = set()
        self.status = {"state": "connecting" if settings.microscope_kafka_enabled else "disabled"}

    def publish(self, event: str, payload: dict):
        for queue in self.listeners:
            if queue.full():
                queue.get_nowait()
            queue.put_nowait((event, payload))

    def set_status(self, state: str):
        self.status = {"state": state}
        self.publish("status", self.status)

    def start(self):
        if self.settings.microscope_kafka_enabled:
            self.task = asyncio.create_task(self.consume())

    async def process_record(self, consumer, record):
        try:
            if record.value is None:
                raise InvalidCapture("empty_kafka_value")
            if len(record.value) > self.settings.microscope_kafka_max_message_bytes:
                raise InvalidCapture("kafka_message_too_large")
            metadata = await asyncio.to_thread(self.store.save, record.value)
        except InvalidCapture as exc:
            await asyncio.to_thread(self.store.reject, record.topic, record.partition, record.offset, str(exc))
            logger.warning("Rejected microscope capture topic=%s partition=%s offset=%s reason=%s",
                           record.topic, record.partition, record.offset, str(exc))
        else:
            if metadata is not None:
                self.publish("image", metadata)
                logger.info("Microscope image received from Kafka capture=%s tool=%s topic=%s partition=%s offset=%s",
                            metadata["captureId"], metadata["toolNo"], record.topic, record.partition, record.offset)
        # Persisted images/rejections survive restarts before the offset is advanced.
        await consumer.commit({TopicPartition(record.topic, record.partition): record.offset + 1})

    async def consume(self):
        cfg = self.settings
        while True:
            consumer = self.consumer_factory(
                cfg.microscope_kafka_topic, bootstrap_servers=cfg.microscope_kafka_bootstrap_servers,
                group_id=cfg.microscope_kafka_group_id, client_id=cfg.microscope_kafka_client_id,
                auto_offset_reset=cfg.microscope_kafka_auto_offset_reset, enable_auto_commit=False,
                max_partition_fetch_bytes=cfg.microscope_kafka_max_message_bytes + 1048576,
                fetch_max_bytes=cfg.microscope_kafka_max_message_bytes + 1048576,
                max_poll_records=1, request_timeout_ms=10000, retry_backoff_ms=1000,
            )
            try:
                self.set_status("connecting")
                await consumer.start()
                self.set_status("connected")
                async for record in consumer:
                    await self.process_record(consumer, record)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Microscope Kafka consumer retrying (%s)", type(exc).__name__)
                self.set_status("unavailable")
            finally:
                await consumer.stop()
            await asyncio.sleep(3)

    @asynccontextmanager
    async def subscribe(self):
        queue = asyncio.Queue(maxsize=8)
        self.listeners.add(queue)
        try:
            queue.put_nowait(("status", self.status))
            latest = await asyncio.to_thread(self.store.latest)
            if latest:
                queue.put_nowait(("image", latest))
            yield queue
        finally:
            self.listeners.discard(queue)

    async def close(self):
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
