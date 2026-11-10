"""Read-only, configured SQL projection for tool compensation history."""
import logging
import math
import re
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, MetaData, String, Table, create_engine, select
from sqlalchemy.pool import QueuePool

from app.config import Settings
from app.sources import SourceError

logger = logging.getLogger(__name__)


class ToolWearStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.engine = None

    def close(self):
        if self.engine is not None:
            self.engine.dispose()

    def query(self, machine: str, tool: str, start: datetime, end: datetime, limit: int, instance: str | None):
        cfg = self.settings
        if not cfg.tool_wear_db_url.get_secret_value() or not cfg.tool_wear_table:
            raise SourceError("tool_wear_database_not_configured", 503)
        names = {
            "timestamp": cfg.tool_wear_time_column, "machine": cfg.tool_wear_machine_column,
            "tool": cfg.tool_wear_tool_column, "xWearMm": cfg.tool_wear_x_column,
            "zWearMm": cfg.tool_wear_z_column, "xGeometryMm": cfg.tool_wear_x_geometry_column,
            "zGeometryMm": cfg.tool_wear_z_geometry_column, "toolInstanceId": cfg.tool_wear_instance_column,
        }
        identifiers = [cfg.tool_wear_table, cfg.tool_wear_schema, *names.values()]
        if any(name and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) for name in identifiers):
            raise SourceError("tool_wear_invalid_configuration", 503)
        if instance and not names["toolInstanceId"]:
            raise SourceError("tool_instance_filter_not_configured", 400)
        if len([n for n in names.values() if n]) != len(set(n for n in names.values() if n)):
            raise SourceError("tool_wear_invalid_configuration", 503)
        tool_value = tool
        if cfg.tool_wear_tool_type == "integer":
            if not re.fullmatch(r"[0-9]+", tool):
                raise SourceError("tool_no_must_be_integer", 400)
            tool_value = int(tool)
        try:
            # No reflection: the account only needs SELECT on the configured table/view.
            if self.engine is None:
                self.engine = create_engine(cfg.tool_wear_db_url.get_secret_value(),
                    connect_args=cfg.tool_wear_db_options, poolclass=QueuePool,
                    pool_size=3, max_overflow=2, pool_timeout=10, pool_pre_ping=True)
            table = Table(cfg.tool_wear_table, MetaData(), *[
                Column(name, DateTime(timezone=True) if key == "timestamp" else Float if key.endswith("Mm") else String)
                for key, name in names.items() if name
            ], schema=cfg.tool_wear_schema or None)
            statement = select(*[table.c[name].label(key) for key, name in names.items() if name]).where(
                table.c[names["machine"]] == machine,
                table.c[names["tool"]] == tool_value,
                table.c[names["timestamp"]] >= start,
                table.c[names["timestamp"]] < end,
            )
            if instance:
                statement = statement.where(table.c[names["toolInstanceId"]] == instance)
            statement = statement.order_by(table.c[names["timestamp"]].asc()).limit(limit + 1)
            with self.engine.connect() as connection:
                rows = connection.execute(statement).mappings().all()
            points = []
            for row in rows[:limit]:
                stamp = row["timestamp"]
                if isinstance(stamp, str):
                    stamp = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
                # Configured database timestamp values must be UTC.
                stamp = stamp.replace(tzinfo=timezone.utc) if stamp.tzinfo is None else stamp.astimezone(timezone.utc)
                point = {"timestamp": stamp.isoformat(), "toolInstanceId": row.get("toolInstanceId")}
                for key in ("xWearMm", "zWearMm", "xGeometryMm", "zGeometryMm"):
                    value = row.get(key)
                    point[key] = float(value) if value is not None and math.isfinite(float(value)) else None
                for axis in ("x", "z"):
                    wear, geometry = point[f"{axis}WearMm"], point[f"{axis}GeometryMm"]
                    point[f"{axis}OffsetMm"] = wear + geometry if wear is not None and geometry is not None else None
                points.append(point)
            return {"machine_id": machine, "tool_no": tool, "start": start, "end": end,
                    "unit": "mm", "data": points, "truncated": len(rows) > limit,
                    "instanceFilterAvailable": bool(names["toolInstanceId"])}
        except SourceError:
            raise
        except Exception:
            # Do not log DB exception text: it can contain connection information or SQL parameters.
            logger.warning("Tool wear database query failed")
            raise SourceError("tool_wear_database_query_failed", 503) from None
