import asyncio
from datetime import datetime, timezone
from threading import Lock
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request, Query, HTTPException
from uuid import UUID
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
from app.signals import SignalHub, sse

from app.config import Settings
from app.models import Hierarchy
from app.sources import SourceError, build_source
from app.tool_wear import ToolWearStore
from app.tool_images import ToolImageService
from app.wear_history import WearHistoryService
from app.wear_alerts import WearAlerts, router as wear_alert_router
from app.cctv import CctvService, router as cctv_router


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        headers = {}
        if settings.upstream_api_token.get_secret_value():
            headers["Authorization"] = f"Bearer {settings.upstream_api_token.get_secret_value()}"
        async with httpx.AsyncClient(
            base_url=settings.upstream_base_url.rstrip("/") + "/" if settings.upstream_base_url else "http://localhost/",
            headers=headers,
            timeout=settings.upstream_timeout_seconds,
        ) as client:
            app.state.source = build_source(settings, client)
            app.state.tool_wear = ToolWearStore(settings)
            app.state.cctv = CctvService(settings)
            app.state.tool_wear_lock = Lock()
            app.state.wear_history = WearHistoryService(settings)
            app.state.wear_alerts = WearAlerts(settings)
            app.state.signals = SignalHub(settings, on_batch=app.state.wear_alerts.on_signals)
            app.state.tool_images = ToolImageService(settings, on_capture=app.state.wear_alerts.log_photo)
            app.state.tool_images.start()
            app.state.wear_alerts.start()
            try:
                yield
            finally:
                await app.state.wear_alerts.close()
                await app.state.cctv.close()
                await app.state.wear_history.close()
                await app.state.tool_images.close()
                await app.state.signals.close()
                app.state.tool_wear.close()

    app = FastAPI(title="PQM CNC Data API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "PUT", "POST"], allow_headers=["*"])
    app.include_router(wear_alert_router)
    app.include_router(cctv_router)

    @app.exception_handler(SourceError)
    async def source_error_handler(request: Request, exc: SourceError):
        return JSONResponse(status_code=exc.status_code, content={"error": {"code": exc.code}})

    @app.get("/health")
    async def health():
        # Liveness only; does not assert upstream readiness.
        return {"status": "ok", "dataSource": settings.data_source}

    @app.get("/api/hierarchy", response_model=Hierarchy)
    async def hierarchy(request: Request):
        return await request.app.state.source.hierarchy()

    @app.get("/api/signals/stream")
    async def signals(request: Request, machine_id: str | None = Query(default=None, min_length=1, max_length=128)):
        async def events():
            yield "retry: 3000\n\n"
            async with request.app.state.signals.subscribe(machine_id or settings.signals_machine_id) as queue:
                while not await request.is_disconnected():
                    try:
                        event, payload = await asyncio.wait_for(queue.get(), timeout=15)
                        yield sse(event, payload)
                    except TimeoutError:
                        yield ": heartbeat\n\n"

        return StreamingResponse(events(), media_type="text/event-stream", headers={
            "Cache-Control": "no-cache", "X-Accel-Buffering": "no",
        })

    @app.get("/api/tool-wear/history")
    async def tool_wear_history(request: Request,
        machine_id: str | None = Query(default=None, min_length=1, max_length=128),
        tool_no: str | None = Query(default=None, min_length=1, max_length=64),
        start: datetime | None = Query(default=None), end: datetime | None = Query(default=None),
        window_minutes: int = Query(default=60, ge=1),
        limit: int = Query(default=1000, ge=1, le=10000),
        tool_instance_id: str | None = Query(default=None, min_length=1, max_length=128)):
        if (start is None) != (end is None):
            raise SourceError("both_history_bounds_required", 400)
        if start is not None:
            if start.tzinfo is None or end.tzinfo is None:
                raise SourceError("timezone_required", 400)
            start, end = start.astimezone(timezone.utc), end.astimezone(timezone.utc)
            if end <= start or (end - start).total_seconds() > settings.tool_wear_max_range_hours * 3600:
                raise SourceError("invalid_history_time_range", 400)
        if window_minutes > settings.tool_wear_max_range_hours * 60:
            raise SourceError("invalid_history_time_range", 400)
        if limit > settings.tool_wear_max_points:
            raise SourceError("history_point_limit_exceeded", 400)
        machine_id = machine_id or settings.signals_machine_id
        if settings.tool_wear_history_source == "http":
            if limit < 6:
                raise SourceError("history_point_limit_minimum_6", 400)
            if tool_instance_id:
                raise SourceError("tool_instance_filter_not_supported_by_history_api", 400)
            return await request.app.state.wear_history.query(machine_id, tool_no, start, end, window_minutes, limit)
        if start is None or tool_no is None:
            raise SourceError("database_history_requires_tool_and_time_bounds", 400)
        def query_database():
            with request.app.state.tool_wear_lock:
                return request.app.state.tool_wear.query(machine_id, tool_no, start, end, limit, tool_instance_id)
        return await asyncio.to_thread(query_database)

    @app.get("/api/tool-images/latest")
    def latest_tool_image(request: Request):
        return {"image": request.app.state.tool_images.store.latest(),
                "status": request.app.state.tool_images.status}

    @app.get("/api/tool-images/events")
    async def tool_image_events(request: Request):
        async def events():
            yield "retry: 3000\n\n"
            async with request.app.state.tool_images.subscribe() as queue:
                while not await request.is_disconnected():
                    try:
                        event, payload = await asyncio.wait_for(queue.get(), timeout=15)
                        yield sse(event, payload)
                    except TimeoutError:
                        yield ": heartbeat\n\n"
        return StreamingResponse(events(), media_type="text/event-stream", headers={
            "Cache-Control": "no-cache", "X-Accel-Buffering": "no",
        })

    @app.get("/api/tool-images/{capture_id}/image")
    def tool_image_file(capture_id: UUID, request: Request):
        result = request.app.state.tool_images.store.image(str(capture_id))
        if result is None or not result[0].is_file():
            raise HTTPException(status_code=404, detail="Image not found")
        path, media_type = result
        return FileResponse(path, media_type=media_type, headers={"X-Content-Type-Options": "nosniff"})

    return app


app = create_app()
