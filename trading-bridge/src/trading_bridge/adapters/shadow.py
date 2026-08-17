import hashlib

from trading_bridge.models import (
    ShadowCancelAcknowledgement,
    ShadowOrderAcknowledgement,
    ShadowOrderRequest,
)


class ShadowBrokerAdapter:
    def __init__(self) -> None:
        self._orders: dict[str, ShadowOrderRequest] = {}

    def submit_order(self, order: ShadowOrderRequest) -> ShadowOrderAcknowledgement:
        self._orders[order.order_id] = order
        digest = hashlib.sha256(
            f"{order.order_id}:{order.code}:{order.side}:{order.limit_price}:{order.shares}".encode()
        ).hexdigest()[:24]
        return ShadowOrderAcknowledgement(
            order_id=order.order_id,
            status="accepted_shadow",
            acknowledgement_id=f"shadow-{digest}",
        )

    def cancel_order(self, order_id: str) -> ShadowCancelAcknowledgement:
        self._orders.pop(order_id, None)
        return ShadowCancelAcknowledgement(order_id=order_id, status="cancelled_shadow")

    def submit_live_order(self, order: ShadowOrderRequest) -> None:
        del order
        raise RuntimeError("live_execution_disabled")
