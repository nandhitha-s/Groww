from sqlalchemy import select

from app.models.stock import Stock
from app.models.watchlist import Watchlist
from app.models.watchlist_item import WatchlistItem

WATCHLISTS_URL = "/api/watchlists"


def _register(client, email="alice@example.com", name="Alice", password="correct-horse-battery"):
    response = client.post(
        "/api/auth/register", json={"name": name, "email": email, "password": password}
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_watchlist(client, name="Technology"):
    return client.post(WATCHLISTS_URL, json={"name": name})


def _add_stock(client, watchlist_id, symbol="NVDA"):
    return client.post(f"{WATCHLISTS_URL}/{watchlist_id}/stocks", json={"symbol": symbol})


# 1. Create watchlist
def test_create_watchlist(client):
    _register(client)
    response = _create_watchlist(client, name="Technology")
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Technology"
    assert body["stock_count"] == 0
    assert "id" in body
    assert "created_at" in body and "updated_at" in body


def test_create_watchlist_trims_whitespace(client):
    _register(client)
    response = _create_watchlist(client, name="  Technology  ")
    assert response.status_code == 201
    assert response.json()["name"] == "Technology"


def test_create_watchlist_rejects_empty_name(client):
    _register(client)
    response = _create_watchlist(client, name="   ")
    assert response.status_code == 422


# 2. List watchlists
def test_list_watchlists_returns_only_own(client, client2):
    _register(client, email="alice@example.com")
    _register(client2, email="bob@example.com")

    _create_watchlist(client, name="Tech")
    _create_watchlist(client2, name="Bob's list")

    response = client.get(WATCHLISTS_URL)
    assert response.status_code == 200
    names = [w["name"] for w in response.json()]
    assert names == ["Tech"]


def test_list_watchlists_includes_stock_count(client):
    _register(client)
    created = _create_watchlist(client, name="Tech").json()
    _add_stock(client, created["id"], "NVDA")
    _add_stock(client, created["id"], "AAPL")

    response = client.get(WATCHLISTS_URL)
    assert response.status_code == 200
    body = response.json()
    assert body[0]["stock_count"] == 2


# 3. Get watchlist
def test_get_watchlist_returns_ordered_stocks(client):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    _add_stock(client, watchlist_id, "NVDA")
    _add_stock(client, watchlist_id, "AAPL")
    _add_stock(client, watchlist_id, "MSFT")

    response = client.get(f"{WATCHLISTS_URL}/{watchlist_id}")
    assert response.status_code == 200
    body = response.json()
    symbols = [s["symbol"] for s in body["stocks"]]
    assert symbols == ["NVDA", "AAPL", "MSFT"]
    positions = [s["position"] for s in body["stocks"]]
    assert positions == [0, 1, 2]
    # No fabricated market data: metadata stays null for placeholder stocks.
    assert body["stocks"][0]["company_name"] is None
    assert body["stocks"][0]["exchange"] is None


def test_get_watchlist_not_found_returns_404(client):
    _register(client)
    response = client.get(f"{WATCHLISTS_URL}/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404


# 4. Rename watchlist
def test_rename_watchlist(client):
    _register(client)
    watchlist_id = _create_watchlist(client, name="Tech").json()["id"]

    response = client.patch(f"{WATCHLISTS_URL}/{watchlist_id}", json={"name": "US Technology"})
    assert response.status_code == 200
    assert response.json()["name"] == "US Technology"

    fetched = client.get(f"{WATCHLISTS_URL}/{watchlist_id}").json()
    assert fetched["name"] == "US Technology"


# 5. Delete watchlist
def test_delete_watchlist(client):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]

    response = client.delete(f"{WATCHLISTS_URL}/{watchlist_id}")
    assert response.status_code == 204

    assert client.get(f"{WATCHLISTS_URL}/{watchlist_id}").status_code == 404


# 6. Duplicate watchlist name
def test_duplicate_watchlist_name_rejected_on_create(client):
    _register(client)
    _create_watchlist(client, name="Tech")
    response = _create_watchlist(client, name="Tech")
    assert response.status_code == 409


def test_duplicate_watchlist_name_rejected_on_rename(client):
    _register(client)
    _create_watchlist(client, name="Tech")
    other_id = _create_watchlist(client, name="Other").json()["id"]

    response = client.patch(f"{WATCHLISTS_URL}/{other_id}", json={"name": "Tech"})
    assert response.status_code == 409


def test_different_users_can_reuse_same_watchlist_name(client, client2):
    _register(client, email="alice@example.com")
    _register(client2, email="bob@example.com")

    assert _create_watchlist(client, name="Tech").status_code == 201
    assert _create_watchlist(client2, name="Tech").status_code == 201


# 7. Add stock
def test_add_stock(client):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]

    response = _add_stock(client, watchlist_id, "nvda")
    assert response.status_code == 201
    body = response.json()
    assert body["symbol"] == "NVDA"  # normalized to uppercase
    assert body["position"] == 0


