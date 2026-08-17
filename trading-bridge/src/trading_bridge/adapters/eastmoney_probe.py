import hashlib
import re
from typing import Any, Protocol

from trading_bridge.models import CapabilityReport

SENSITIVE_DIGITS = re.compile(r"\d{6,}")
PROCESS_NAMES = {"mainfree.exe", "emtrade.exe", "eastmoney.exe"}


class ReadOnlyUiaBackend(Protocol):
    def snapshot(self) -> dict[str, Any]: ...


def redact(value: str) -> str:
    return SENSITIVE_DIGITS.sub("[REDACTED]", value)


class PywinautoReadOnlyBackend:
    """Enumerates metadata only; it never invokes or mutates a UI control."""

    def snapshot(self) -> dict[str, Any]:
        try:
            import psutil
            from pywinauto import Desktop
        except ImportError as error:
            return {"processes": [], "windows": [], "backend_error": type(error).__name__}

        processes: list[dict[str, Any]] = []
        process_ids: set[int] = set()
        for process in psutil.process_iter(["pid", "name", "exe"]):
            try:
                name = (process.info.get("name") or "").lower()
                if name not in PROCESS_NAMES:
                    continue
                pid = int(process.info["pid"])
                processes.append({
                    "pid": pid,
                    "name": name,
                    "executable_path": process.info.get("exe"),
                    "product_version": None,
                })
                process_ids.add(pid)
            except (psutil.Error, ValueError, TypeError):
                continue

        windows: list[dict[str, Any]] = []
        if not processes:
            return {"processes": [], "windows": []}
        for window in Desktop(backend="uia").windows():
            try:
                if int(window.process_id()) not in process_ids:
                    continue
                texts = [control.window_text() for control in window.descendants() if control.window_text()]
                windows.append({
                    "title": window.window_text() or "",
                    "control_type": window.element_info.control_type or "Window",
                    "automation_id": window.element_info.automation_id or "",
                    "texts": texts,
                    "is_dialog": window.element_info.control_type == "Window" and window.is_dialog(),
                })
            except Exception:
                continue
        return {"processes": processes, "windows": windows}


class EastmoneyCapabilityProbe:
    def __init__(self, backend: ReadOnlyUiaBackend | None = None) -> None:
        self._backend = backend or PywinautoReadOnlyBackend()

    def probe(self) -> CapabilityReport:
        snapshot = self._backend.snapshot()
        processes = snapshot.get("processes") or []
        windows = snapshot.get("windows") or []
        process = processes[0] if processes else {}
        executable_path = process.get("executable_path")
        path_hash = hashlib.sha256(str(executable_path).encode()).hexdigest() if executable_path else None
        all_text = " ".join(
            [str(window.get("title") or "") for window in windows]
            + [str(text) for window in windows for text in (window.get("texts") or [])]
        )
        lowered = all_text.lower()
        unknown_dialogs = [
            redact(str(window.get("title") or "unknown_dialog"))
            for window in windows
            if window.get("is_dialog")
        ]
        process_detected = bool(processes)
        window_detected = bool(windows)
        evidence = [redact(f"process={process.get('name', 'not_detected')}"), f"windows={len(windows)}"]
        if snapshot.get("backend_error"):
            evidence.append(f"backend_error={snapshot['backend_error']}")

        return CapabilityReport(
            process_detected=process_detected,
            executable_path_hash=path_hash,
            product_version=redact(str(process.get("product_version"))) if process.get("product_version") else None,
            window_detected=window_detected,
            login_state_readable=any(keyword in lowered for keyword in ("账号", "登录", "退出", "account")),
            funds_view_readable=any(keyword in lowered for keyword in ("可用资金", "总资产", "funds")),
            positions_view_readable=any(keyword in lowered for keyword in ("持仓", "positions")),
            orders_view_readable=any(keyword in lowered for keyword in ("委托", "订单", "orders")),
            cancel_control_readable=any(keyword in lowered for keyword in ("撤单", "cancel")),
            unknown_dialogs=unknown_dialogs,
            redacted_evidence=evidence,
            safe_for_shadow=process_detected and window_detected and not unknown_dialogs,
            safe_for_live=False,
        )
