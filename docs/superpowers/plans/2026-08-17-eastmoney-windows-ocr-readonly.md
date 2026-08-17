# Eastmoney Windows OCR Read-Only Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read available cash, total assets, stock codes, total shares, and available shares from the local Eastmoney trading window through Windows OCR without saving screenshots or enabling live execution.

**Architecture:** Locate the known self-drawn trading window, capture only its client area into a disposable BGRA buffer, run local WinRT OCR, and parse word geometry into a validated account snapshot. The authenticated loopback bridge passes the snapshot through Electron; React requires explicit confirmation before using it for shadow risk inputs.

**Tech Stack:** Python 3.12, FastAPI, Pydantic 2, ctypes/Win32 GDI, WinRT OCR 3.2.1, Electron IPC, React 19, TypeScript, Vitest, pytest.

## Global Constraints

- Execute inline without subagents in the existing isolated worktree.
- Never click, type, invoke, submit, cancel, or mutate Eastmoney controls.
- Keep `safe_for_live=false`; add no live-order path.
- Screenshots and raw OCR text remain in memory only and are never logged, cached, saved, or uploaded.
- Do not modify Supabase, Railway, Netlify, stock analysis, or the K-line source.
- OCR is user-triggered only; first release reads only the five approved field groups.
- Ambiguity returns a typed failure or manual-review state; never guess or reuse stale values.

## File Map

- `adapters/ocr_types.py`: OCR geometry and disposable bitmap contracts.
- `adapters/eastmoney_window.py`: read-only trading-window locator.
- `adapters/window_capture.py`: Win32 client-area capture and cleanup.
- `adapters/windows_ocr.py`: WinRT OCR backend.
- `adapters/eastmoney_account_ocr.py`: anchors, parsing, validation, orchestration.
- `models.py` and `app.py`: typed account response and authenticated endpoint.
- Electron manager/IPC/preload/types: safe transport to the renderer.
- Live-trading hook/page/CSS/types: read, review, confirm, refresh, and shadow-risk use.

---

### Task 1: OCR contracts and account models

**Files:** Create `trading-bridge/src/trading_bridge/adapters/ocr_types.py`; modify `trading-bridge/src/trading_bridge/models.py`; test `trading-bridge/tests/test_account_models.py`.

**Interfaces:** Produce `OcrRect`, `OcrWord`, `OcrLine`, `InMemoryBitmap.close()`, `BrokerPositionReadOnly`, `AccountResponse`, `AccountFailureReason`, and `AccountQuality`.

- [ ] Write failing tests that reject non-six-digit codes, negative quantities, and `available_shares > total_shares`; test `AccountResponse.unavailable()` clears all value fields.
- [ ] Run `pytest tests/test_account_models.py -q`; expect missing imports.
- [ ] Implement strict Pydantic models and the disposable byte buffer. Use this invariant:

```python
@model_validator(mode="after")
def validate_available(self):
    if self.available_shares > self.total_shares:
        raise ValueError("available_shares_exceed_total")
    return self
```

- [ ] Run focused and full Python tests.
- [ ] Commit `feat: add ocr account contracts`.

### Task 2: Trading-window locator

**Files:** Create `trading-bridge/src/trading_bridge/adapters/eastmoney_window.py`; test `trading-bridge/tests/test_eastmoney_window.py`.

**Interfaces:** Produce `TradingWindow(hwnd, width, height)` and `EastmoneyTradingWindowLocator.locate()`; raise `TradingWindowError` with `trading_window_not_found`, `ambiguous_trading_window`, or `trading_window_minimized`.

- [ ] Write fake-Win32 tests for one valid window, wrong process, minimized window, and two valid windows.
- [ ] Run the focused test; expect missing module.
- [ ] Implement read-only matching: `mainfree.exe`, visible, not iconic, at least `500x300`, top class `#32770`, children include `CElementFrameWnd_DC` and `ContainerWnd_DC`. Never identify only by title.
- [ ] Run focused/full tests.
- [ ] Commit `feat: locate eastmoney trading window`.

