import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.sources import HttpSource, SourceError


def test_mock_api_and_cors():
    with TestClient(create_app(Settings(_env_file=None))) as client:
        assert client.get("/health").json() == {"status": "ok", "dataSource": "mock"}
        response = client.get("/api/hierarchy", headers={"Origin": "http://localhost:3001"})
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "http://localhost:3001"
        assets = response.json()["assets"]
        assert assets[-1]["parentId"] == assets[-2]["id"]
        assert "access-control-allow-origin" not in client.get(
            "/api/hierarchy", headers={"Origin": "http://untrusted.example"}
        ).headers


def test_database_placeholder():
    with TestClient(create_app(Settings(_env_file=None, data_source="database"))) as client:
        response = client.get("/api/hierarchy")
        assert response.status_code == 503
        assert response.json() == {"error": {"code": "database_not_configured"}}


@pytest.mark.parametrize("scenario, expected", [("success", None), ("invalid", 502), ("error", 502), ("timeout", 504)])
def test_http_adapter(scenario, expected):
    def handler(request):
        assert str(request.url) == "http://upstream/api/hierarchy"
        if scenario == "timeout":
            raise httpx.ReadTimeout("timeout", request=request)
        if scenario == "error":
            return httpx.Response(500, text="private upstream error")
        return httpx.Response(200, json={"assets": []} if scenario == "success" else {"wrong": []})

    async def run():
        async with httpx.AsyncClient(base_url="http://upstream/", transport=httpx.MockTransport(handler)) as client:
            source = HttpSource(client)
            if expected is None:
                assert (await source.hierarchy()).assets == []
            else:
                with pytest.raises(SourceError) as caught:
                    await source.hierarchy()
                assert caught.value.status_code == expected

    asyncio.run(run())
