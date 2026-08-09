from unittest.mock import AsyncMock

import pytest

import app.db.session as session_module


class SessionContext:
    def __init__(self, session: AsyncMock) -> None:
        self.session = session

    async def __aenter__(self) -> AsyncMock:
        return self.session

    async def __aexit__(self, *_: object) -> None:
        return None


@pytest.mark.asyncio
async def test_request_session_commits_after_success(monkeypatch: pytest.MonkeyPatch) -> None:
    session = AsyncMock()
    monkeypatch.setattr(session_module, "AsyncSessionLocal", lambda: SessionContext(session))

    dependency = session_module.get_db()

    assert await anext(dependency) is session
    with pytest.raises(StopAsyncIteration):
        await anext(dependency)

    session.commit.assert_awaited_once()
    session.rollback.assert_not_awaited()


@pytest.mark.asyncio
async def test_request_session_rolls_back_after_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    session = AsyncMock()
    monkeypatch.setattr(session_module, "AsyncSessionLocal", lambda: SessionContext(session))

    dependency = session_module.get_db()
    assert await anext(dependency) is session

    with pytest.raises(RuntimeError, match="request failed"):
        await dependency.athrow(RuntimeError("request failed"))

    session.rollback.assert_awaited_once()
    session.commit.assert_not_awaited()
