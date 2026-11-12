import asyncio
from types import SimpleNamespace

import httpx
import pytest

from app.cctv import CctvService, CctvUnavailable, snapshot
from app.config import Settings

JPEG = b"\xff\xd8\xff\xe0fake-jpeg"


def settings(**changes):
    return Settings(_env_file=None, cctv_nvr_host="nvr.test", cctv_user="admin", cctv_password="secret", **changes)


def digest_nvr(calls):
    """NVR stand-in: 401 with a Digest challenge first, 200 with a JPEG once the request is authorised."""
    def handler(request: httpx.Request):
        calls.append(SimpleNamespace(url=request.url, headers=dict(request.headers)))
        if "authorization" not in request.headers:
            return httpx.Response(401, headers={"WWW-Authenticate": 'Digest realm="nvr", nonce="abc", qop="auth", algorithm=MD5'})
        return httpx.Response(200, content=JPEG, headers={"Content-Type": "image/jpeg"})
    return httpx.MockTransport(handler)


def test_digest_handshake_and_url():
    async def run():
        calls = []
        service = CctvService(settings(), transport=digest_nvr(calls))
        frame, captured = await service.snapshot()
        assert frame == JPEG and captured
        assert [("authorization" in c.headers) for c in calls] == [False, True]
        assert str(calls[0].url) == "http://nvr.test/ISAPI/Streaming/channels/102/picture"
        assert calls[0].headers["accept"] == "image/jpeg"
        assert calls[1].headers["authorization"].startswith("Digest ") and 'username="admin"' in calls[1].headers["authorization"]
        await service.close()
    asyncio.run(run())


def test_requests_inside_the_cache_window_share_one_nvr_request():
    async def run():
        calls = []
        service = CctvService(settings(), transport=digest_nvr(calls))
        results = await asyncio.gather(*[service.snapshot() for _ in range(5)])
        assert len({r[1] for r in results}) == 1
        assert len(calls) == 2  # one handshake, not five
        await service.close()
    asyncio.run(run())


@pytest.mark.parametrize("handler,code", [
    (lambda r: httpx.Response(401, headers={"WWW-Authenticate": 'Digest realm="x", nonce="n", qop="auth"'}), "cctv_auth_failed"),
    (lambda r: httpx.Response(200, content=b"<html>"), "cctv_bad_response"),
    (lambda r: (_ for _ in ()).throw(httpx.ConnectTimeout("slow")), "cctv_unreachable"),
])
def test_failures_are_reported_with_a_code(handler, code):
    async def run():
        service = CctvService(settings(), transport=httpx.MockTransport(handler))
        with pytest.raises(CctvUnavailable) as caught:
            await service.snapshot()
        assert caught.value.code == code
        await service.close()
    asyncio.run(run())


def test_endpoint_returns_jpeg_or_503_and_never_the_password():
    async def run():
        service = CctvService(settings(), transport=digest_nvr([]))
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(cctv=service)))
        ok = await snapshot(request)
        assert (ok.status_code, ok.media_type, ok.body) == (200, "image/jpeg", JPEG)
        assert ok.headers["cache-control"] == "no-store" and ok.headers["x-captured-at"]
        await service.close()

        disabled = CctvService(Settings(_env_file=None))
        request.app.state.cctv = disabled
        down = await snapshot(request)
        assert down.status_code == 503 and b"cctv_not_configured" in down.body and b"secret" not in down.body
        await disabled.close()
    asyncio.run(run())
