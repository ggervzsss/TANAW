import pytest
from starlette.types import Message, Receive, Scope, Send

from app.core.request_context import (
    EMPTY_REQUEST_CONTEXT,
    MAX_USER_AGENT_LENGTH,
    RequestContext,
    RequestContextMiddleware,
    build_request_context,
    current_request_context,
    session_identifier,
)

TOKEN = "header.payload.signature"


def test_the_context_holds_the_address_browser_and_a_session_hash() -> None:
    context = build_request_context(
        "203.0.113.7",
        [
            (b"user-agent", b"Mozilla/5.0  (Windows NT 10.0)"),
            (b"authorization", f"Bearer {TOKEN}".encode()),
        ],
    )

    assert context.ip_address == "203.0.113.7"
    assert context.user_agent == "Mozilla/5.0 (Windows NT 10.0)"
    assert context.session_id == session_identifier(TOKEN)
    assert context.session_id is not None
    assert len(context.session_id) == 16
    assert TOKEN not in context.session_id


def test_the_session_hash_never_reveals_the_token_and_tells_tokens_apart() -> None:
    assert session_identifier(None) is None
    assert session_identifier("") is None
    assert session_identifier(TOKEN) == session_identifier(TOKEN)
    assert session_identifier(TOKEN) != session_identifier(f"{TOKEN}x")


def test_missing_or_unusual_headers_leave_the_fields_empty() -> None:
    context = build_request_context(None, [(b"authorization", b"Basic dXNlcjpwYXNz")])

    assert context == RequestContext()


def test_a_long_browser_string_is_clipped() -> None:
    context = build_request_context("127.0.0.1", [(b"user-agent", b"x" * 1000)])

    assert context.user_agent is not None
    assert len(context.user_agent) == MAX_USER_AGENT_LENGTH


@pytest.mark.asyncio
async def test_the_middleware_sets_the_context_for_the_request_and_clears_it_after() -> None:
    seen: list[RequestContext] = []

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        seen.append(current_request_context())

    async def receive() -> Message:
        return {"type": "http.request"}

    async def send(message: Message) -> None:
        return None

    middleware = RequestContextMiddleware(app)
    await middleware(
        {
            "type": "http",
            "client": ("198.51.100.4", 50000),
            "headers": [(b"user-agent", b"TANAW Desktop"), (b"authorization", b"Bearer abc")],
        },
        receive,
        send,
    )

    assert seen == [
        RequestContext(
            ip_address="198.51.100.4",
            user_agent="TANAW Desktop",
            session_id=session_identifier("abc"),
        )
    ]
    assert current_request_context() == EMPTY_REQUEST_CONTEXT


@pytest.mark.asyncio
async def test_the_middleware_leaves_websockets_alone() -> None:
    seen: list[RequestContext] = []

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        seen.append(current_request_context())

    async def receive() -> Message:
        return {"type": "websocket.connect"}

    async def send(message: Message) -> None:
        return None

    await RequestContextMiddleware(app)(
        {"type": "websocket", "client": ("198.51.100.4", 50000), "headers": []}, receive, send
    )

    assert seen == [EMPTY_REQUEST_CONTEXT]