### Task 3: Disposable in-memory capture

**Files:** Create `trading-bridge/src/trading_bridge/adapters/window_capture.py`; test `trading-bridge/tests/test_window_capture.py`.

**Interfaces:** `InMemoryWindowCapture.capture(TradingWindow) -> InMemoryBitmap`; raise `window_capture_failed` or `blank_capture`.

- [ ] Write tests proving client dimensions are used, zero pixels fail, and every fake DC/bitmap handle is released on success and exception.
- [ ] Run focused test; expect missing implementation.
- [ ] Implement an injected backend plus ctypes production backend using `GetClientRect`, compatible DC/bitmap, `PrintWindow(PW_CLIENTONLY | PW_RENDERFULLCONTENT)`, and `GetDIBits`.
- [ ] Make `InMemoryBitmap.close()` overwrite and clear its bytearray and remain idempotent; rerun focused/full tests.
- [ ] Commit `feat: capture eastmoney window in memory`.

### Task 4: Local WinRT OCR

**Files:** Modify `trading-bridge/pyproject.toml`; create `trading-bridge/src/trading_bridge/adapters/windows_ocr.py`; test `trading-bridge/tests/test_windows_ocr.py`.

**Interfaces:** `async WindowsOcrBackend.recognize(InMemoryBitmap) -> list[OcrLine]`; raise `windows_ocr_unavailable` or `ocr_recognition_failed`.

- [ ] Write failing tests for missing Chinese OCR engine, sanitized WinRT exceptions, and fake word/bounds conversion.
- [ ] Run focused test; expect missing module.
- [ ] Pin `winrt-runtime`, `winrt-Windows.Globalization`, `winrt-Windows.Graphics.Imaging`, `winrt-Windows.Media.Ocr`, and `winrt-Windows.Storage.Streams` to `3.2.1`.
- [ ] Lazily import WinRT, create `Language("zh-Hans")`, copy BGRA into `SoftwareBitmap`, await `recognize_async`, and return only line/word geometry. Install editable test dependencies and run focused/full tests.
- [ ] Commit `feat: add local windows ocr backend`.

### Task 5: Account parser and reader orchestration

**Files:** Create `trading-bridge/src/trading_bridge/adapters/eastmoney_account_ocr.py`; test `trading-bridge/tests/test_eastmoney_account_ocr.py`.

**Interfaces:** Define `AccountReader(Protocol)` with `async read_account() -> AccountResponse`; implement `EastmoneyAccountOcrParser.parse(lines, captured_at) -> AccountResponse` and `EastmoneyAccountReader.read_account()`.

- [ ] Write failing tests for `1,234.56`, valid rows, available exceeding total, conflicting duplicates, missing anchors, and explicit empty holdings.
- [ ] Run focused test; expect missing parser.
- [ ] Implement geometry matching with exact aliases:

```python
ANCHORS = {
  "available_cash": ("可用资金", "可用金额"),
  "total_assets": ("总资产", "资产总值"),
  "code": ("证券代码", "股票代码"),
  "total_shares": ("全部数量", "股票余额", "股份余额"),
  "available_shares": ("可用数量", "可用余额", "可用股份"),
}
```

- [ ] Add orchestration tests proving bitmap cleanup occurs in `finally` for OCR and parser failures; run focused/full tests.
- [ ] Commit `feat: parse eastmoney ocr account snapshot`.

### Task 6: Authenticated account endpoint

**Files:** Modify `trading-bridge/src/trading_bridge/app.py` and `trading-bridge/tests/test_app.py`.

**Interfaces:** Change to `create_app(account_reader: AccountReader | None = None)`; authenticated `GET /v1/account` awaits `read_account()`.

- [ ] Replace the placeholder test with injected success/unavailable readers; assert JSON excludes raw OCR, handles, titles, paths, and account numbers.
- [ ] Run `pytest tests/test_app.py -q`; expect injection failure.
- [ ] Make the route async and use `EastmoneyAccountReader` by default while preserving token and loopback requirements.
- [ ] Run all Python tests.
- [ ] Commit `feat: expose eastmoney ocr account reader`.

