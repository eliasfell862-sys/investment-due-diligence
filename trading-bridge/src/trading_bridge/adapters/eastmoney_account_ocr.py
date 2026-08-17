import re
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol, cast

from pydantic import ValidationError

from trading_bridge.adapters.eastmoney_window import (
    EastmoneyTradingWindowLocator,
    TradingWindowError,
)
from trading_bridge.adapters.ocr_types import InMemoryBitmap, OcrLine, OcrWord
from trading_bridge.adapters.window_capture import InMemoryWindowCapture, WindowCaptureError
from trading_bridge.adapters.windows_ocr import WindowsOcrBackend, WindowsOcrError
from trading_bridge.models import (
    AccountFailureReason,
    AccountResponse,
    BrokerPositionReadOnly,
)

MONEY_PATTERN = re.compile(r"^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$")
INTEGER_PATTERN = re.compile(r"^\d+$")
CODE_PATTERN = re.compile(r"^\d{6}$")

ANCHORS = {
    "available_cash": ("可用资金", "可用金额"),
    "total_assets": ("总资产", "资产总值"),
    "code": ("证券代码", "股票代码"),
    "total_shares": ("全部数量", "股票余额", "股份余额"),
    "available_shares": ("可用数量", "可用余额", "可用股份"),
}
EMPTY_POSITION_ALIASES = ("无持仓", "暂无持仓")


class AccountReader(Protocol):
    async def read_account(self) -> AccountResponse: ...


class Locator(Protocol):
    def locate(self): ...


class Capture(Protocol):
    def capture(self, window) -> InMemoryBitmap: ...


class Ocr(Protocol):
    async def recognize(self, bitmap: InMemoryBitmap) -> list[OcrLine]: ...


def _normalized(value: str) -> str:
    return "".join(value.split()).replace("：", ":")


def _matches(value: str, aliases: tuple[str, ...]) -> bool:
    normalized = _normalized(value)
    return any(_normalized(alias) in normalized for alias in aliases)


def _center_x(word: OcrWord) -> float:
    return word.bounds.x + word.bounds.width / 2


class EastmoneyAccountOcrParser:
    @staticmethod
    def _parse_money_after_anchor(
        lines: list[OcrLine], aliases: tuple[str, ...]
    ) -> float | None:
        for line in lines:
            anchor_indexes = [
                index for index, word in enumerate(line.words)
                if _matches(word.text, aliases)
            ]
            for anchor_index in anchor_indexes:
                for word in line.words[anchor_index + 1 :]:
                    candidate = word.text.strip().replace("¥", "").replace("￥", "")
                    if MONEY_PATTERN.fullmatch(candidate):
                        return float(candidate.replace(",", ""))
        return None

    @staticmethod
    def _find_header(lines: list[OcrLine], aliases: tuple[str, ...]) -> OcrWord | None:
        for line in lines:
            for word in line.words:
                if _matches(word.text, aliases):
                    return word
        return None

    @staticmethod
    def _nearest_integer(words: list[OcrWord], target_x: float) -> int | None:
        candidates = [word for word in words if INTEGER_PATTERN.fullmatch(word.text.strip())]
        if not candidates:
            return None
        nearest = min(candidates, key=lambda word: abs(_center_x(word) - target_x))
        return int(nearest.text.strip())

    def _parse_positions(self, lines: list[OcrLine]):
        if any(_matches(line.text, EMPTY_POSITION_ALIASES) for line in lines):
            return []

        code_header = self._find_header(lines, ANCHORS["code"])
        total_header = self._find_header(lines, ANCHORS["total_shares"])
        available_header = self._find_header(lines, ANCHORS["available_shares"])
        if not code_header or not total_header or not available_header:
            return AccountResponse.unavailable("positions_unreadable")

        header_bottom = max(
            code_header.bounds.bottom,
            total_header.bounds.bottom,
            available_header.bounds.bottom,
        )
        parsed: dict[str, BrokerPositionReadOnly] = {}
        for line in lines:
            row_words = [word for word in line.words if word.bounds.y >= header_bottom]
            code_words = [word for word in row_words if CODE_PATTERN.fullmatch(word.text.strip())]
            if not code_words:
                continue
            code_word = code_words[0]
            number_words = [word for word in row_words if word is not code_word]
            total = self._nearest_integer(number_words, _center_x(total_header))
            available = self._nearest_integer(number_words, _center_x(available_header))
            if total is None or available is None:
                return AccountResponse.unavailable("positions_unreadable")
            try:
                position = BrokerPositionReadOnly(
                    code=code_word.text.strip(),
                    total_shares=total,
                    available_shares=available,
                )
            except ValidationError:
                return AccountResponse.unavailable("field_validation_failed")
            existing = parsed.get(position.code)
            if existing and existing != position:
                return AccountResponse.unavailable("conflicting_position_rows")
            parsed[position.code] = position

        if not parsed:
            return AccountResponse.unavailable("positions_unreadable")
        return list(parsed.values())

    def parse(self, lines: list[OcrLine], captured_at: datetime) -> AccountResponse:
        available_cash = self._parse_money_after_anchor(lines, ANCHORS["available_cash"])
        total_assets = self._parse_money_after_anchor(lines, ANCHORS["total_assets"])
        if available_cash is None or total_assets is None:
            return AccountResponse.unavailable("required_anchor_missing")

        positions = self._parse_positions(lines)
        if isinstance(positions, AccountResponse):
            return positions

        verification_required = available_cash > total_assets
        try:
            return AccountResponse(
                available=True,
                captured_at=captured_at,
                quality=(
                    "verification_required"
                    if verification_required
                    else "verified_by_rules"
                ),
                verification_required=verification_required,
                available_cash=available_cash,
                total_assets=total_assets,
                positions=positions,
                failure_reason=None,
            )
        except ValidationError:
            return AccountResponse.unavailable("field_validation_failed")


class EastmoneyAccountReader:
    def __init__(
        self,
        locator: Locator | None = None,
        capture: Capture | None = None,
        ocr: Ocr | None = None,
        parser: EastmoneyAccountOcrParser | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._locator = locator or EastmoneyTradingWindowLocator()
        self._capture = capture or InMemoryWindowCapture()
        self._ocr = ocr or WindowsOcrBackend()
        self._parser = parser or EastmoneyAccountOcrParser()
        self._clock = clock or (lambda: datetime.now(UTC))

    async def read_account(self) -> AccountResponse:
        bitmap: InMemoryBitmap | None = None
        try:
            window = self._locator.locate()
            bitmap = self._capture.capture(window)
            lines = await self._ocr.recognize(bitmap)
            return self._parser.parse(lines, self._clock())
        except (TradingWindowError, WindowCaptureError, WindowsOcrError) as error:
            return AccountResponse.unavailable(
                cast(AccountFailureReason, error.code)
            )
        except Exception:
            return AccountResponse.unavailable("field_validation_failed")
        finally:
            if bitmap is not None:
                bitmap.close()
