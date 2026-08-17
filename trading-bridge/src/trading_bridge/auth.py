import secrets
from collections.abc import Callable

from fastapi import Header, HTTPException


def bridge_token_dependency(expected_token: str) -> Callable[..., None]:
    if not expected_token:
        raise ValueError("bridge_token_required")

    def require_bridge_token(x_bridge_token: str | None = Header(default=None)) -> None:
        if x_bridge_token is None or not secrets.compare_digest(x_bridge_token, expected_token):
            raise HTTPException(status_code=401, detail="invalid_bridge_token")

    return require_bridge_token
