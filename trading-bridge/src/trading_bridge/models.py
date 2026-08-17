from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ShadowOrderRequest(StrictModel):
    order_id: str = Field(min_length=1, max_length=128)
    code: str = Field(pattern=r"^\d{6}$")
    side: Literal["buy", "sell"]
    limit_price: float = Field(gt=0)
    shares: int = Field(gt=0)
    expires_at: datetime


class ShadowOrderAcknowledgement(StrictModel):
    order_id: str
    status: Literal["accepted_shadow"]
    execution_mode: Literal["shadow"] = "shadow"
    broker_order_id: None = None
    acknowledgement_id: str


class ShadowCancelAcknowledgement(StrictModel):
    order_id: str
    status: Literal["cancelled_shadow"]
    execution_mode: Literal["shadow"] = "shadow"
    broker_order_id: None = None


class HealthResponse(StrictModel):
    status: Literal["ok"] = "ok"
    execution_mode: Literal["shadow"] = "shadow"


class CapabilityResponse(StrictModel):
    modes: list[Literal["shadow", "eastmoney_read_only"]]
    live_execution_enabled: Literal[False] = False


class AccountResponse(StrictModel):
    mode: Literal["eastmoney_read_only"] = "eastmoney_read_only"
    available: bool = False
    available_cash: float | None = None
    total_assets: float | None = None
    positions: list[dict] = Field(default_factory=list)

class CapabilityReport(StrictModel):
    process_detected: bool
    executable_path_hash: str | None = None
    product_version: str | None = None
    window_detected: bool
    login_state_readable: bool
    funds_view_readable: bool
    positions_view_readable: bool
    orders_view_readable: bool
    cancel_control_readable: bool
    unknown_dialogs: list[str] = Field(default_factory=list)
    redacted_evidence: list[str] = Field(default_factory=list)
    safe_for_shadow: bool
    safe_for_live: Literal[False] = False