def test_add_stock_watchlist_not_found(client):
    _register(client)
    response = _add_stock(client, "00000000-0000-0000-0000-000000000000", "NVDA")
    assert response.status_code == 404


def test_add_stock_invalid_symbol_rejected(client):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    response = _add_stock(client, watchlist_id, "not a symbol!")
    assert response.status_code == 422


def test_add_stock_reuses_existing_stock_record(client, db_session):
    _register(client)
    w1 = _create_watchlist(client, name="A").json()["id"]
    w2 = _create_watchlist(client, name="B").json()["id"]

    _add_stock(client, w1, "NVDA")
    _add_stock(client, w2, "NVDA")

    stocks = db_session.execute(select(Stock).where(Stock.symbol == "NVDA")).scalars().all()
    assert len(stocks) == 1


# 8. Add same stock twice
def test_add_same_stock_twice_rejected(client):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    _add_stock(client, watchlist_id, "NVDA")

    response = _add_stock(client, watchlist_id, "NVDA")
    assert response.status_code == 409


# 9. Remove stock
def test_remove_stock(client):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    _add_stock(client, watchlist_id, "NVDA")

    response = client.delete(f"{WATCHLISTS_URL}/{watchlist_id}/stocks/NVDA")
    assert response.status_code == 204

    fetched = client.get(f"{WATCHLISTS_URL}/{watchlist_id}").json()
    assert fetched["stocks"] == []


def test_remove_stock_normalizes_symbol_case(client):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    _add_stock(client, watchlist_id, "NVDA")

    response = client.delete(f"{WATCHLISTS_URL}/{watchlist_id}/stocks/nvda")
    assert response.status_code == 204


# 10. Remove nonexistent stock
def test_remove_nonexistent_stock_returns_404(client):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]

    response = client.delete(f"{WATCHLISTS_URL}/{watchlist_id}/stocks/NVDA")
    assert response.status_code == 404


# 11. Reorder stocks
def test_reorder_stocks(client):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    nvda = _add_stock(client, watchlist_id, "NVDA").json()
    aapl = _add_stock(client, watchlist_id, "AAPL").json()
    msft = _add_stock(client, watchlist_id, "MSFT").json()

    new_order = [msft["id"], nvda["id"], aapl["id"]]
    response = client.patch(
        f"{WATCHLISTS_URL}/{watchlist_id}/stocks/reorder", json={"stock_ids": new_order}
    )
    assert response.status_code == 200
    symbols = [s["symbol"] for s in response.json()["stocks"]]
    assert symbols == ["MSFT", "NVDA", "AAPL"]
    positions = [s["position"] for s in response.json()["stocks"]]
    assert positions == [0, 1, 2]


# 12. Invalid reorder payload
def test_reorder_missing_stock_rejected(client):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    nvda = _add_stock(client, watchlist_id, "NVDA").json()
    _add_stock(client, watchlist_id, "AAPL")

    response = client.patch(
        f"{WATCHLISTS_URL}/{watchlist_id}/stocks/reorder", json={"stock_ids": [nvda["id"]]}
    )
    assert response.status_code == 400


