import asyncio
from datetime import UTC, datetime

from trading_bridge.adapters.eastmoney_account_ocr import (
    EastmoneyAccountOcrParser,
    EastmoneyAccountReader,
)
from trading_bridge.adapters.eastmoney_window import TradingWindow
from trading_bridge.adapters.ocr_types import InMemoryBitmap, OcrLine, OcrRect, OcrWord
from trading_bridge.adapters.windows_ocr import WindowsOcrError


CAPTURED_AT = datetime(2026, 8, 17, 9, 30, tzinfo=UTC)


def line(*items, y=0):
    words = tuple(
        OcrWord(text=text, bounds=OcrRect(x=x, y=y, width=width, height=18))
        for text, x, width in items
    )
    return OcrLine(text=" ".join(item[0] for item in items), words=words)


def funds(available="1,234.56", assets="7,000.00"):
    return [
        line(("\u53ef\u7528\u8d44\u91d1", 0, 70), (available, 100, 80), y=10),
        line(("\u603b\u8d44\u4ea7", 0, 70), (assets, 100, 80), y=35),
    ]


def position_header():
    return line(
        ("\u8bc1\u5238\u4ee3\u7801", 0, 70),
        ("\u5168\u90e8\u6570\u91cf", 120, 70),
        ("\u53ef\u7528\u6570\u91cf", 240, 70),
        y=100,
    )


def position(code="000333", total="300", available="200", y=130):
    return line((code, 0, 60), (total, 120, 40), (available, 240, 40), y=y)


def test_parses_funds_and_position_columns_by_geometry():
    result = EastmoneyAccountOcrParser().parse(
        [*funds(), position_header(), position()], CAPTURED_AT
    )

    assert result.available is True
    assert result.available_cash == 1234.56
    assert result.total_assets == 7000.0
    assert result.quality == "verified_by_rules"
    assert result.verification_required is False
    assert result.positions[0].model_dump() == {
        "code": "000333", "total_shares": 300, "available_shares": 200,
    }


def test_marks_funds_above_assets_for_manual_verification():
    result = EastmoneyAccountOcrParser().parse(
        [*funds("8,000", "7,000"), position_header(), position()], CAPTURED_AT
    )

    assert result.available is True
    assert result.quality == "verification_required"
    assert result.verification_required is True


def test_rejects_available_shares_above_total():
    result = EastmoneyAccountOcrParser().parse(
        [*funds(), position_header(), position(total="100", available="200")],
        CAPTURED_AT,
    )

    assert result.available is False
    assert result.failure_reason == "field_validation_failed"
    assert result.positions == []


def test_rejects_conflicting_duplicate_position_rows():
    result = EastmoneyAccountOcrParser().parse(
        [
            *funds(), position_header(), position(total="300", y=130),
            position(total="400", y=155),
        ],
        CAPTURED_AT,
    )

    assert result.available is False
    assert result.failure_reason == "conflicting_position_rows"


def test_missing_required_funds_anchor_is_unavailable():
    result = EastmoneyAccountOcrParser().parse(
        [position_header(), position()], CAPTURED_AT
    )

    assert result.failure_reason == "required_anchor_missing"


def test_explicit_empty_holdings_returns_empty_positions():
    result = EastmoneyAccountOcrParser().parse(
        [*funds(), line(("\u65e0\u6301\u4ed3", 0, 70), y=100)], CAPTURED_AT
    )

    assert result.available is True
    assert result.positions == []


class Locator:
    def locate(self):
        return TradingWindow(101, 1, 1)


class Capture:
    def __init__(self):
        self.bitmap = InMemoryBitmap(1, 1, 4, bytearray(b"\x01\x02\x03\x04"))

    def capture(self, _window):
        return self.bitmap


class BrokenOcr:
    async def recognize(self, _bitmap):
        raise WindowsOcrError("ocr_recognition_failed")


def test_reader_wipes_bitmap_when_ocr_fails():
    capture = Capture()
    reader = EastmoneyAccountReader(
        locator=Locator(), capture=capture, ocr=BrokenOcr(),
        parser=EastmoneyAccountOcrParser(), clock=lambda: CAPTURED_AT,
    )

    result = asyncio.run(reader.read_account())

    assert result.failure_reason == "ocr_recognition_failed"
    assert capture.bitmap.closed is True
    assert capture.bitmap.pixels == bytearray()


class SuccessfulOcr:
    async def recognize(self, _bitmap):
        return [*funds(), position_header(), position()]


def test_reader_wipes_bitmap_after_success():
    capture = Capture()
    reader = EastmoneyAccountReader(
        locator=Locator(), capture=capture, ocr=SuccessfulOcr(),
        parser=EastmoneyAccountOcrParser(), clock=lambda: CAPTURED_AT,
    )

    result = asyncio.run(reader.read_account())

    assert result.available is True
    assert capture.bitmap.closed is True
