"""Helpers shared across ML-service test modules. Test modules never import each other.

Imported as `support` because tests/ is the import root here (pytest and mypy_path), and a
dependency installs an unrelated top-level `tests` package."""
