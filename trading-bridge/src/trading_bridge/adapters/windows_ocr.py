from collections.abc import Callable
from typing import Any, Protocol

from trading_bridge.adapters.ocr_types import InMemoryBitmap, OcrLine, OcrRect, OcrWord


class WindowsOcrError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class OcrRuntime(Protocol):
    async def recognize(self, bitmap: InMemoryBitmap) -> list[OcrLine]: ...


def convert_winrt_result(result: Any) -> list[OcrLine]:
    lines: list[OcrLine] = []
    for raw_line in getattr(result, "lines", ()) or ():
        text = str(getattr(raw_line, "text", "") or "").strip()
        words: list[OcrWord] = []
        for raw_word in getattr(raw_line, "words", ()) or ():
            word_text = str(getattr(raw_word, "text", "") or "").strip()
            bounds = getattr(raw_word, "bounding_rect", None)
            if not word_text or bounds is None:
                continue
            words.append(OcrWord(
                text=word_text,
                bounds=OcrRect(
                    x=float(bounds.x),
                    y=float(bounds.y),
                    width=float(bounds.width),
                    height=float(bounds.height),
                ),
            ))
        if text and words:
            lines.append(OcrLine(text=text, words=tuple(words)))
    return lines


class WinRtOcrRuntime:
    def __init__(self) -> None:
        from winrt.windows.globalization import Language
        from winrt.windows.graphics.imaging import (
            BitmapPixelFormat,
            SoftwareBitmap,
        )
        from winrt.windows.media.ocr import OcrEngine
        from winrt.windows.storage.streams import Buffer

        self._bitmap_pixel_format = BitmapPixelFormat
        self._software_bitmap = SoftwareBitmap
        self._buffer = Buffer
        self._engine = OcrEngine.try_create_from_language(Language("zh-Hans"))
        if self._engine is None:
            raise WindowsOcrError("windows_ocr_unavailable")

    def _create_bitmap(self, bitmap: InMemoryBitmap) -> Any:
        if bitmap.closed:
            raise WindowsOcrError("ocr_recognition_failed")
        buffer = self._buffer(len(bitmap.pixels))
        buffer.length = len(bitmap.pixels)
        view = memoryview(buffer).cast("B")
        view[: len(bitmap.pixels)] = bitmap.pixels
        return self._software_bitmap.create_copy_from_buffer(
            buffer,
            self._bitmap_pixel_format.BGRA8,
            bitmap.width,
            bitmap.height,
        )

    async def recognize(self, bitmap: InMemoryBitmap) -> list[OcrLine]:
        software_bitmap = self._create_bitmap(bitmap)
        try:
            result = await self._engine.recognize_async(software_bitmap)
            return convert_winrt_result(result)
        finally:
            close = getattr(software_bitmap, "close", None)
            if callable(close):
                close()


class WindowsOcrBackend:
    def __init__(
        self,
        runtime_factory: Callable[[], OcrRuntime] | None = None,
    ) -> None:
        self._runtime_factory = runtime_factory or WinRtOcrRuntime

    async def recognize(self, bitmap: InMemoryBitmap) -> list[OcrLine]:
        try:
            runtime = self._runtime_factory()
        except WindowsOcrError:
            raise
        except (ImportError, ModuleNotFoundError) as error:
            raise WindowsOcrError("windows_ocr_unavailable") from error
        except Exception as error:
            raise WindowsOcrError("ocr_recognition_failed") from error

        try:
            return await runtime.recognize(bitmap)
        except WindowsOcrError:
            raise
        except Exception as error:
            raise WindowsOcrError("ocr_recognition_failed") from error