def test_reorder_foreign_stock_id_rejected(client):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    _add_stock(client, watchlist_id, "NVDA")

    response = client.patch(
        f"{WATCHLISTS_URL}/{watchlist_id}/stocks/reorder",
        json={"stock_ids": ["00000000-0000-0000-0000-000000000000"]},
    )
    assert response.status_code == 400


def test_reorder_duplicate_ids_rejected(client):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    nvda = _add_stock(client, watchlist_id, "NVDA").json()

    response = client.patch(
        f"{WATCHLISTS_URL}/{watchlist_id}/stocks/reorder",
        json={"stock_ids": [nvda["id"], nvda["id"]]},
    )
    assert response.status_code == 422  # rejected by schema validation


# 13. Empty watchlist
def test_empty_watchlist_has_no_stocks(client):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]

    response = client.get(f"{WATCHLISTS_URL}/{watchlist_id}")
    assert response.status_code == 200
    assert response.json()["stocks"] == []


def test_reorder_empty_watchlist_with_empty_payload(client):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]

    response = client.patch(
        f"{WATCHLISTS_URL}/{watchlist_id}/stocks/reorder", json={"stock_ids": []}
    )
    assert response.status_code == 200
    assert response.json()["stocks"] == []


# 14. Unauthenticated request
def test_unauthenticated_requests_rejected(client):
    assert client.get(WATCHLISTS_URL).status_code == 401
    assert _create_watchlist(client).status_code == 401


# 15. User A cannot access User B's watchlist
def test_user_cannot_get_other_users_watchlist(client, client2):
    _register(client, email="alice@example.com")
    _register(client2, email="bob@example.com")
    bob_watchlist_id = _create_watchlist(client2, name="Bob's list").json()["id"]

    response = client.get(f"{WATCHLISTS_URL}/{bob_watchlist_id}")
    assert response.status_code == 404


def test_user_cannot_list_other_users_watchlist(client, client2):
    _register(client, email="alice@example.com")
    _register(client2, email="bob@example.com")
    _create_watchlist(client2, name="Bob's list")

    response = client.get(WATCHLISTS_URL)
    assert response.json() == []


# 16. User A cannot modify User B's watchlist
def test_user_cannot_rename_other_users_watchlist(client, client2):
    _register(client, email="alice@example.com")
    _register(client2, email="bob@example.com")
    bob_watchlist_id = _create_watchlist(client2, name="Bob's list").json()["id"]

    response = client.patch(f"{WATCHLISTS_URL}/{bob_watchlist_id}", json={"name": "Hijacked"})
    assert response.status_code == 404

    unchanged = client2.get(f"{WATCHLISTS_URL}/{bob_watchlist_id}").json()
    assert unchanged["name"] == "Bob's list"


def test_user_cannot_add_stock_to_other_users_watchlist(client, client2):
    _register(client, email="alice@example.com")
    _register(client2, email="bob@example.com")
    bob_watchlist_id = _create_watchlist(client2, name="Bob's list").json()["id"]

    response = _add_stock(client, bob_watchlist_id, "NVDA")
    assert response.status_code == 404


def test_user_cannot_remove_stock_from_other_users_watchlist(client, client2):
    _register(client, email="alice@example.com")
    _register(client2, email="bob@example.com")
    bob_watchlist_id = _create_watchlist(client2, name="Bob's list").json()["id"]
    _add_stock(client2, bob_watchlist_id, "NVDA")

    response = client.delete(f"{WATCHLISTS_URL}/{bob_watchlist_id}/stocks/NVDA")
    assert response.status_code == 404

    unchanged = client2.get(f"{WATCHLISTS_URL}/{bob_watchlist_id}").json()
    assert len(unchanged["stocks"]) == 1


def test_user_cannot_reorder_other_users_watchlist(client, client2):
    _register(client, email="alice@example.com")
    _register(client2, email="bob@example.com")
    bob_watchlist_id = _create_watchlist(client2, name="Bob's list").json()["id"]
    nvda = _add_stock(client2, bob_watchlist_id, "NVDA").json()

    response = client.patch(
        f"{WATCHLISTS_URL}/{bob_watchlist_id}/stocks/reorder", json={"stock_ids": [nvda["id"]]}
    )
    assert response.status_code == 404


