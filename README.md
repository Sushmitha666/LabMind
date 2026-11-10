# LabMind

**Track your ML experiments. Ask questions about your papers and your own runs.**

LabMind is a full-stack experiment tracker with a built-in research assistant. Log hyperparameters and metrics from any training script, watch the loss and accuracy curves update live in the browser, compare runs side by side, and ask a RAG assistant questions over your uploaded papers and your run history.

---

## Features

- **Authentication**: register and log in with email and password (JWT).
- **Experiment tracking**: create runs with hyperparameters and notes, log metrics step by step, mark runs completed.
- **Live curves**: metrics stream to the browser over a WebSocket. If the socket is unavailable the page falls back to auto-refresh.
- **Run comparison**: overlay the curves of several runs and see which hyperparameters differ.
- **Paper library**: upload PDF, TXT or MD papers. They are chunked and embedded locally (no API key needed).
- **RAG assistant**: ask questions over your papers and your run history. Answers cite their sources. Works without any LLM key (returns the most relevant passages) and gives written answers when an LLM is configured.
- **Per-user data**: every run, metric and paper is scoped to the logged-in user.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, plain CSS, hand-written SVG charts (no UI/chart libraries) |
| Backend | FastAPI, SQLAlchemy 2, Pydantic v2, python-jose (JWT) |
| Database | PostgreSQL 16 with the pgvector extension |
| Realtime | WebSockets (FastAPI/Starlette) |
| Embeddings | `fastembed` with `BAAI/bge-small-en-v1.5` (384 dimensions, runs locally) |
| LLM (optional) | Any OpenAI-compatible chat API |
| Infra | Docker and Docker Compose (database and backend) |

## Architecture

```
Browser (React, :5173)
   │  REST  (JWT in Authorization header)
   │  WebSocket  /ws/runs/{id}
   ▼
FastAPI backend (Docker, :8000)
   ├── /auth      register, login, me
   ├── /runs      runs and metrics, live push
   └── /papers, /rag   upload, embed, search, answer
   ▼
PostgreSQL + pgvector (Docker, :5432)
   users · runs · metrics · papers · chunks (vector(384))
```

How RAG works: an uploaded paper is split into overlapping ~180-word chunks, each chunk is embedded and stored in pgvector. A question is embedded the same way, the closest chunks are found by cosine distance, and (optionally) your run summaries are ranked alongside them. The top passages go to the LLM as numbered context, and the answer cites them as `[1]`, `[2]`. With no LLM configured, the top passages are returned directly.

## Project structure

```
labmind/
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
├── app/
│   ├── main.py            app setup, CORS, routers, pgvector extension
│   ├── config.py          settings
│   ├── db.py              engine, session, Base
│   ├── security.py        password hashing, JWT creation
│   ├── realtime.py        WebSocket hub for live metrics
│   ├── services.py        run helpers, PDF parsing, chunking, embeddings, RAG
│   ├── models/
│   │   ├── user.py        User
│   │   └── lab.py         Run, Metric, Paper, Chunk
│   ├── schemas/
│   │   ├── user.py
│   │   └── lab.py
│   └── routers/
│       ├── auth.py
│       ├── runs.py
│       └── papers.py      papers and /rag/ask
└── labmind-frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx       entry point
        ├── App.jsx        auth screen, layout, hash router
        ├── pages.jsx      Overview, Experiments, Run detail, Compare, Ask & Papers
        ├── ui.jsx         line chart, badges, helpers
        ├── api.js         backend client
        └── styles.css
```

## Getting started

### Requirements

- Docker Desktop (on Windows it needs WSL 2: run `wsl --install` in an admin PowerShell, then restart)
- Node.js 18 or newer

### 1. Start the backend and database

From the project root:

```bash
docker compose up --build
```

Wait for `Application startup complete`. Then open the API docs at <http://localhost:8000/docs>.

The first paper upload or question is slow (1 to 2 minutes) because the embedding model is downloaded once.

### 2. Start the frontend

In a second terminal:

```bash
cd labmind-frontend
npm install
npm run dev
```

Open <http://localhost:5173>, register an account and you are in.

### Stopping

```bash
docker compose down        # stop, keep the database
docker compose down -v     # stop and wipe the database
```

## Configuration

The app works with no configuration. To get written answers from the assistant, set these environment variables on the `backend` service in `docker-compose.yml`:

```yaml
environment:
  - LLM_API_KEY=your_key
  - LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
  - LLM_MODEL=<model name from your provider>
```

