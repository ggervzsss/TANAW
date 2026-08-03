import ast
from pathlib import Path

BACKEND_ROOT = next(
    parent for parent in Path(__file__).resolve().parents if (parent / "pyproject.toml").exists()
)
FEATURE_ROOT = BACKEND_ROOT / "app" / "features"
MAX_FEATURE_MODULE_LINES = 700
DOMAIN_MODULES = (
    FEATURE_ROOT / "auth" / "policies.py",
    FEATURE_ROOT / "reporting" / "periods.py",
    FEATURE_ROOT / "reporting" / "policies.py",
)


def test_removed_operational_catch_all_is_not_reintroduced() -> None:
    assert not (FEATURE_ROOT / "operational").exists()


def test_feature_modules_remain_reviewable() -> None:
    oversized = {
        path.relative_to(BACKEND_ROOT).as_posix(): len(path.read_text().splitlines())
        for path in FEATURE_ROOT.rglob("*.py")
        if len(path.read_text().splitlines()) > MAX_FEATURE_MODULE_LINES
    }
    assert oversized == {}


def test_domain_policy_modules_do_not_import_frameworks() -> None:
    forbidden_roots = {"fastapi", "sqlalchemy"}
    violations: dict[str, list[str]] = {}
    for path in DOMAIN_MODULES:
        imported_roots: set[str] = set()
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.Import):
                imported_roots.update(alias.name.split(".", 1)[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported_roots.add(node.module.split(".", 1)[0])
        forbidden = sorted(imported_roots & forbidden_roots)
        if forbidden:
            violations[path.relative_to(BACKEND_ROOT).as_posix()] = forbidden
    assert violations == {}
