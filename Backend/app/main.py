from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.auth import router as auth_router
from app.api.watchlists import router as watchlists_router
from app.database import get_db

app = FastAPI(title="Smart Market Watchlist API")
app.include_router(auth_router)
app.include_router(watchlists_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/health/db")
def health_db(db: Session = Depends(get_db)) -> JSONResponse:
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(status_code=503, content={"status": "error", "database": "unreachable"})
    return JSONResponse(status_code=200, content={"status": "ok", "database": "connected"})