### Task 7: Electron transport

**Files:** Modify `app/electron/trading-bridge-manager.cjs`, its test, `app/electron/main.cjs`, `app/electron/preload.cjs`, `app/src/types/electron-trading-bridge.d.ts`, and `live-trading-types.ts`.

**Interfaces:** Produce `electronTrading.readEastmoneyAccount()` and camelCase `EastmoneyOcrAccountSnapshot`.

- [ ] Add a manager test for authenticated `GET /v1/account` and exact snake-to-camel conversion.
- [ ] Run `npm test -- electron/trading-bridge-manager.test.ts`; expect missing method.
- [ ] Add manager method, IPC `trading:read-eastmoney-account`, preload method, and strict types containing only approved fields.
- [ ] Run manager test and `npm run typecheck`.
- [ ] Commit `feat: expose ocr account snapshot to electron`.

### Task 8: Read, review, confirm, and refresh UI

**Files:** Modify `useLiveTradingShadow.ts`, `LiveTradingShadowPage.tsx`, `LiveTradingShadowPage.css`, and `LiveTradingShadowPage.test.tsx` under `app/src/features/securities/live-trading/`.

**Interfaces:** Add `accountDraft`, `confirmedAccount`, `accountReading`, `accountError`, `readEastmoneyAccount()`, `confirmEastmoneyAccount()`, and `clearEastmoneyAccount()`.

- [ ] Write page tests for offline disabled state, unconfirmed display, explicit confirmation, refresh replacing the draft, failure clearing stale draft, and no live switch.
- [ ] Run focused test; expect missing controls.
- [ ] Implement manual read/refresh, capture time, funds, code and total/available quantities, permanent OCR warning, and confirmation. Never persist snapshot in localStorage or cloud state.
- [ ] Run focused test and typecheck.
- [ ] Commit `feat: add eastmoney ocr account review ui`.

### Task 9: Confirmed snapshot shadow-risk integration

**Files:** Modify `useLiveTradingShadow.ts`; create `app/src/features/securities/live-trading/useLiveTradingShadow.test.tsx`.

**Interfaces:** Consume only `confirmedAccount`, never `accountDraft`.

- [ ] Write hook tests proving unconfirmed OCR has no effect, confirmed cash limits buys, confirmed codes affect position count, and available shares remain available for future T+1 checks.
- [ ] Run focused test; expect existing website-ledger inputs.
- [ ] When confirmed, use OCR cash and positions; value holdings from current quotes and block with `confirmed_position_quote_missing` if a held code lacks a quote. Without confirmation, preserve existing behavior.
- [ ] Run hook, live-trading, and risk-engine tests.
- [ ] Commit `feat: apply confirmed broker snapshot to shadow risk`.

### Task 10: Verification and runbook

**Files:** Modify `docs/live-trading/eastmoney-shadow-runbook.md`.

- [ ] Document Windows Chinese OCR support, opening the trading/positions window, manual review/confirmation, refresh, and every failure code.
- [ ] Run `cd trading-bridge; .\.venv\Scripts\python.exe -m pytest -q`.
- [ ] Run `cd app; npm run typecheck; npm test -- electron/trading-bridge-manager.test.ts src/features/securities/live-trading; npm run lint; npm run build`.
- [ ] Search and review forbidden behavior with `rg -n "click_input|type_keys|set_edit_text|invoke\(|submit.*broker|raw_ocr|screenshot" trading-bridge app/src app/electron`.
- [ ] Perform one user-triggered local read with Eastmoney open; manually compare values without printing them or saving an image. Commit `docs: document eastmoney ocr verification`.

## Completion Gate

- All automated checks pass.
- Real local read matches user-confirmed values or returns a typed safe failure.
- No screenshot/raw OCR exists on disk, logs, browser storage, or cloud storage.
- No cloud mutation, push, merge, or deployment occurs without separate approval.
