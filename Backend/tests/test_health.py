from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_app_starts():
    assert app is not None


def test_health_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_db_returns_json():
    response = client.get("/health/db")
    assert response.status_code in (200, 503)
    body = response.json()
    assert "status" in body
    assert "database" in body
