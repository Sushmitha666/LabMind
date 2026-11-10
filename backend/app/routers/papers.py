import os

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.lab import Chunk, Paper
from app.models.user import User
from app.routers.auth import get_current_user
from app.schemas.lab import AskIn, AskOut, PaperOut, Source
from app.services import (
    chunk_text,
    embed_texts,
    extract_text,
    extractive_answer,
    generate_answer,
    retrieve,
)

router = APIRouter(tags=["papers"])
MAX_BYTES = 25 * 1024 * 1024


def _paper_out(paper: Paper, n_chunks: int) -> PaperOut:
    return PaperOut(
        id=paper.id, title=paper.title, filename=paper.filename, chunks=n_chunks, created_at=paper.created_at
    )


@router.get("/papers", response_model=list[PaperOut])
def list_papers(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(Paper, func.count(Chunk.id))
        .outerjoin(Chunk, Chunk.paper_id == Paper.id)
        .filter(Paper.user_id == user.id)
        .group_by(Paper.id)
        .order_by(Paper.created_at.desc())
        .all()
    )
    return [_paper_out(p, n) for p, n in rows]


@router.post("/papers", response_model=PaperOut, status_code=201)
def upload_paper(
    file: UploadFile = File(...), user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    data = file.file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 25 MB)")
    filename = file.filename or "paper"
    try:
        text, meta_title = extract_text(filename, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read this file")

    chunks = chunk_text(text)
    if not chunks:
        raise HTTPException(status_code=400, detail="No readable text found (is it a scanned PDF?)")

    try:
        vectors = embed_texts(chunks)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Embedding model unavailable: {e}")

    paper = Paper(user_id=user.id, title=(meta_title or os.path.splitext(filename)[0])[:300], filename=filename[:300])
    db.add(paper)
    db.flush()
    db.add_all(
        Chunk(paper_id=paper.id, user_id=user.id, idx=i, text=c, embedding=v)
        for i, (c, v) in enumerate(zip(chunks, vectors))
    )
    db.commit()
    db.refresh(paper)
    return _paper_out(paper, len(chunks))


@router.delete("/papers/{paper_id}", status_code=204)
def delete_paper(paper_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    paper = db.get(Paper, paper_id)
    if not paper or paper.user_id != user.id:
        raise HTTPException(status_code=404, detail="Paper not found")
    db.query(Chunk).filter(Chunk.paper_id == paper.id).delete(synchronize_session=False)
    db.delete(paper)
    db.commit()
    return Response(status_code=204)


@router.post("/rag/ask", response_model=AskOut)
def ask(data: AskIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        contexts = retrieve(db, user.id, data.question, data.include_runs)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Search failed: {e}")
    if not contexts:
        return AskOut(answer="There's nothing to search yet. Upload a paper or create a run first.", sources=[])

    answer = generate_answer(data.question, contexts)
    if not answer:
        answer = extractive_answer(contexts, llm_configured=bool(os.getenv("LLM_API_KEY")))
    return AskOut(
        answer=answer,
        sources=[Source(type=c["type"], title=c["title"], snippet=c["text"][:300]) for c in contexts],
    )