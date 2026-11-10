"""Helpers for runs, paper parsing, embeddings and RAG answers."""
import io
import os

import httpx
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.models.lab import Chunk, Metric, Paper, Run

# ───────────── runs ─────────────


def latest_metrics(db: Session, run_ids: list[int]) -> dict[int, dict[str, float]]:
    """Last logged value of every metric, per run."""
    if not run_ids:
        return {}
    sub = (
        db.query(
            Metric.run_id.label("run_id"),
            Metric.name.label("name"),
            func.max(Metric.step).label("max_step"),
        )
        .filter(Metric.run_id.in_(run_ids))
        .group_by(Metric.run_id, Metric.name)
        .subquery()
    )
    rows = db.query(Metric).join(
        sub,
        and_(Metric.run_id == sub.c.run_id, Metric.name == sub.c.name, Metric.step == sub.c.max_step),
    )
    out: dict[int, dict[str, float]] = {}
    for m in rows:
        out.setdefault(m.run_id, {})[m.name] = m.value
    return out


def run_summary(run: Run, latest: dict[str, float]) -> str:
    params = ", ".join(f"{k}={v}" for k, v in (run.params or {}).items()) or "none"
    final = ", ".join(f"{k}={v:.4g}" for k, v in latest.items()) or "no metrics logged"
    notes = f" Notes: {run.notes}" if run.notes else ""
    return (
        f"Experiment run '{run.name}' (model: {run.model or 'unspecified'}, status: {run.status}). "
        f"Hyperparameters: {params}. Final metrics: {final}.{notes}"
    )


# ───────────── papers ─────────────


def extract_text(filename: str, data: bytes) -> tuple[str, str | None]:
    """Returns (text, title-from-file-metadata)."""
    name = filename.lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        text = "\n".join((p.extract_text() or "") for p in reader.pages)
        title = reader.metadata.title if reader.metadata and reader.metadata.title else None
    elif name.endswith((".txt", ".md")):
        text, title = data.decode("utf-8", errors="ignore"), None
    else:
        raise ValueError("Only PDF, TXT and MD files are supported")
    return text.replace("\x00", ""), title


def chunk_text(text: str, size: int = 180, overlap: int = 30) -> list[str]:
    words = text.split()
    if not words:
        return []
    step = size - overlap
    chunks = []
    for start in range(0, len(words), step):
        piece = words[start : start + size]
        if len(piece) < 20 and chunks:  # tiny tail: merge into previous chunk
            chunks[-1] += " " + " ".join(piece)
            break
        chunks.append(" ".join(piece))
        if start + size >= len(words):
            break
    return chunks


# ───────────── embeddings (local, no API key) ─────────────

_model = None


def _embedder():
    global _model
    if _model is None:
        from fastembed import TextEmbedding

        _model = TextEmbedding("BAAI/bge-small-en-v1.5")  # 384 dims, downloads once
    return _model


def embed_texts(texts: list[str]) -> list[list[float]]:
    return [v.tolist() for v in _embedder().embed(texts)]


def embed_query(text: str) -> list[float]:
    return next(iter(_embedder().query_embed(text))).tolist()


# ───────────── retrieval + answer ─────────────


def retrieve(db: Session, user_id: int, question: str, include_runs: bool = True, k: int = 6) -> list[dict]:
    qv = embed_query(question)
    cands: list[dict] = []

    dist = Chunk.embedding.cosine_distance(qv).label("dist")
    rows = (
        db.query(Chunk, Paper.title, dist)
        .join(Paper, Paper.id == Chunk.paper_id)
        .filter(Chunk.user_id == user_id)
        .order_by(dist)
        .limit(k)
        .all()
    )
    for chunk, title, d in rows:
        cands.append({"type": "paper", "title": title, "text": chunk.text, "score": 1 - float(d)})

    if include_runs:
        runs = db.query(Run).filter(Run.user_id == user_id).order_by(Run.created_at.desc()).limit(40).all()
        if runs:
            latest = latest_metrics(db, [r.id for r in runs])
            texts = [run_summary(r, latest.get(r.id, {})) for r in runs]
            for run, text, vec in zip(runs, texts, embed_texts(texts)):
                score = sum(a * b for a, b in zip(qv, vec))  # vectors are normalised
                cands.append({"type": "run", "title": run.name, "text": text, "score": score})

    cands.sort(key=lambda c: c["score"], reverse=True)
    return cands[:k]


def generate_answer(question: str, contexts: list[dict]) -> str | None:
    """Uses any OpenAI-compatible chat API if LLM_* env vars are set, else returns None."""
    key, base, model = os.getenv("LLM_API_KEY"), os.getenv("LLM_BASE_URL"), os.getenv("LLM_MODEL")
    if not (key and base and model):
        return None
    ctx = "\n\n".join(f"[{i + 1}] ({c['type']}: {c['title']})\n{c['text']}" for i, c in enumerate(contexts))
    messages = [
        {
            "role": "system",
            "content": (
                "You are LabMind, an assistant for ML researchers. Answer using ONLY the numbered context. "
                "Cite sources like [1] or [2]. If the context does not contain the answer, say so."
            ),
        },
        {"role": "user", "content": f"Context:\n{ctx}\n\nQuestion: {question}"},
    ]
    try:
        r = httpx.post(
            base.rstrip("/") + "/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": model, "messages": messages, "temperature": 0.2},
            timeout=60,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]
    except Exception:
        return None


def extractive_answer(contexts: list[dict], llm_configured: bool) -> str:
    head = (
        "The language model was unavailable, so here are the most relevant passages I found:"
        if llm_configured
        else "No language model is configured, so here are the most relevant passages I found:"
    )
    lines = [f"• {c['title']}: {c['text'][:280].strip()}…" for c in contexts[:3]]
    return head + "\n\n" + "\n\n".join(lines)