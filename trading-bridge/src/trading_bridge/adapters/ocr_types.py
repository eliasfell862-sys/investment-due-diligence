from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class OcrRect:
    x: float
    y: float
    width: float
    height: float

    @property
    def right(self) -> float:
        return self.x + self.width

    @property
    def bottom(self) -> float:
        return self.y + self.height


@dataclass(frozen=True, slots=True)
class OcrWord:
    text: str
    bounds: OcrRect


@dataclass(frozen=True, slots=True)
class OcrLine:
    text: str
    words: tuple[OcrWord, ...]


@dataclass(slots=True)
class InMemoryBitmap:
    width: int
    height: int
    stride: int
    pixels: bytearray = field(repr=False)
    _closed: bool = field(default=False, init=False, repr=False)

    def __post_init__(self) -> None:
        if self.width <= 0 or self.height <= 0:
            raise ValueError("bitmap_dimensions_must_be_positive")
        if self.stride < self.width * 4:
            raise ValueError("bitmap_stride_too_small")
        if len(self.pixels) < self.stride * self.height:
            raise ValueError("bitmap_buffer_too_small")

    @property
    def closed(self) -> bool:
        return self._closed

    def close(self) -> None:
        if self._closed:
            return
        for index in range(len(self.pixels)):
            self.pixels[index] = 0
        self.pixels.clear()
        self._closed = True

    def __enter__(self) -> "InMemoryBitmap":
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()