Any OpenAI-compatible provider works with the same three variables. Without them, `/rag/ask` returns the most relevant passages instead of a generated answer.

Other settings (`secret_key`, `algorithm`, `database_url`) live in `app/config.py`. Change `secret_key` before deploying anywhere public.

## Logging metrics from your own training code

Any script can log to LabMind over HTTP. The browser updates live while it runs.

```python
import requests

API = "http://localhost:8000"
token = requests.post(
    f"{API}/auth/login",
    data={"username": "you@example.com", "password": "your-password"},
).json()["access_token"]
H = {"Authorization": f"Bearer {token}"}

run = requests.post(f"{API}/runs", headers=H, json={
    "name": "resnet-baseline",
    "model": "ResNet18",
    "params": {"lr": 0.001, "batch_size": 32},
    "notes": "first baseline",
}).json()

for epoch in range(20):
    loss, acc = train_one_epoch()          # your code
    requests.post(f"{API}/runs/{run['id']}/metrics", headers=H, json={
        "step": epoch,
        "values": {"loss": loss, "accuracy": acc},
    })

requests.patch(f"{API}/runs/{run['id']}", headers=H, json={"status": "completed"})
```

The frontend shows `loss` and `accuracy` in the run tables. Any other metric names you log get their own chart.

## API reference

All endpoints except `/auth/register`, `/auth/login` and `/health` need `Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Create an account (`email`, `password`) |
| POST | `/auth/login` | Form login (`username`, `password`), returns `access_token` |
| GET | `/auth/me` | Current user |
| GET | `/health` | Health check |
| GET | `/runs` | List your runs, each with its latest metric values |
| POST | `/runs` | Create a run (`name`, `model`, `params`, `notes`) |
| GET | `/runs/{id}` | One run |
| PATCH | `/runs/{id}` | Update `name`, `status` (`running`, `completed`, `failed`) or `notes` |
| DELETE | `/runs/{id}` | Delete a run and its metrics |
| GET | `/runs/{id}/metrics` | All metrics, grouped by name |
| POST | `/runs/{id}/metrics` | Log one step: `{"step": 1, "values": {"loss": 0.5}}` |
| WS | `/ws/runs/{id}?token=...` | Live stream of new metric points and status changes |
| GET | `/papers` | List your papers with chunk counts |
| POST | `/papers` | Upload a paper (multipart field `file`, PDF/TXT/MD, max 25 MB) |
| DELETE | `/papers/{id}` | Remove a paper and its chunks |
| POST | `/rag/ask` | `{"question": "...", "include_runs": true}`, returns `answer` and `sources` |

## Data model

- **users**: id, email, hashed_password
- **runs**: id, user_id, name, model, status, params (JSON), notes, created_at
- **metrics**: id, run_id, name, step, value (indexed on run, name, step)
- **papers**: id, user_id, title, filename, created_at
- **chunks**: id, paper_id, user_id, idx, text, embedding `vector(384)`

## Troubleshooting

| Problem | Fix |
|---|---|
| Docker Desktop says "WSL not installed" | Run `wsl --install` in an admin PowerShell, restart the PC |
| Frontend shows "Request failed (404)" on register | Make sure the frontend calls `http://localhost:8000` and the backend has the CORS middleware for `http://localhost:5173` |
| Frontend shows a CORS error | Open the app at `localhost:5173`, not `127.0.0.1:5173` |
| `ModuleNotFoundError` in backend logs | A package is missing from `requirements.txt`. Add it, save, then `docker compose build --no-cache backend` and `docker compose up` |
| `docker compose up --build` finishes in seconds with every step `CACHED` | Docker saw no changes. Check that your file edits are saved and inside the project folder |
| WebSocket status shows "auto-refresh" | The socket couldn't connect. Check that `websockets` is in `requirements.txt`. Curves still update by polling |
| First paper upload hangs for a while | The embedding model (a few hundred MB) is downloading. Wait for it to finish |
| PDF upload says "No readable text" | The PDF is a scan (images only). Use a text-based PDF or OCR it first |

## Roadmap

- Automated tests for the API (pytest) and a GitHub Actions pipeline
- Ablation and evaluation tooling for the RAG assistant (retrieval quality, answer faithfulness)
- Persist the embedding model cache in a Docker volume
- Run notes editing and tagging in the UI
- Production deployment (HTTPS, restricted CORS, environment-based secrets)

## License

MIT (add a `LICENSE` file before publishing).
