from typing import Protocol

from trading_bridge.models import (
    ShadowCancelAcknowledgement,
    ShadowOrderAcknowledgement,
    ShadowOrderRequest,
)


class BrokerAdapter(Protocol):
    def submit_order(self, order: ShadowOrderRequest) -> ShadowOrderAcknowledgement: ...

    def cancel_order(self, order_id: str) -> ShadowCancelAcknowledgement: ...
