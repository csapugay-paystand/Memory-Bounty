"""
Edge-case fixture: Python class methods vs top-level functions.

Verifies that:
- Top-level functions are extracted as chunk_type "function"
- Methods inside a class body are extracted as chunk_type "method"
- The class itself is extracted as chunk_type "class"
- __init__ (dunder method) handling is implementation-defined; omit from assertions
"""


def standalone_helper(value: str) -> str:
    """Strips and lowercases a string; a reusable top-level text normalization utility."""
    return value.strip().lower()


class EventEmitter:
    """Lightweight pub/sub event bus for decoupled component communication."""

    def __init__(self):
        self._listeners: dict = {}

    def on(self, event: str, callback) -> None:
        """Registers a callback function to be called when the named event is emitted."""
        self._listeners.setdefault(event, []).append(callback)

    def emit(self, event: str, *args) -> None:
        """Fires all callbacks registered under the given event name, passing args to each."""
        for cb in self._listeners.get(event, []):
            cb(*args)

    def off(self, event: str) -> None:
        """Removes all registered listeners for the given event name."""
        self._listeners.pop(event, None)
