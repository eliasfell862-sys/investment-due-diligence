from dataclasses import dataclass
from typing import Any, Protocol


PROCESS_NAME = "mainfree.exe"
WINDOW_CLASS = "#32770"
REQUIRED_CHILD_CLASSES = {"CElementFrameWnd_DC", "ContainerWnd_DC"}
MIN_CLIENT_WIDTH = 500
MIN_CLIENT_HEIGHT = 300


@dataclass(frozen=True, slots=True)
class TradingWindow:
    hwnd: int
    width: int
    height: int


class TradingWindowError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class ReadOnlyWindowBackend(Protocol):
    def list_windows(self) -> list[dict[str, Any]]: ...


class Win32ReadOnlyWindowBackend:
    """Reads window metadata only and never invokes a UI control."""

    def list_windows(self) -> list[dict[str, Any]]:
        try:
            import psutil
            import win32gui
            import win32process
        except ImportError:
            return []

        process_names: dict[int, str] = {}
        for process in psutil.process_iter(["pid", "name"]):
            try:
                process_names[int(process.info["pid"])] = (
                    process.info.get("name") or ""
                ).lower()
            except (psutil.Error, TypeError, ValueError):
                continue

        windows: list[dict[str, Any]] = []

        def inspect_window(hwnd: int, _extra: object) -> None:
            try:
                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                process_name = process_names.get(int(pid), "")
                if process_name != PROCESS_NAME:
                    return
                child_classes: list[str] = []

                def inspect_child(child: int, _unused: object) -> None:
                    try:
                        child_classes.append(win32gui.GetClassName(child) or "")
                    except Exception:
                        return

                win32gui.EnumChildWindows(hwnd, inspect_child, None)
                left, top, right, bottom = win32gui.GetClientRect(hwnd)
                windows.append({
                    "hwnd": int(hwnd),
                    "pid": int(pid),
                    "process_name": process_name,
                    "visible": bool(win32gui.IsWindowVisible(hwnd)),
                    "minimized": bool(win32gui.IsIconic(hwnd)),
                    "width": max(0, int(right - left)),
                    "height": max(0, int(bottom - top)),
                    "class_name": win32gui.GetClassName(hwnd) or "",
                    "child_classes": child_classes,
                })
            except Exception:
                return

        win32gui.EnumWindows(inspect_window, None)
        return windows


class EastmoneyTradingWindowLocator:
    def __init__(self, backend: ReadOnlyWindowBackend | None = None) -> None:
        self._backend = backend or Win32ReadOnlyWindowBackend()

    @staticmethod
    def _has_known_structure(window: dict[str, Any]) -> bool:
        child_classes = set(window.get("child_classes") or [])
        return (
            str(window.get("process_name") or "").lower() == PROCESS_NAME
            and window.get("class_name") == WINDOW_CLASS
            and REQUIRED_CHILD_CLASSES.issubset(child_classes)
        )

    def locate(self) -> TradingWindow:
        windows = self._backend.list_windows()
        structured = [window for window in windows if self._has_known_structure(window)]
        if any(window.get("minimized") for window in structured):
            non_minimized = [window for window in structured if not window.get("minimized")]
            if not non_minimized:
                raise TradingWindowError("trading_window_minimized")

        valid = [
            window
            for window in structured
            if window.get("visible")
            and not window.get("minimized")
            and int(window.get("width") or 0) >= MIN_CLIENT_WIDTH
            and int(window.get("height") or 0) >= MIN_CLIENT_HEIGHT
        ]
        shell_minimized = any(
            str(window.get("process_name") or "").lower() == PROCESS_NAME
            and bool(window.get("minimized"))
            for window in windows
        )
        if not valid and structured and shell_minimized:
            raise TradingWindowError("trading_window_minimized")
        if not valid:
            raise TradingWindowError("trading_window_not_found")
        if len(valid) != 1:
            raise TradingWindowError("ambiguous_trading_window")
        window = valid[0]
        return TradingWindow(
            hwnd=int(window["hwnd"]),
            width=int(window["width"]),
            height=int(window["height"]),
        )
