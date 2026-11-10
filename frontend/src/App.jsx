import React, { useEffect, useMemo, useState } from "react";
import { request, makeApi, setUnauthorizedHandler } from "./api.js";
import { Overview, Experiments, RunDetail, Compare, Papers } from "./pages.jsx";

/* ───────────── Auth ───────────── */

function AuthCard({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "register") {
        await request("/auth/register", { method: "POST", json: { email, password } });
      }
      // FastAPI OAuth2 form login: the field is called "username"
      const tok = await request("/auth/login", { method: "POST", form: { username: email, password } });
      onAuth(tok.access_token);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="card auth" onSubmit={submit}>
        <div className="brand"><span className="logo">◆</span> LabMind</div>
        <p className="muted">Track experiments. Ask your papers.</p>

        <div className="tabs">
          <button type="button" className={mode === "login" ? "tab on" : "tab"} onClick={() => setMode("login")}>Log in</button>
          <button type="button" className={mode === "register" ? "tab on" : "tab"} onClick={() => setMode("register")}>Register</button>
        </div>

        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />

        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>
          {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>
    </div>
  );
}

/* ───────────── Hash router ───────────── */

function useHash() {
  const [h, setH] = useState(window.location.hash || "#/");
  useEffect(() => {
    const f = () => setH(window.location.hash || "#/");
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return h;
}

/* ───────────── Shell ───────────── */

const NAV = [
  { key: "", label: "Overview", href: "#/" },
  { key: "runs", label: "Experiments", href: "#/runs" },
  { key: "papers", label: "Ask & Papers", href: "#/papers" },
];

function Shell({ token, onLogout }) {
  const api = useMemo(() => makeApi(token), [token]);
  const [me, setMe] = useState(null);
  const [health, setHealth] = useState("checking");
  const hash = useHash();

  useEffect(() => {
    api.get("/auth/me").then(setMe).catch(() => {});
    const ping = () => request("/health").then(() => setHealth("ok")).catch(() => setHealth("down"));
    ping();
    const t = setInterval(ping, 15000);
    return () => clearInterval(t);
  }, [api]);

  const [path, query = ""] = hash.slice(1).split("?");
  const seg = path.split("/").filter(Boolean);
  const section = seg[0] || "";

  let page;
  let title = "Overview";
  if (section === "runs" && seg[1]) {
    page = <RunDetail key={seg[1]} api={api} token={token} id={seg[1]} />;
    title = "Run";
  } else if (section === "runs") {
    page = <Experiments api={api} />;
    title = "Experiments";
  } else if (section === "compare") {
    const ids = (new URLSearchParams(query).get("ids") || "").split(",").filter(Boolean);
    page = <Compare api={api} ids={ids} />;
    title = "Compare";
  } else if (section === "papers") {
    page = <Papers api={api} />;
    title = "Ask & Papers";
  } else {
    page = <Overview api={api} />;
  }

  const activeKey = section === "compare" ? "runs" : section;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="logo">◆</span> LabMind</div>
        <nav>
          {NAV.map((n) => (
            <a key={n.key} href={n.href} className={`nav${activeKey === n.key ? " on" : ""}`}>{n.label}</a>
          ))}
        </nav>
        <div className="me">
          {me && <span className="muted small">{me.email}</span>}
          <button className="ghost" onClick={onLogout}>Log out</button>
        </div>
      </aside>

      <main className="main">
        <header>
          <h1>{title}</h1>
          <span className={`pill ${health}`}>
            <i /> API {health === "ok" ? "online" : health === "down" ? "offline" : "checking"}
          </span>
        </header>
        {page}
      </main>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("lm_token"));

  const logout = () => {
    localStorage.removeItem("lm_token");
    setToken(null);
  };
  useEffect(() => setUnauthorizedHandler(logout), []);

  const login = (t) => {
    localStorage.setItem("lm_token", t);
    setToken(t);
  };

  return token ? <Shell token={token} onLogout={logout} /> : <AuthCard onAuth={login} />;
}
