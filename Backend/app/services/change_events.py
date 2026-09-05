import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.enums import ChangeEventSeverity, ChangeEventType
from app.models.change_event import ChangeEvent
from app.models.user import User

MAX_LIMIT = 200


class ChangeEventNotFoundError(Exception):
    """Raised when a ChangeEvent doesn't exist, or doesn't belong to the
    requesting user -- both cases are treated identically so ownership
    never leaks via a different error."""


def list_change_events(
    db: Session,
    *,
    user: User,
    severity: ChangeEventSeverity | None = None,
    type_: ChangeEventType | None = None,
    stock_id: uuid.UUID | None = None,
    limit: int = 50,
) -> list[ChangeEvent]:
    """Returns this user's own ChangeEvents, newest first. Always scoped to
    `user.id` -- there is no code path here that can return another user's
    events. `stock` is eager-loaded (a single JOIN) so the API layer can
    read `event.stock.symbol` for every row without N+1 queries."""
    stmt = (
        select(ChangeEvent)
        .options(joinedload(ChangeEvent.stock))
        .where(ChangeEvent.user_id == user.id)
        .order_by(ChangeEvent.detected_at.desc())
        .limit(min(limit, MAX_LIMIT))
    )
    if severity is not None:
        stmt = stmt.where(ChangeEvent.severity == severity)
    if type_ is not None:
        stmt = stmt.where(ChangeEvent.type == type_)
    if stock_id is not None:
        stmt = stmt.where(ChangeEvent.stock_id == stock_id)

    return list(db.execute(stmt).scalars().all())


def acknowledge_change_event(db: Session, *, user: User, event_id: uuid.UUID) -> ChangeEvent:
    """Marks one of the user's own ChangeEvents as acknowledged. Idempotent:
    acknowledging an already-acknowledged event just returns it unchanged,
    it never overwrites the original acknowledged_at timestamp. This never
    touches detection -- acknowledged_at is purely "has the user seen this
    in the Changes list", not a signal fed back into change_engine."""
    event = db.execute(
        select(ChangeEvent)
        .options(joinedload(ChangeEvent.stock))
        .where(ChangeEvent.id == event_id, ChangeEvent.user_id == user.id)
    ).scalar_one_or_none()
    if event is None:
        raise ChangeEventNotFoundError()

    if event.acknowledged_at is None:
        event.acknowledged_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(event)

    return event
