import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.database import get_db
from app.enums import ChangeEventSeverity, ChangeEventType
from app.models.change_event import ChangeEvent
from app.models.user import User
from app.schemas.change_events import ChangeEventListItem, ChangeEventListResponse
from app.services import change_events as change_events_service

router = APIRouter(prefix="/api/changes", tags=["changes"])

_UNAUTHENTICATED = {401: {"description": "Not authenticated"}}
_NOT_FOUND = {404: {"description": "Change event not found, or not owned by the current user"}}


def _to_list_item(event: ChangeEvent) -> ChangeEventListItem:
    return ChangeEventListItem(
        id=event.id,
        stock_id=event.stock_id,
        symbol=event.stock.symbol,
        watchlist_id=event.watchlist_id,
        type=event.type,
        severity=event.severity,
        title=event.title,
        description=event.description,
        old_value=event.old_value,
        new_value=event.new_value,
        detected_at=event.detected_at,
        acknowledged_at=event.acknowledged_at,
    )


@router.get("", response_model=ChangeEventListResponse, responses={**_UNAUTHENTICATED})
def list_changes(
    severity: ChangeEventSeverity | None = Query(default=None),
    type: ChangeEventType | None = Query(default=None),
    stock_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=change_events_service.MAX_LIMIT),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChangeEventListResponse:
    """The current user's own meaningful changes (Phase 9), newest first --
    never another user's. Reuses the existing ChangeEvent model and Phase 6A
    detection results; this endpoint only reads what has already been
    persisted, it never detects or creates a ChangeEvent itself."""
    events = change_events_service.list_change_events(
        db,
        user=current_user,
        severity=severity,
        type_=type,
        stock_id=stock_id,
        limit=limit,
    )
    items = [_to_list_item(event) for event in events]
    return ChangeEventListResponse(items=items, limit=limit, count=len(items))


@router.post(
    "/{change_id}/acknowledge",
    response_model=ChangeEventListItem,
    responses={**_UNAUTHENTICATED, **_NOT_FOUND},
)
def acknowledge_change(
    change_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChangeEventListItem:
    """Marks one change event as acknowledged (Step 12) -- a minimal "mark
    as read", never a signal fed back into detection (detected_at is
    untouched)."""
    try:
        event = change_events_service.acknowledge_change_event(db, user=current_user, event_id=change_id)
    except change_events_service.ChangeEventNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Change event not found")

    return _to_list_item(event)
