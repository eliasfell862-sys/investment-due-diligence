import pytest
from pydantic import ValidationError

from trading_bridge.adapters.ocr_types import InMemoryBitmap, OcrLine, OcrRect, OcrWord
from trading_bridge.models import AccountResponse, BrokerPositionReadOnly


def test_account_response_rejects_invalid_position_code():
    with pytest.raises(ValidationError):
        BrokerPositionReadOnly(code="333", total_shares=100, available_shares=100)


def test_account_response_rejects_available_shares_above_total():
    with pytest.raises(ValidationError, match="available_shares_exceed_total"):
        BrokerPositionReadOnly(code="000333", total_shares=100, available_shares=200)


def test_unavailable_account_contains_no_sensitive_values():
    result = AccountResponse.unavailable("windows_ocr_unavailable")

    assert result.model_dump(mode="json") == {
        "mode": "eastmoney_read_only",
        "source": "eastmoney_windows_ocr",
        "available": False,
        "captured_at": None,
        "quality": "unavailable",
        "verification_required": True,
        "available_cash": None,
        "total_assets": None,
        "positions": [],
        "failure_reason": "windows_ocr_unavailable",
    }


def test_unavailable_account_requires_failure_reason():
    with pytest.raises(ValidationError, match="unavailable_account_requires_failure"):
        AccountResponse()


def test_ocr_geometry_contracts_are_immutable():
    rect = OcrRect(x=1, y=2, width=3, height=4)
    word = OcrWord(text="000333", bounds=rect)
    line = OcrLine(text="000333 100 100", words=(word,))

    with pytest.raises((AttributeError, ValidationError)):
        line.text = "changed"


def test_in_memory_bitmap_close_wipes_pixels_and_is_idempotent():
    pixels = bytearray(b"\x01\x02\x03\x04")
    bitmap = InMemoryBitmap(width=1, height=1, stride=4, pixels=pixels)
