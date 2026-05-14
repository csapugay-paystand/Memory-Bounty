import re
from typing import Any, Optional


def format_response(data: Any, status: int = 200) -> dict:
    """Wraps any data in a standardized API response envelope with status and ok flag."""
    return {
        "status": status,
        "data": data,
        "ok": status < 400,
    }


def validate_email(email: str) -> bool:
    """Validates an email address string against a basic RFC-5322-style regex pattern."""
    pattern = r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$"
    return bool(re.match(pattern, email))


def parse_pagination(params: dict) -> tuple:
    """Parses page and limit query parameters from a dict, applying safe defaults and upper bounds."""
    page = max(1, int(params.get("page", 1)))
    limit = min(100, max(1, int(params.get("limit", 20))))
    return page, limit


class CacheManager:
    """In-memory key-value cache for storing hot path data without external dependencies."""

    def __init__(self):
        self._store: dict = {}

    def get(self, key: str) -> Optional[Any]:
        """Returns the cached value for the given key, or None if the key does not exist."""
        return self._store.get(key)

    def set(self, key: str, value: Any) -> None:
        """Stores a value in the cache under the given key, overwriting any existing entry."""
        self._store[key] = value

    def invalidate(self, key: str) -> bool:
        """Removes a key from the cache. Returns True if the key existed, False otherwise."""
        if key in self._store:
            del self._store[key]
            return True
        return False
