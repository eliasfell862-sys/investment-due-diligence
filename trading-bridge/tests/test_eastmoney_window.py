import pytest

from trading_bridge.adapters.eastmoney_window import (
    EastmoneyTradingWindowLocator,
    TradingWindowError,
)


class FakeWin32:
    def __init__(self, windows):
        self.windows = windows
        self.click_calls = []
        self.type_calls = []

    def list_windows(self):
        return self.windows


def valid_window(hwnd=101):
    return {
        "hwnd": hwnd,
        "pid": 99,
        "process_name": "mainfree.exe",
        "visible": True,
        "minimized": False,
        "width": 1403,
        "height": 819,
        "class_name": "#32770",
        "child_classes": ["CElementFrameWnd_DC", "ContainerWnd_DC"],
    }


def test_locates_unique_read_only_eastmoney_trading_window():
    backend = FakeWin32([valid_window()])
    result = EastmoneyTradingWindowLocator(backend).locate()
    assert result.hwnd == 101
    assert result.width == 1403
    assert result.height == 819
    assert backend.click_calls == []
    assert backend.type_calls == []


def test_rejects_similar_window_from_wrong_process():
    candidate = valid_window()
    candidate["process_name"] = "other.exe"
    with pytest.raises(TradingWindowError, match="trading_window_not_found"):
        EastmoneyTradingWindowLocator(FakeWin32([candidate])).locate()


def test_reports_minimized_matching_window():
    candidate = valid_window()
    candidate["minimized"] = True
    with pytest.raises(TradingWindowError, match="trading_window_minimized"):
        EastmoneyTradingWindowLocator(FakeWin32([candidate])).locate()


def test_reports_minimized_shell_when_trading_child_becomes_hidden():
    trading = valid_window()
    trading["visible"] = False
    shell = {
        **valid_window(102),
        "class_name": "AfxMainFrame",
        "child_classes": [],
        "minimized": True,
        "width": 154,
        "height": 23,
    }
    with pytest.raises(TradingWindowError, match="trading_window_minimized"):
        EastmoneyTradingWindowLocator(FakeWin32([trading, shell])).locate()


def test_rejects_window_without_known_self_drawn_children():
    candidate = valid_window()
    candidate["child_classes"] = ["Button", "Static"]
    with pytest.raises(TradingWindowError, match="trading_window_not_found"):
        EastmoneyTradingWindowLocator(FakeWin32([candidate])).locate()


def test_rejects_small_or_hidden_window():
    small = valid_window(201)
    small["width"] = 300
    hidden = valid_window(202)
    hidden["visible"] = False
    with pytest.raises(TradingWindowError, match="trading_window_not_found"):
        EastmoneyTradingWindowLocator(FakeWin32([small, hidden])).locate()


def test_rejects_ambiguous_matching_windows():
    with pytest.raises(TradingWindowError, match="ambiguous_trading_window"):
        EastmoneyTradingWindowLocator(
            FakeWin32([valid_window(301), valid_window(302)])
        ).locate()
