from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.db import Base, engine
from app import models  # noqa: registers user table
from app.models import lab  # noqa: registers runs / metrics / papers / chunks
from app.routers import auth, papers, runs

# pgvector extension must exist before the chunks table (vector column) is created
with engine.begin() as conn:
    conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
Base.metadata.create_all(bind=engine)

app = FastAPI(title="LabMind")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(runs.router)
app.include_router(papers.router)


@app.get("/health")
def health():
    return {"status": "ok"}