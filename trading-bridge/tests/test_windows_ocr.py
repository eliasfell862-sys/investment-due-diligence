import asyncio
from types import SimpleNamespace

import pytest

from trading_bridge.adapters.ocr_types import InMemoryBitmap
from trading_bridge.adapters.windows_ocr import (
    WindowsOcrBackend,
    WindowsOcrError,
    convert_winrt_result,
)


def bitmap():
    return InMemoryBitmap(1, 1, 4, bytearray(b"\x01\x02\x03\x04"))


def test_missing_winrt_packages_are_reported_without_import_details():
    def missing_runtime():
        raise ImportError("sensitive local package path")

    with pytest.raises(WindowsOcrError, match="windows_ocr_unavailable") as caught:
        asyncio.run(WindowsOcrBackend(missing_runtime).recognize(bitmap()))

    assert str(caught.value) == "windows_ocr_unavailable"


def test_missing_chinese_ocr_engine_is_reported_as_unavailable():
    class Runtime:
        async def recognize(self, _bitmap):
            raise WindowsOcrError("windows_ocr_unavailable")

    with pytest.raises(WindowsOcrError, match="windows_ocr_unavailable"):
        asyncio.run(WindowsOcrBackend(lambda: Runtime()).recognize(bitmap()))


def test_runtime_error_is_sanitized():
    class Runtime:
        async def recognize(self, _bitmap):
            raise RuntimeError("raw ocr text and account data")

    with pytest.raises(WindowsOcrError, match="ocr_recognition_failed") as caught:
        asyncio.run(WindowsOcrBackend(lambda: Runtime()).recognize(bitmap()))

    assert str(caught.value) == "ocr_recognition_failed"
    assert "account" not in str(caught.value)


def test_backend_returns_runtime_geometry():
    expected = []

    class Runtime:
        async def recognize(self, _bitmap):
            return expected

    result = asyncio.run(WindowsOcrBackend(lambda: Runtime()).recognize(bitmap()))

    assert result is expected


def test_converts_winrt_words_and_bounds_to_immutable_geometry():

    result = SimpleNamespace(lines=[
        SimpleNamespace(
            text="000333 100 100",
            words=[
                SimpleNamespace(
                    text="000333",
                    bounding_rect=SimpleNamespace(x=10, y=20, width=60, height=18),
                ),
                SimpleNamespace(
                    text="100",
                    bounding_rect=SimpleNamespace(x=100, y=20, width=30, height=18),
                ),
            ],
        )
    ])

    lines = convert_winrt_result(result)

    assert lines[0].text == "000333 100 100"
    assert lines[0].words[0].text == "000333"
    assert lines[0].words[0].bounds.x == 10
    assert lines[0].words[1].bounds.right == 130


def test_winrt_321_software_bitmap_uses_four_parameter_projection():
    from trading_bridge.adapters.windows_ocr import WinRtOcrRuntime

    class FakeBuffer(bytearray):
        def __new__(cls, capacity):
            return super().__new__(cls, capacity)

        def __init__(self, capacity):
            super().__init__(capacity)
            self.length = 0

    class FakeSoftwareBitmap:
        calls = []

        @classmethod
        def create_copy_from_buffer(cls, *args):
            cls.calls.append(args)
            if len(args) != 4:
                raise TypeError("Invalid parameter count")
            return object()

    runtime = WinRtOcrRuntime.__new__(WinRtOcrRuntime)
    runtime._buffer = FakeBuffer
    runtime._software_bitmap = FakeSoftwareBitmap
    runtime._bitmap_pixel_format = SimpleNamespace(BGRA8="bgra8")
    runtime._bitmap_alpha_mode = SimpleNamespace(IGNORE="ignore")

    result = runtime._create_bitmap(bitmap())

    assert result is not None
    assert len(FakeSoftwareBitmap.calls[0]) == 4

def test_conversion_drops_empty_words_without_exposing_other_attributes():
    result = SimpleNamespace(lines=[
        SimpleNamespace(
            text="",
            words=[
                SimpleNamespace(
                    text="",
                    bounding_rect=SimpleNamespace(x=0, y=0, width=0, height=0),
                    account_number="must-not-pass",
                )
            ],
        )
    ])

    lines = convert_winrt_result(result)

    assert lines == []
