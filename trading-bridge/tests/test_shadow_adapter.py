from datetime import datetime, timezone

from trading_bridge.adapters.shadow import ShadowBrokerAdapter
from trading_bridge.models import ShadowOrderRequest


def request(order_id: str = "o1") -> ShadowOrderRequest:
    return ShadowOrderRequest(
        order_id=order_id,
        code="000333",
        side="buy",
        limit_price=50.0,
        shares=100,
        expires_at=datetime(2026, 8, 17, 2, 0, tzinfo=timezone.utc),
    )


def test_shadow_order_never_claims_broker_submission():
    result = ShadowBrokerAdapter().submit_order(request())
    assert result.execution_mode == "shadow"
    assert result.broker_order_id is None
    assert result.status == "accepted_shadow"


def test_shadow_acknowledgement_is_deterministic_for_same_order():
    adapter = ShadowBrokerAdapter()
    assert adapter.submit_order(request()).model_dump() == adapter.submit_order(request()).model_dump()


def test_live_execution_is_explicitly_disabled():
    adapter = ShadowBrokerAdapter()
    try:
        adapter.submit_live_order(request())
    except RuntimeError as error:
        assert str(error) == "live_execution_disabled"
    else:
        raise AssertionError("live execution was not rejected")
