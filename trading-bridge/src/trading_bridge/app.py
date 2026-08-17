import os

import uvicorn
from fastapi import Depends, FastAPI

from trading_bridge.adapters.shadow import ShadowBrokerAdapter
from trading_bridge.auth import bridge_token_dependency
from trading_bridge.models import (
    AccountResponse,
    CapabilityResponse,
    HealthResponse,
    ShadowCancelAcknowledgement,
    ShadowOrderAcknowledgement,
    ShadowOrderRequest,
)

LOOPBACK_HOST = "127.0.0.1"


def create_app() -> FastAPI:
    host = os.environ.get("TRADING_BRIDGE_HOST", LOOPBACK_HOST)
    if host != LOOPBACK_HOST:
        raise ValueError("bridge_host_must_be_loopback")
    token = os.environ.get("TRADING_BRIDGE_TOKEN", "")
    require_token = bridge_token_dependency(token)
    adapter = ShadowBrokerAdapter()
    app = FastAPI(title="Local Shadow Trading Bridge", docs_url=None, redoc_url=None)

    @app.get("/health", response_model=HealthResponse, dependencies=[Depends(require_token)])
    def health() -> HealthResponse:
        return HealthResponse()

    @app.get("/v1/capabilities", response_model=CapabilityResponse, dependencies=[Depends(require_token)])
    def capabilities() -> CapabilityResponse:
        return CapabilityResponse(
            modes=["shadow", "eastmoney_read_only"],
            live_execution_enabled=False,
        )

    @app.get("/v1/account", response_model=AccountResponse, dependencies=[Depends(require_token)])
    def account() -> AccountResponse:
        return AccountResponse()

    @app.post(
        "/v1/orders/shadow",
        response_model=ShadowOrderAcknowledgement,
        dependencies=[Depends(require_token)],
    )
    def submit_shadow(order: ShadowOrderRequest) -> ShadowOrderAcknowledgement:
        return adapter.submit_order(order)

    @app.post(
        "/v1/orders/{order_id}/cancel",
        response_model=ShadowCancelAcknowledgement,
        dependencies=[Depends(require_token)],
    )
    def cancel_shadow(order_id: str) -> ShadowCancelAcknowledgement:
        return adapter.cancel_order(order_id)

    return app


def main() -> None:
    host = os.environ.get("TRADING_BRIDGE_HOST", LOOPBACK_HOST)
    if host != LOOPBACK_HOST:
        raise ValueError("bridge_host_must_be_loopback")
    port = int(os.environ.get("TRADING_BRIDGE_PORT", "8765"))
    uvicorn.run(create_app(), host=LOOPBACK_HOST, port=port)


if __name__ == "__main__":
    main()
