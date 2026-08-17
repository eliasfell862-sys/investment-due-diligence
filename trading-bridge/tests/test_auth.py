from fastapi.testclient import TestClient

from trading_bridge.app import create_app


def test_rejects_missing_token(monkeypatch):
    monkeypatch.setenv("TRADING_BRIDGE_TOKEN", "test-token")
    with TestClient(create_app()) as client:
        assert client.get("/health").status_code == 401


def test_rejects_wrong_token(monkeypatch):
    monkeypatch.setenv("TRADING_BRIDGE_TOKEN", "test-token")
    with TestClient(create_app()) as client:
        response = client.get("/health", headers={"X-Bridge-Token": "wrong"})
    assert response.status_code == 401


def test_rejects_non_loopback_host(monkeypatch):
    monkeypatch.setenv("TRADING_BRIDGE_TOKEN", "test-token")
    monkeypatch.setenv("TRADING_BRIDGE_HOST", "0.0.0.0")
    try:
        create_app()
    except ValueError as error:
        assert str(error) == "bridge_host_must_be_loopback"
    else:
        raise AssertionError("non-loopback host was accepted")
