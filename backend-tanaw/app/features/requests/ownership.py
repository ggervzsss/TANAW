"""Who in IT handles a request.

An open request that no one handles is "not picked up". IT picks one up with Start on it, or
by acting on it (replying, resolving, approving, declining or moving it). IT reopening a
request takes it on; an enterprise reopening one keeps whoever handled it.
"""

from datetime import UTC, datetime

from app.features.accounts.models import Account, AccountRole
from app.features.requests.models import Request
from app.features.requests.schemas import RequestHandler

OPEN_STATUSES = frozenset({"In Progress"})


def request_handler(request: Request) -> RequestHandler | None:
    if request.handled_by_account_id is None or request.handled_by_name is None:
        return None
    return RequestHandler(accountId=request.handled_by_account_id, name=request.handled_by_name)


def is_picked_up(request: Request) -> bool:
    """Closed requests count as picked up; an open one needs someone handling it."""
    return request.status not in OPEN_STATUSES or request_handler(request) is not None


def take_request(request: Request, actor: Account, now: datetime | None = None) -> None:
    """Make an IT person the request's owner."""
    if request.handled_by_account_id == actor.id:
        return
    request.handled_by_account_id = actor.id
    request.handled_by_name = actor.display_name
    request.handled_at = now or datetime.now(UTC)


def claim_if_not_picked_up(request: Request, actor: Account) -> None:
    """IT acting on an open request no one has picked up becomes its owner first."""
    if actor.role == AccountRole.IT and not is_picked_up(request):
        take_request(request, actor)
