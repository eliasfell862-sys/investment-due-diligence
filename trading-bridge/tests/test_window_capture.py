import pytest

from trading_bridge.adapters.eastmoney_window import TradingWindow
from trading_bridge.adapters.window_capture import (
    InMemoryWindowCapture,
    WindowCaptureError,
)


class FakeCaptureBackend:
    def __init__(self, pixels=None, read_error=None):
        self.pixels = pixels
        self.read_error = read_error
        self.begin_calls = []
        self.release_calls = []
        self.session = object()

    def begin(self, hwnd, width, height):
        self.begin_calls.append((hwnd, width, height))
        return self.session

    def read_bgra(self, session, width, height):
        assert session is self.session
        if self.read_error:
            raise self.read_error
        if self.pixels is not None:
            return self.pixels
        return bytes([1]) * (width * height * 4)

    def release(self, session):
        self.release_calls.append(session)


def test_captures_client_dimensions_and_releases_resources():
    backend = FakeCaptureBackend()
    capture = InMemoryWindowCapture(backend)

    bitmap = capture.capture(TradingWindow(hwnd=101, width=2, height=3))

    assert backend.begin_calls == [(101, 2, 3)]
    assert backend.release_calls == [backend.session]
    assert bitmap.width == 2
    assert bitmap.height == 3
    assert bitmap.stride == 8
    assert len(bitmap.pixels) == 24


def test_releases_resources_when_capture_read_raises():
    backend = FakeCaptureBackend(read_error=RuntimeError("sensitive raw failure"))

    with pytest.raises(WindowCaptureError, match="window_capture_failed") as caught:
        InMemoryWindowCapture(backend).capture(TradingWindow(101, 2, 2))

    assert str(caught.value) == "window_capture_failed"
    assert backend.release_calls == [backend.session]


def test_blank_capture_fails_and_releases_resources():
    backend = FakeCaptureBackend(pixels=bytes(16))

    with pytest.raises(WindowCaptureError, match="blank_capture"):
        InMemoryWindowCapture(backend).capture(TradingWindow(101, 2, 2))

    assert backend.release_calls == [backend.session]


def test_short_capture_buffer_is_rejected():
    backend = FakeCaptureBackend(pixels=bytes([1]) * 8)

    with pytest.raises(WindowCaptureError, match="window_capture_failed"):
        InMemoryWindowCapture(backend).capture(TradingWindow(101, 2, 2))

    assert backend.release_calls == [backend.session]


def test_bitmap_pixels_can_be_wiped_after_capture():
    bitmap = InMemoryWindowCapture(FakeCaptureBackend()).capture(
        TradingWindow(101, 1, 1)
    )

    bitmap.close()

    assert bitmap.closed is True
    assert bitmap.pixels == bytearray()
