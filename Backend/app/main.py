from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.auth import router as auth_router
from app.api.changes import router as changes_router
from app.api.market_data import router as market_data_router
from app.api.watchlists import router as watchlists_router
from app.database import get_db

app = FastAPI(title="Smart Market Watchlist API")

# The deployed frontend (Vercel) talks to this API through a same-origin
# rewrite proxy (see Frontend/vercel.json) -- from the browser's point of
# view every request stays on the vercel.app origin, so the HttpOnly session
# cookie's existing SameSite=lax setting keeps working unchanged, and this
# CORS config is only a fallback for calling the API directly (e.g. the
# deployed frontend origin during local testing, or hitting /docs).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://smartmarketapplication.vercel.app",
        "http://localhost:5173",
        "http://localhost:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(watchlists_router)
app.include_router(market_data_router)
app.include_router(changes_router)


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
