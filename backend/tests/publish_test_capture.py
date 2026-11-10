"""Publish one local microscope image as a Kafka test capture."""

import argparse
import asyncio
import base64
import hashlib
import json
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from aiokafka import AIOKafkaProducer
from PIL import Image

DEFAULT_IMAGE = Path(__file__).with_name("test.png")
MAX_MESSAGE_BYTES = 50_000_000
TIMEOUT_SECONDS = 10


def build_message(path: Path, machine_id: str, tool_no: str) -> dict:
    image_bytes = path.read_bytes()
    with Image.open(BytesIO(image_bytes)) as image:
        content_type = {"PNG": "image/png", "JPEG": "image/jpeg"}.get(image.format)
        if content_type is None:
            raise ValueError("Use a PNG or JPEG image.")
        width, height = image.size
        image.verify()

    capture_id = str(uuid4())
    return {
        "schemaVersion": "1.0.0",
        "captureId": capture_id,
        "machineId": machine_id,
        "toolNo": tool_no,
        "timestampUtc": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "contentType": content_type,
        "payloadEncoding": "base64",
        "payload": base64.b64encode(image_bytes).decode("ascii"),
        "width": width,
        "height": height,
        "imageBytes": len(image_bytes),
        "sha256": hashlib.sha256(image_bytes).hexdigest(),
        "localPath": str(path),
        "imageUrl": f"/api/captures/{capture_id}/image",
        "prediction": 0.0,
        "threshold": 0.0,
        "inspectionResult": "manual test",
        "measurements": [],
        "device": {},
    }


async def publish(args) -> None:
    message = build_message(args.image, args.machine, args.tool)
    value = json.dumps(message, separators=(",", ":")).encode("utf-8")
    if len(value) >= MAX_MESSAGE_BYTES:
        raise ValueError(f"Encoded JSON is {len(value)} bytes. Use a smaller image.")

    key = message["captureId"].encode("utf-8")
    headers = [
        ("schemaVersion", b"1.0.0"),
        ("contentType", b"application/json"),
        ("payloadEncoding", b"base64"),
    ]
    producer = AIOKafkaProducer(
        bootstrap_servers=args.broker,
        client_id="pqm-cnc-microscope-test",
        acks="all",
        enable_idempotence=True,
        max_request_size=MAX_MESSAGE_BYTES,
        request_timeout_ms=TIMEOUT_SECONDS * 1000,
    )
    try:
        await asyncio.wait_for(producer.start(), TIMEOUT_SECONDS)
        print(f"Publishing captureId={message['captureId']} bytes={len(value)}", flush=True)
        metadata = await asyncio.wait_for(
            producer.send_and_wait(args.topic, key=key, value=value, headers=headers),
            TIMEOUT_SECONDS,
        )
        print(f"Confirmed topic={metadata.topic} partition={metadata.partition} offset={metadata.offset}")
    finally:
        try:
            await asyncio.wait_for(producer.stop(), TIMEOUT_SECONDS)
        except TimeoutError:
            print("Timed out closing the Kafka producer.", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", nargs="?", type=Path, default=DEFAULT_IMAGE, help="Local PNG or JPEG file")
    parser.add_argument("--broker", default="172.20.114.237:9094")
    parser.add_argument("--topic", default="makino_microscope_image")
    parser.add_argument("--machine", default="Makino_01")
    parser.add_argument("--tool", default="167")
    args = parser.parse_args()
    try:
        asyncio.run(publish(args))
    except TimeoutError:
        parser.exit(1, "Kafka timed out. If a captureId was printed, check the consumer before retrying.\n")
    except (OSError, ValueError) as exc:
        parser.exit(1, f"{exc}\n")


if __name__ == "__main__":
    main()
