from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    cors_origins: list[str] = ["http://localhost:3001", "http://127.0.0.1:3001"]
    data_source: Literal["mock", "http", "database"] = "mock"
    upstream_base_url: str = ""
    upstream_api_token: SecretStr = SecretStr("")
    upstream_timeout_seconds: float = Field(default=10, gt=0, le=120)
    signals_ws_url: str = "ws://172.20.114.237:4000/ws"
    signals_machine_id: str = "Makino_01"
    signals_poll_seconds: float = Field(default=1, ge=0.2, le=60)
    signals_window_ms: int = Field(default=10000, ge=1, le=300000)
    signals_stale_seconds: float = Field(default=10, ge=1)
    tool_wear_db_url: SecretStr = SecretStr("")
    tool_wear_db_options: dict = {}
    tool_wear_table: str = ""
    tool_wear_schema: str = ""
    tool_wear_time_column: str = "timestamp"
    tool_wear_machine_column: str = "machine_id"
    tool_wear_tool_column: str = "tool_no"
    tool_wear_x_column: str = "xWearMm"
    tool_wear_z_column: str = "zWearMm"
    tool_wear_x_geometry_column: str = ""
    tool_wear_z_geometry_column: str = ""
    tool_wear_instance_column: str = ""
    tool_wear_tool_type: Literal["integer", "string"] = "integer"
    tool_wear_max_range_hours: int = Field(default=168, ge=1, le=8760)
    tool_wear_max_points: int = Field(default=2000, ge=1, le=10000)
    tool_wear_history_source: Literal["http", "database"] = "http"
    history_base_url: str = "http://172.20.114.237:4000"
    history_environment: Literal["real", "test"] = "real"
    history_timeout_seconds: float = Field(default=20, gt=0, le=120)
    microscope_kafka_enabled: bool = False
    microscope_kafka_bootstrap_servers: str = "172.20.114.237:9094"
    microscope_kafka_topic: str = "makino_microscope_image"
    microscope_kafka_group_id: str = "pqm-cnc-microscope"
    microscope_kafka_client_id: str = "pqm-cnc-backend"
    microscope_kafka_auto_offset_reset: Literal["latest", "earliest"] = "latest"
    microscope_kafka_max_message_bytes: int = Field(default=50000000, ge=1024)
    microscope_max_image_bytes: int = Field(default=50000000, ge=1)
    microscope_image_dir: str = "./data/microscope"
