import ctypes
from dataclasses import dataclass
from typing import Any, Protocol

from trading_bridge.adapters.eastmoney_window import TradingWindow
from trading_bridge.adapters.ocr_types import InMemoryBitmap

PW_CLIENTONLY = 0x00000001
PW_RENDERFULLCONTENT = 0x00000002


class WindowCaptureError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class CaptureBackend(Protocol):
    def begin(self, hwnd: int, width: int, height: int) -> Any: ...

    def read_bgra(self, session: Any, width: int, height: int) -> bytes: ...

    def release(self, session: Any) -> None: ...


@dataclass(slots=True)
class _GdiSession:
    hwnd: int
    source_handle: int
    source_dc: Any
    memory_dc: Any
    bitmap: Any


class PyWin32CaptureBackend:
    def begin(self, hwnd: int, width: int, height: int) -> _GdiSession:
        import win32gui
        import win32ui

        source_handle = win32gui.GetWindowDC(hwnd)
        if not source_handle:
            raise OSError("window_dc_unavailable")
        source_dc = None
        memory_dc = None
        bitmap = None
        try:
            source_dc = win32ui.CreateDCFromHandle(source_handle)
            memory_dc = source_dc.CreateCompatibleDC()
            bitmap = win32ui.CreateBitmap()
            bitmap.CreateCompatibleBitmap(source_dc, width, height)
            memory_dc.SelectObject(bitmap)
            return _GdiSession(hwnd, source_handle, source_dc, memory_dc, bitmap)
        except Exception:
            if bitmap is not None:
                try:
                    win32gui.DeleteObject(bitmap.GetHandle())
                except Exception:
                    pass
            if memory_dc is not None:
                memory_dc.DeleteDC()
            if source_dc is not None:
                source_dc.DeleteDC()
            win32gui.ReleaseDC(hwnd, source_handle)
            raise

    def read_bgra(self, session: _GdiSession, width: int, height: int) -> bytes:
        printed = ctypes.windll.user32.PrintWindow(
            session.hwnd,
            session.memory_dc.GetSafeHdc(),
            PW_CLIENTONLY | PW_RENDERFULLCONTENT,
        )
        if printed != 1:
            raise OSError("print_window_failed")
        raw = bytes(session.bitmap.GetBitmapBits(True))
        stride = width * 4
        expected = stride * height
        if len(raw) < expected:
            raise OSError("bitmap_buffer_too_small")
        rows = [raw[offset : offset + stride] for offset in range(0, expected, stride)]
        return b"".join(reversed(rows))

    def release(self, session: _GdiSession) -> None:
        import win32gui

        try:
            win32gui.DeleteObject(session.bitmap.GetHandle())
        finally:
            try:
                session.memory_dc.DeleteDC()
            finally:
                try:
                    session.source_dc.DeleteDC()
                finally:
                    win32gui.ReleaseDC(session.hwnd, session.source_handle)


class InMemoryWindowCapture:
    def __init__(self, backend: CaptureBackend | None = None) -> None:
        self._backend = backend or PyWin32CaptureBackend()

    def capture(self, window: TradingWindow) -> InMemoryBitmap:
        session: Any | None = None
        try:
            session = self._backend.begin(window.hwnd, window.width, window.height)
            pixels = self._backend.read_bgra(session, window.width, window.height)
            expected = window.width * window.height * 4
            if len(pixels) != expected:
                raise WindowCaptureError("window_capture_failed")
            if not any(pixels):
                raise WindowCaptureError("blank_capture")
            return InMemoryBitmap(
                width=window.width,
                height=window.height,
                stride=window.width * 4,
                pixels=bytearray(pixels),
            )
        except WindowCaptureError:
            raise
        except Exception as error:
            raise WindowCaptureError("window_capture_failed") from error
        finally:
            if session is not None:
                self._backend.release(session)
