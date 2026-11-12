"""Still pictures from the machine CCTV (Hikvision NVR, HTTP Digest), proxied so the page never sees the credentials."""
import asyncio
import logging
import time
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from app.config import Settings

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/api/cctv")


class CctvUnavailable(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class CctvService:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self.client = httpx.AsyncClient(timeout=settings.cctv_timeout_seconds, transport=transport)
        self.lock = asyncio.Lock()
        self.frame: bytes | None = None
        self.captured_at = 0.0  # monotonic
        self.captured_iso: str | None = None

    @property
    def configured(self):
        return bool(self.settings.cctv_nvr_host and self.settings.cctv_user)

    @property
    def url(self):
        return (f"http://{self.settings.cctv_nvr_host}:{self.settings.cctv_http_port}"
                f"/ISAPI/Streaming/channels/{self.settings.cctv_channel}/picture")

    async def snapshot(self):
        """Latest JPEG as (bytes, iso time). Requests within the cache window share one NVR request."""
        if not self.configured:
            raise CctvUnavailable("cctv_not_configured")
        async with self.lock:
            if self.frame is not None and time.monotonic() - self.captured_at < self.settings.cctv_cache_seconds:
                return self.frame, self.captured_iso
            auth = httpx.DigestAuth(self.settings.cctv_user, self.settings.cctv_password.get_secret_value())
            try:
                response = await self.client.get(self.url, auth=auth, headers={"Accept": "image/jpeg"})
            except httpx.HTTPError as exc:
                logger.warning("CCTV snapshot failed: %s", type(exc).__name__)
                raise CctvUnavailable("cctv_unreachable") from exc
            if response.status_code in (401, 403):
                logger.warning("CCTV snapshot rejected: HTTP %s", response.status_code)
                raise CctvUnavailable("cctv_auth_failed")
            if response.status_code != 200 or not response.content.startswith(b"\xff\xd8"):
                logger.warning("CCTV snapshot unexpected response: HTTP %s", response.status_code)
                raise CctvUnavailable("cctv_bad_response")
            self.frame, self.captured_at = response.content, time.monotonic()
            self.captured_iso = datetime.now(timezone.utc).isoformat()
            return self.frame, self.captured_iso

    async def close(self):
        await self.client.aclose()


@router.get("/snapshot")
async def snapshot(request: Request):
    try:
        frame, captured = await request.app.state.cctv.snapshot()
    except CctvUnavailable as exc:
        return JSONResponse(status_code=503, content={"error": {"code": exc.code}},
                            headers={"Cache-Control": "no-store"})
    return Response(frame, media_type="image/jpeg", headers={
        "Cache-Control": "no-store", "X-Captured-At": captured,
        "Access-Control-Expose-Headers": "X-Captured-At", "X-Content-Type-Options": "nosniff"})
