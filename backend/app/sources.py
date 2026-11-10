from typing import Protocol

import httpx
from pydantic import ValidationError

from app.config import Settings
from app.models import Asset, Hierarchy


class SourceError(Exception):
    def __init__(self, code: str, status_code: int = 502):
        self.code = code
        self.status_code = status_code
        super().__init__(code)


class DataSource(Protocol):
    async def hierarchy(self) -> Hierarchy: ...


class MockSource:
    async def hierarchy(self) -> Hierarchy:
        return Hierarchy(assets=[
            Asset(id="ent-1", code="ENT", name="Precision Machining Group", level="enterprise"),
            Asset(id="plt-1", code="MS1", name="Machine Shop 1", level="plant", parentId="ent-1"),
            Asset(id="cell-mill-a", code="MILL-A", name="Milling Cell A", level="cell", parentId="plt-1"),
            Asset(id="mch-mill-01", code="VMC-01", name="VMC 01", level="machine", parentId="cell-mill-a"),
        ])


class HttpSource:
    def __init__(self, client: httpx.AsyncClient):
        self.client = client

    async def hierarchy(self) -> Hierarchy:
        try:
            response = await self.client.get("api/hierarchy")
            response.raise_for_status()
            return Hierarchy.model_validate(response.json())
        except httpx.TimeoutException as exc:
            raise SourceError("upstream_timeout", 504) from exc
        except (httpx.HTTPError, ValidationError, ValueError) as exc:
            raise SourceError("upstream_invalid_response") from exc


class DatabaseSource:
    """Implement read-only queries once the database and schema are agreed."""

    async def hierarchy(self) -> Hierarchy:
        raise SourceError("database_not_configured", 503)


def build_source(settings: Settings, client: httpx.AsyncClient) -> DataSource:
    if settings.data_source == "http":
        if not settings.upstream_base_url.startswith(("http://", "https://")):
            raise ValueError("HTTP mode requires an http(s) UPSTREAM_BASE_URL")
        return HttpSource(client)
    if settings.data_source == "database":
        return DatabaseSource()
    return MockSource()
