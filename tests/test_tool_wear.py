from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.config import Settings
from app.main import create_app


def test_unconfigured_and_invalid_range():
    with TestClient(create_app(Settings(_env_file=None, tool_wear_history_source="database"))) as client:
        params = dict(machine_id="M1", tool_no="6", start="2026-10-29T00:00:00Z", end="2026-10-29T01:00:00Z")
        assert client.get("/api/tool-wear/history", params=params).json()["error"]["code"] == "tool_wear_database_not_configured"
        assert client.get("/api/tool-wear/history", params={**params, "end": params["start"]}).status_code == 400
        assert client.get("/api/tool-wear/history", params={**params, "start": "2026-10-29T00:00:00"}).status_code == 400


def test_real_sql_query_filters_nulls_and_truncation(tmp_path):
    url = "sqlite:///" + (tmp_path / "wear.db").as_posix()
    engine = create_engine(url)
    with engine.begin() as db:
        db.execute(text('CREATE TABLE wear (timestamp DATETIME, machine_id TEXT, tool_no INTEGER, xWearMm FLOAT, zWearMm FLOAT, gx FLOAT, batch TEXT)'))
        for machine, tool, stamp, wear, batch in [
            ("M1", 6, "00:10:00", -0.1, "a"), ("M1", 6, "00:20:00", None, "a"),
            ("M1", 6, "00:30:00", 0.2, "b"), ("M2", 6, "00:10:00", 8, "a"),
            ("M1", 3, "00:10:00", 9, "a"), ("M1", 6, "01:00:00", 10, "a"),
        ]:
            db.execute(text('INSERT INTO wear VALUES (:stamp,:machine,:tool,:wear,0.02,2,:batch)'),
                dict(stamp=f"2026-10-29 {stamp}.000000", machine=machine, tool=tool, wear=wear, batch=batch))
    engine.dispose()
    settings = Settings(_env_file=None, tool_wear_history_source="database", tool_wear_db_url=url, tool_wear_table="wear", tool_wear_x_geometry_column="gx", tool_wear_instance_column="batch")
    with TestClient(create_app(settings)) as client:
        params = dict(machine_id="M1", tool_no="6", start="2026-10-29T00:00:00Z", end="2026-10-29T01:00:00Z", limit=2)
        response = client.get("/api/tool-wear/history", params=params)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["truncated"] is True
        assert len(body["data"]) == 2
        assert body["data"][0]["xOffsetMm"] == 1.9
        assert body["data"][1]["xWearMm"] is None
        assert body["data"][0]["zOffsetMm"] is None
        filtered = client.get("/api/tool-wear/history", params={**params, "tool_instance_id": "b"}).json()
        assert len(filtered["data"]) == 1
        assert filtered["data"][0]["xWearMm"] == 0.2
        assert client.get("/api/tool-wear/history", params={**params, "machine_id": "M1' OR 1=1 --"}).json()["data"] == []
        assert client.get("/api/tool-wear/history", params={**params, "tool_no": "6; DROP TABLE wear"}).status_code == 400
