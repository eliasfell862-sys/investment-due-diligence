from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


AccountQuality = Literal["verified_by_rules", "verification_required", "unavailable"]
AccountFailureReason = Literal[
    "trading_window_not_found",
    "ambiguous_trading_window",
    "trading_window_minimized",
    "window_capture_failed",
    "blank_capture",
    "windows_ocr_unavailable",
    "ocr_recognition_failed",
    "required_anchor_missing",
    "funds_unreadable",
    "positions_unreadable",
    "conflicting_position_rows",
    "field_validation_failed",
]


class BrokerPositionReadOnly(StrictModel):
    code: str = Field(pattern=r"^\d{6}$")
    total_shares: int = Field(ge=0)
    available_shares: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_available_shares(self) -> Self:
        if self.available_shares > self.total_shares:
            raise ValueError("available_shares_exceed_total")
        return self


class AccountResponse(StrictModel):
    mode: Literal["eastmoney_read_only"] = "eastmoney_read_only"
    source: Literal["eastmoney_windows_ocr"] = "eastmoney_windows_ocr"
    captured_at: datetime | None = None
    quality: AccountQuality = "unavailable"
    verification_required: bool = True
    available: bool = False
    available_cash: float | None = None
    total_assets: float | None = None
    positions: list[BrokerPositionReadOnly] = Field(default_factory=list)
    failure_reason: AccountFailureReason | None = None

    @classmethod
    def unavailable(cls, reason: AccountFailureReason) -> "AccountResponse":
        return cls(
            available=False,
            captured_at=None,
            quality="unavailable",
            verification_required=True,
            available_cash=None,
            total_assets=None,
            positions=[],
            failure_reason=reason,
        )

    @model_validator(mode="after")
    def validate_state(self) -> Self:
        if self.available:
            if self.captured_at is None:
                raise ValueError("available_account_requires_capture_time")
            if self.available_cash is None or self.total_assets is None:
                raise ValueError("available_account_requires_funds")
            if self.failure_reason is not None:
                raise ValueError("available_account_cannot_have_failure")
            if self.quality == "unavailable":
                raise ValueError("available_account_requires_quality")
        else:
            values = (self.captured_at, self.available_cash, self.total_assets)
            if any(value is not None for value in values):
                raise ValueError("unavailable_account_cannot_expose_values")
            if self.positions:
                raise ValueError("unavailable_account_cannot_expose_positions")
            if self.quality != "unavailable":
                raise ValueError("unavailable_account_requires_unavailable_quality")
            if self.failure_reason is None:
                raise ValueError("unavailable_account_requires_failure")
        return self


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
