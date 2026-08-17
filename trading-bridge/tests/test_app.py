from datetime import UTC, datetime

from fastapi.testclient import TestClient

from trading_bridge.app import create_app
from trading_bridge.models import AccountResponse, BrokerPositionReadOnly


class FakeAccountReader:
    def __init__(self, response):
        self.response = response

    async def read_account(self):
        return self.response


def client(monkeypatch, account_reader=None):
    monkeypatch.setenv("TRADING_BRIDGE_TOKEN", "test-token")
    monkeypatch.setenv("TRADING_BRIDGE_HOST", "127.0.0.1")
    return TestClient(create_app(account_reader=account_reader))


def headers():
    return {"X-Bridge-Token": "test-token"}


def test_health_and_capabilities_are_local_shadow_only(monkeypatch):
    with client(monkeypatch) as api:
        assert api.get("/health", headers=headers()).json() == {
            "status": "ok", "execution_mode": "shadow"
        }
        capabilities = api.get("/v1/capabilities", headers=headers()).json()
    assert capabilities["modes"] == ["shadow", "eastmoney_read_only"]
    assert capabilities["live_execution_enabled"] is False


def test_shadow_order_never_returns_a_broker_order_id(monkeypatch):
    with client(monkeypatch) as api:
        response = api.post("/v1/orders/shadow", headers=headers(), json={
            "order_id": "o1", "code": "000333", "side": "buy",
            "limit_price": 50.0, "shares": 100,
            "expires_at": "2026-08-17T02:00:00Z",
        })
    assert response.status_code == 200
    assert response.json()["execution_mode"] == "shadow"
    assert response.json()["broker_order_id"] is None


def test_rejects_unknown_order_fields(monkeypatch):
    with client(monkeypatch) as api:
        response = api.post("/v1/orders/shadow", headers=headers(), json={
            "order_id": "o1", "code": "000333", "side": "buy",
            "limit_price": 50.0, "shares": 100,
            "expires_at": "2026-08-17T02:00:00Z", "password": "must-not-pass",
        })
    assert response.status_code == 422


def test_account_returns_typed_unavailable_reader_result(monkeypatch):
    reader = FakeAccountReader(AccountResponse.unavailable("windows_ocr_unavailable"))
    with client(monkeypatch, reader) as api:
        response = api.get("/v1/account", headers=headers())
    assert response.json() == {
        "mode": "eastmoney_read_only", "source": "eastmoney_windows_ocr",
        "available": False, "captured_at": None, "quality": "unavailable",
        "verification_required": True, "available_cash": None,
        "total_assets": None, "positions": [],
        "failure_reason": "windows_ocr_unavailable",
    }


def test_account_returns_only_approved_ocr_fields(monkeypatch):
    reader = FakeAccountReader(AccountResponse(
        available=True,
        captured_at=datetime(2026, 8, 17, 9, 30, tzinfo=UTC),
        quality="verified_by_rules",
        verification_required=False,
        available_cash=1234.56,
        total_assets=7000,
        positions=[BrokerPositionReadOnly(
            code="000333", total_shares=300, available_shares=200,
        )],
    ))
    with client(monkeypatch, reader) as api:
        payload = api.get("/v1/account", headers=headers()).json()

    assert payload["available_cash"] == 1234.56
    assert payload["positions"] == [{
        "code": "000333", "total_shares": 300, "available_shares": 200,
    }]
    serialized = str(payload).lower()
    for forbidden in ("raw_ocr", "screenshot", "window_handle", "account_number"):
        assert forbidden not in serialized


def test_cancel_changes_only_the_shadow_record(monkeypatch):
    with client(monkeypatch) as api:
        api.post("/v1/orders/shadow", headers=headers(), json={
            "order_id": "o1", "code": "000333", "side": "buy",
            "limit_price": 50.0, "shares": 100,
            "expires_at": "2026-08-17T02:00:00Z",
        })
        response = api.post("/v1/orders/o1/cancel", headers=headers())
    assert response.json() == {
        "order_id": "o1", "status": "cancelled_shadow",
        "execution_mode": "shadow", "broker_order_id": None,
    }