# 17. User A cannot delete User B's watchlist
def test_user_cannot_delete_other_users_watchlist(client, client2):
    _register(client, email="alice@example.com")
    _register(client2, email="bob@example.com")
    bob_watchlist_id = _create_watchlist(client2, name="Bob's list").json()["id"]

    response = client.delete(f"{WATCHLISTS_URL}/{bob_watchlist_id}")
    assert response.status_code == 404

    assert client2.get(f"{WATCHLISTS_URL}/{bob_watchlist_id}").status_code == 200


# 18. Stock is not deleted when removed from a watchlist
def test_stock_record_survives_removal_from_watchlist(client, db_session):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    _add_stock(client, watchlist_id, "NVDA")

    client.delete(f"{WATCHLISTS_URL}/{watchlist_id}/stocks/NVDA")

    stock = db_session.execute(select(Stock).where(Stock.symbol == "NVDA")).scalar_one_or_none()
    assert stock is not None


# 19. Stock is not deleted when a watchlist is deleted
def test_stock_record_survives_watchlist_deletion(client, db_session):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    _add_stock(client, watchlist_id, "NVDA")

    client.delete(f"{WATCHLISTS_URL}/{watchlist_id}")

    stock = db_session.execute(select(Stock).where(Stock.symbol == "NVDA")).scalar_one_or_none()
    assert stock is not None

    # And the WatchlistItem was cleaned up (not orphaned) -- Stock.symbol is
    # globally unique, so this scopes correctly even if other watchlists'
    # items exist elsewhere in the shared database.
    items = db_session.execute(
        select(WatchlistItem).where(WatchlistItem.stock_id == stock.id)
    ).scalars().all()
    assert items == []


def test_watchlist_deletion_does_not_error_with_no_stocks(client, db_session):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]

    response = client.delete(f"{WATCHLISTS_URL}/{watchlist_id}")
    assert response.status_code == 204

    watchlist = db_session.execute(
        select(Watchlist).where(Watchlist.id == watchlist_id)
    ).scalar_one_or_none()
    assert watchlist is None


# 20. Positions remain contiguous after deletion
def test_positions_compact_after_removal(client):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    _add_stock(client, watchlist_id, "NVDA")  # position 0
    _add_stock(client, watchlist_id, "AAPL")  # position 1
    _add_stock(client, watchlist_id, "MSFT")  # position 2

    client.delete(f"{WATCHLISTS_URL}/{watchlist_id}/stocks/AAPL")

    fetched = client.get(f"{WATCHLISTS_URL}/{watchlist_id}").json()
    remaining = [(s["symbol"], s["position"]) for s in fetched["stocks"]]
    assert remaining == [("NVDA", 0), ("MSFT", 1)]


def test_adding_after_removal_uses_next_free_position(client):
    _register(client)
    watchlist_id = _create_watchlist(client).json()["id"]
    _add_stock(client, watchlist_id, "NVDA")  # 0
    _add_stock(client, watchlist_id, "AAPL")  # 1
    client.delete(f"{WATCHLISTS_URL}/{watchlist_id}/stocks/AAPL")

    added = _add_stock(client, watchlist_id, "MSFT").json()
    assert added["position"] == 1


# 21. Multiple watchlists can contain the same stock
def test_multiple_watchlists_can_contain_same_stock(client):
    _register(client)
    w1 = _create_watchlist(client, name="A").json()["id"]
    w2 = _create_watchlist(client, name="B").json()["id"]

    assert _add_stock(client, w1, "NVDA").status_code == 201
    assert _add_stock(client, w2, "NVDA").status_code == 201

    assert len(client.get(f"{WATCHLISTS_URL}/{w1}").json()["stocks"]) == 1
    assert len(client.get(f"{WATCHLISTS_URL}/{w2}").json()["stocks"]) == 1
