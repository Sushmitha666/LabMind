from collections import defaultdict

from fastapi import WebSocket


class RunHub:
    """Keeps track of browsers watching a run and pushes new metrics to them."""

    def __init__(self) -> None:
        self.rooms: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, run_id: int, ws: WebSocket) -> None:
        await ws.accept()
        self.rooms[run_id].add(ws)

    def disconnect(self, run_id: int, ws: WebSocket) -> None:
        self.rooms[run_id].discard(ws)

    async def broadcast(self, run_id: int, message: dict) -> None:
        dead = []
        for ws in list(self.rooms.get(run_id, ())):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(run_id, ws)


hub = RunHub()