from fastapi import APIRouter, Depends, HTTPException, Query, Response, WebSocket, WebSocketDisconnect
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal, get_db
from app.models.lab import Metric, Run
from app.models.user import User
from app.realtime import hub
from app.routers.auth import get_current_user
from app.schemas.lab import MetricIn, RunCreate, RunOut, RunUpdate
from app.services import latest_metrics

router = APIRouter(tags=["runs"])


def _get_run(db: Session, user: User, run_id: int) -> Run:
    run = db.get(Run, run_id)
    if not run or run.user_id != user.id:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


def _out(run: Run, latest: dict[int, dict[str, float]]) -> RunOut:
    out = RunOut.model_validate(run)
    out.latest = latest.get(run.id, {})
    return out


@router.get("/runs", response_model=list[RunOut])
def list_runs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    runs = db.query(Run).filter(Run.user_id == user.id).order_by(Run.created_at.desc()).all()
    latest = latest_metrics(db, [r.id for r in runs])
    return [_out(r, latest) for r in runs]


@router.post("/runs", response_model=RunOut, status_code=201)
def create_run(data: RunCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = Run(user_id=user.id, name=data.name, model=data.model, params=data.params, notes=data.notes)
    db.add(run)
    db.commit()
    db.refresh(run)
    return _out(run, {})


@router.get("/runs/{run_id}", response_model=RunOut)
def get_run(run_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_run(db, user, run_id)
    return _out(run, latest_metrics(db, [run.id]))


@router.patch("/runs/{run_id}", response_model=RunOut)
async def update_run(
    run_id: int, data: RunUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    run = _get_run(db, user, run_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(run, field, value)
    db.commit()
    db.refresh(run)
    await hub.broadcast(run.id, {"status": run.status})
    return _out(run, latest_metrics(db, [run.id]))


@router.delete("/runs/{run_id}", status_code=204)
def delete_run(run_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_run(db, user, run_id)
    db.delete(run)
    db.commit()
    return Response(status_code=204)


@router.get("/runs/{run_id}/metrics")
def get_metrics(run_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    run = _get_run(db, user, run_id)
    rows = db.query(Metric).filter(Metric.run_id == run.id).order_by(Metric.name, Metric.step).all()
    out: dict[str, list[dict]] = {}
    for m in rows:
        out.setdefault(m.name, []).append({"step": m.step, "value": m.value})
    return out


@router.post("/runs/{run_id}/metrics", status_code=201)
async def log_metrics(
    run_id: int, data: MetricIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Training code calls this once per step: {"step": 3, "values": {"loss": 0.8, "accuracy": 0.7}}"""
    run = _get_run(db, user, run_id)
    db.query(Metric).filter(
        Metric.run_id == run.id, Metric.step == data.step, Metric.name.in_(list(data.values))
    ).delete(synchronize_session=False)
    for name, value in data.values.items():
        db.add(Metric(run_id=run.id, name=name, step=data.step, value=value))
    db.commit()
    await hub.broadcast(run.id, {"step": data.step, "values": data.values})
    return {"ok": True}


@router.websocket("/ws/runs/{run_id}")
async def run_socket(ws: WebSocket, run_id: int, token: str = Query(...)):
    """Browser connects here to receive new metric points live."""
    db = SessionLocal()
    try:
        try:
            payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
            user_id = int(payload["sub"])
        except (JWTError, KeyError, ValueError):
            await ws.close(code=4401)
            return
        run = db.get(Run, run_id)
        if not run or run.user_id != user_id:
            await ws.close(code=4404)
            return
    finally:
        db.close()

    await hub.connect(run_id, ws)
    try:
        while True:
            await ws.receive_text()  # keep the socket open until the browser leaves
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(run_id, ws)