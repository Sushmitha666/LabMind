import React, { useEffect, useRef, useState } from "react";
import { WS_BASE } from "./api.js";
import { LineChart, StatusBadge, Spinner, ErrorNote, Empty, PALETTE, fmt, timeAgo } from "./ui.jsx";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const accOf = (run) => run?.latest?.accuracy ?? run?.latest?.acc ?? null;

function upsert(prev, step, values) {
  const next = { ...prev };
  for (const [k, v] of Object.entries(values)) {
    const arr = (next[k] || []).filter((p) => p.step !== step);
    arr.push({ step, value: v });
    arr.sort((a, b) => a.step - b.step);
    next[k] = arr;
  }
  return next;
}

function parseParams(text) {
  const out = {};
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((l) => {
      const i = l.indexOf("=");
      if (i < 1) return;
      const k = l.slice(0, i).trim();
      const raw = l.slice(i + 1).trim();
      out[k] = raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
    });
  return out;
}

/* ───────────────────────── Overview ───────────────────────── */

export function Overview({ api }) {
  const [runs, setRuns] = useState(null);
  const [papers, setPapers] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get("/runs").then(setRuns).catch((e) => { setErr(e); setRuns([]); });
    api.get("/papers").then(setPapers).catch(() => setPapers([]));
  }, []);

  if (runs === null) return <Spinner />;

  const running = runs.filter((r) => r.status === "running").length;
  const accs = runs.map(accOf).filter((a) => typeof a === "number");
  const best = accs.length ? Math.max(...accs) : null;

  return (
    <>
      <ErrorNote error={err} />
      <div className="stats">
        <div className="card stat"><span>Total runs</span><b>{runs.length}</b></div>
        <div className="card stat"><span>Running now</span><b>{running}</b></div>
        <div className="card stat"><span>Best accuracy</span><b>{best === null ? "–" : fmt(best)}</b></div>
        <div className="card stat"><span>Papers indexed</span><b>{papers ? papers.length : "–"}</b></div>
      </div>

      <div className="card">
        <div className="row-between">
          <h3>Recent runs</h3>
          <a className="link" href="#/runs">View all →</a>
        </div>
        {runs.length === 0 ? (
          <Empty title="No runs yet">Create your first experiment to start tracking metrics.</Empty>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th>Model</th><th>Status</th><th>Loss</th><th>Accuracy</th><th>Started</th></tr>
            </thead>
            <tbody>
              {runs.slice(0, 6).map((r) => (
                <tr key={r.id} onClick={() => (location.hash = `#/runs/${r.id}`)} className="click">
                  <td>{r.name}</td>
                  <td className="muted">{r.model || "–"}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{fmt(r.latest?.loss)}</td>
                  <td>{fmt(accOf(r))}</td>
                  <td className="muted">{timeAgo(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Ask your papers</h3>
        <p className="muted">Query your uploaded papers and run history in plain English.</p>
        <a className="link" href="#/papers">Open assistant →</a>
      </div>
    </>
  );
}

/* ───────────────────────── Experiments ───────────────────────── */

export function Experiments({ api }) {
  const [runs, setRuns] = useState(null);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", model: "", params: "lr=0.001\nbatch_size=32\nepochs=40", notes: "" });
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const load = () => api.get("/runs").then(setRuns).catch((e) => { setErr(e); setRuns([]); });
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const run = await api.post("/runs", {
        name: form.name,
        model: form.model,
        params: parseParams(form.params),
        notes: form.notes,
      });
      location.hash = `#/runs/${run.id}`;
    } catch (e2) {
      setErr(e2);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!confirm("Delete this run and its metrics?")) return;
    try {
      await api.del(`/runs/${id}`);
      setSel((s) => { const n = new Set(s); n.delete(id); return n; });
      load();
    } catch (e) {
      setErr(e);
    }
  }

  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (runs === null) return <Spinner />;
  const shown = runs.filter((r) => (r.name + " " + (r.model || "")).toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="row-between">
        <input className="search" placeholder="Search runs…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="actions">
          <button className="ghost" disabled={sel.size < 2} onClick={() => (location.hash = `#/compare?ids=${[...sel].join(",")}`)}>
            Compare{sel.size >= 2 ? ` (${sel.size})` : ""}
          </button>
          <button className="primary sm" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Close" : "+ New run"}
          </button>
        </div>
      </div>

      <ErrorNote error={err} />

      {showForm && (
        <form className="card form" onSubmit={create}>
          <h3>New experiment</h3>
          <div className="two">
            <div>
              <label>Run name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="resnet-baseline" />
            </div>
            <div>
              <label>Model</label>
              <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="ResNet18" />
            </div>
          </div>
          <label>Hyperparameters (one <code>key=value</code> per line)</label>
          <textarea rows={4} value={form.params} onChange={(e) => setForm({ ...form, params: e.target.value })} />
          <label>Notes</label>
          <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="What are you testing?" />
          <button className="primary" disabled={busy}>{busy ? "Creating…" : "Create run"}</button>
        </form>
      )}

      <div className="card">
        {shown.length === 0 ? (
          <Empty title="No runs found">Click “New run” to create one.</Empty>
        ) : (
          <table>
            <thead>
              <tr><th></th><th>Name</th><th>Model</th><th>Status</th><th>Loss</th><th>Accuracy</th><th>Started</th><th></th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td><a className="link" href={`#/runs/${r.id}`}>{r.name}</a></td>
                  <td className="muted">{r.model || "–"}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{fmt(r.latest?.loss)}</td>
                  <td>{fmt(accOf(r))}</td>
                  <td className="muted">{timeAgo(r.created_at)}</td>
                  <td><button className="icon" title="Delete" onClick={() => remove(r.id)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/* ───────────────────────── Run detail (live) ───────────────────────── */

export function RunDetail({ api, token, id }) {
  const [run, setRun] = useState(null);
  const [metrics, setMetrics] = useState({});
  const [err, setErr] = useState(null);
  const [live, setLive] = useState("connecting");
  const [simulating, setSimulating] = useState(false);
  const liveRef = useRef("connecting");
  const stopSim = useRef(false);
  const metricsRef = useRef({});
  metricsRef.current = metrics;

  const setLiveState = (v) => { liveRef.current = v; setLive(v); };
  const loadMetrics = () => api.get(`/runs/${id}/metrics`).then((m) => setMetrics(m || {})).catch(() => {});

  useEffect(() => {
    api.get(`/runs/${id}`).then(setRun).catch(setErr);
    loadMetrics();

    let ws;
    let closed = false;
    try {
      ws = new WebSocket(`${WS_BASE}/ws/runs/${id}?token=${encodeURIComponent(token)}`);
      ws.onopen = () => setLiveState("live");
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.values) setMetrics((p) => upsert(p, m.step, m.values));
          if (m.status) setRun((r) => (r ? { ...r, status: m.status } : r));
        } catch { /* ignore */ }
      };
      ws.onerror = () => !closed && setLiveState("polling");
      ws.onclose = () => !closed && setLiveState("polling");
    } catch {
      setLiveState("polling");
    }
    // Fallback: poll when the socket isn't live
    const poll = setInterval(() => { if (liveRef.current !== "live") loadMetrics(); }, 3000);

    return () => {
      closed = true;
      stopSim.current = true;
      clearInterval(poll);
      if (ws) ws.close();
    };
  }, [id]);

  async function simulate() {
    setSimulating(true);
    stopSim.current = false;
    const all = Object.values(metricsRef.current).flat();
    const start = all.length ? Math.max(...all.map((p) => p.step)) + 1 : 0;
    for (let i = 0; i < 40 && !stopSim.current; i++) {
      const step = start + i;
      const t = i / 40;
      const values = {
        loss: 2.2 * Math.exp(-3 * t) + 0.08 + Math.random() * 0.05,
        accuracy: Math.min(0.99, 0.95 - 0.7 * Math.exp(-3.5 * t) + (Math.random() - 0.5) * 0.02),
      };
      try {
        await api.post(`/runs/${id}/metrics`, { step, values });
        setMetrics((p) => upsert(p, step, values));
      } catch (e) {
        setErr(e);
        break;
      }
      await sleep(250);
    }
    setSimulating(false);
  }

  async function setStatus(status) {
    try {
      setRun(await api.patch(`/runs/${id}`, { status }));
    } catch (e) {
      setErr(e);
    }
  }

  async function remove() {
    if (!confirm("Delete this run?")) return;
    try {
      await api.del(`/runs/${id}`);
      location.hash = "#/runs";
    } catch (e) {
      setErr(e);
    }
  }

  if (!run && !err) return <Spinner />;
  if (!run) return <ErrorNote error={err} />;

  const names = Object.keys(metrics);
  return (
    <>
      <div className="row-between">
        <div className="title-row">
          <a className="link" href="#/runs">← Runs</a>
          <h2>{run.name}</h2>
          <StatusBadge status={run.status} />
          <span className={`live ${live}`}><i /> {live === "live" ? "live" : live === "polling" ? "auto-refresh" : "connecting"}</span>
        </div>
        <div className="actions">
          <button className="ghost" onClick={simulate} disabled={simulating}>{simulating ? "Simulating…" : "▶ Simulate training"}</button>
          {run.status !== "completed" && <button className="ghost" onClick={() => setStatus("completed")}>Mark completed</button>}
          <button className="ghost danger" onClick={remove}>Delete</button>
        </div>
      </div>

      <ErrorNote error={err} />

      <div className="grid">
        <div className="card">
          <h3>Hyperparameters</h3>
          {run.params && Object.keys(run.params).length ? (
            <dl>
              {Object.entries(run.params).map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>
              ))}
            </dl>
          ) : <p className="muted">None recorded.</p>}
        </div>
        <div className="card">
          <h3>Details</h3>
          <dl>
            <div><dt>Model</dt><dd>{run.model || "–"}</dd></div>
            <div><dt>Started</dt><dd>{run.created_at ? new Date(run.created_at).toLocaleString() : "–"}</dd></div>
          </dl>
          {run.notes && <p className="notes">{run.notes}</p>}
        </div>
      </div>

      {names.length === 0 ? (
        <div className="card">
          <Empty title="No metrics logged yet">
            Press “Simulate training” to see live curves, or log metrics from your training code with POST /runs/{run.id}/metrics.
          </Empty>
        </div>
      ) : (
        <div className="grid">
          {names.map((n, i) => (
            <div className="card" key={n}>
              <h3>{n}</h3>
              <LineChart series={[{ name: n, color: PALETTE[i % PALETTE.length], points: metrics[n].map((p) => ({ x: p.step, y: p.value })) }]} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ───────────────────────── Compare ───────────────────────── */

export function Compare({ api, ids }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    Promise.all(
      ids.map(async (id) => {
        const [run, metrics] = await Promise.all([api.get(`/runs/${id}`), api.get(`/runs/${id}/metrics`).catch(() => ({}))]);
        return { run, metrics: metrics || {} };
      })
    ).then(setData).catch(setErr);
  }, [ids.join(",")]);

  if (ids.length < 2) return <Empty title="Pick runs to compare">Select two or more runs on the Experiments page and press Compare.</Empty>;
  if (err) return <ErrorNote error={err} />;
  if (!data) return <Spinner />;

  const metricNames = [...new Set(data.flatMap((d) => Object.keys(d.metrics)))];
  const paramKeys = [...new Set(data.flatMap((d) => Object.keys(d.run.params || {})))];

  return (
    <>
      <div className="title-row"><a className="link" href="#/runs">← Runs</a><h2>Compare runs</h2></div>

      <div className="grid">
        {metricNames.map((n) => (
          <div className="card" key={n}>
            <h3>{n}</h3>
            <LineChart
              series={data
                .filter((d) => d.metrics[n])
                .map((d, i) => ({
                  name: d.run.name,
                  color: PALETTE[i % PALETTE.length],
                  points: d.metrics[n].map((p) => ({ x: p.step, y: p.value })),
                }))}
            />
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Hyperparameters</h3>
        <table>
          <thead>
            <tr><th></th>{data.map((d, i) => <th key={d.run.id}><i className="dot" style={{ background: PALETTE[i % PALETTE.length] }} /> {d.run.name}</th>)}</tr>
          </thead>
          <tbody>
            {paramKeys.map((k) => {
              const vals = data.map((d) => d.run.params?.[k]);
              const differs = new Set(vals.map(String)).size > 1;
              return (
                <tr key={k} className={differs ? "diff" : ""}>
                  <td className="muted">{k}</td>
                  {vals.map((v, i) => <td key={i}>{v === undefined ? "–" : String(v)}</td>)}
                </tr>
              );
            })}
            <tr><td className="muted">final loss</td>{data.map((d) => <td key={d.run.id}>{fmt(d.run.latest?.loss)}</td>)}</tr>
            <tr><td className="muted">final accuracy</td>{data.map((d) => <td key={d.run.id}>{fmt(accOf(d.run))}</td>)}</tr>
          </tbody>
        </table>
        <p className="muted small">Highlighted rows are hyperparameters that differ between runs.</p>
      </div>
    </>
  );
}

/* ───────────────────────── Papers + Ask (RAG) ───────────────────────── */

export function Papers({ api }) {
  const [papers, setPapers] = useState(null);
  const [err, setErr] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [useRuns, setUseRuns] = useState(true);
  const endRef = useRef(null);

  const load = () => api.get("/papers").then(setPapers).catch((e) => { setErr(e); setPapers([]); });
  useEffect(() => { load(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, asking]);

  async function upload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.upload("/papers", fd);
      await load();
    } catch (e2) {
      setErr(e2);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function removePaper(id) {
    if (!confirm("Remove this paper from the index?")) return;
    try {
      await api.del(`/papers/${id}`);
      load();
    } catch (e) {
      setErr(e);
    }
  }

  async function ask(e) {
    e.preventDefault();
    const question = q.trim();
    if (!question || asking) return;
    setQ("");
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setAsking(true);
    try {
      const res = await api.post("/rag/ask", { question, include_runs: useRuns });
      setMsgs((m) => [...m, { role: "ai", text: res.answer, sources: res.sources || [] }]);
    } catch (e2) {
      setMsgs((m) => [...m, { role: "ai", text: e2.status === 404 ? "The RAG endpoint isn't available in the backend yet." : e2.message, error: true }]);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="split">
      <div className="card library">
        <h3>Paper library</h3>
        <label className="upload">
          <input type="file" accept=".pdf,.txt,.md" onChange={upload} disabled={uploading} />
          {uploading ? "Indexing…" : "+ Upload paper (PDF / TXT)"}
        </label>
        <ErrorNote error={err} />
        {papers === null ? <Spinner /> : papers.length === 0 ? (
          <p className="muted">No papers yet. Upload one to start asking questions.</p>
        ) : (
          <ul className="papers">
            {papers.map((p) => (
              <li key={p.id}>
                <div>
                  <b>{p.title || p.filename}</b>
                  <span className="muted small">{p.chunks != null ? `${p.chunks} chunks` : p.filename}</span>
                </div>
                <button className="icon" title="Remove" onClick={() => removePaper(p.id)}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card chat">
        <div className="row-between">
          <h3>Ask LabMind</h3>
          <label className="check"><input type="checkbox" checked={useRuns} onChange={(e) => setUseRuns(e.target.checked)} /> include my runs</label>
        </div>

        <div className="messages">
          {msgs.length === 0 && (
            <div className="hint">
              <p className="muted">Try:</p>
              {["Summarise the main contribution of the uploaded papers", "Which of my runs had the lowest loss and what were its hyperparameters?", "What does the literature say about learning-rate warmup?"].map((s) => (
                <button key={s} className="suggest" onClick={() => setQ(s)}>{s}</button>
              ))}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`bubble ${m.role}${m.error ? " err" : ""}`}>
              <p>{m.text}</p>
              {m.sources?.length > 0 && (
                <div className="sources">
                  {m.sources.map((s, j) => (
                    <details key={j}>
                      <summary>{s.type === "run" ? "Run" : "Paper"}: {s.title}</summary>
                      <p className="muted small">{s.snippet}</p>
                    </details>
                  ))}
                </div>
              )}
            </div>
          ))}
          {asking && <div className="bubble ai"><p className="muted">Thinking…</p></div>}
          <div ref={endRef} />
        </div>

        <form className="ask" onSubmit={ask}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your papers or runs…" />
          <button className="primary sm" disabled={asking || !q.trim()}>Send</button>
        </form>
      </div>
    </div>
  );
}
