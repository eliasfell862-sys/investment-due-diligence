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
