import React, { useState } from "react";

export const PALETTE = ["#5eead4", "#60a5fa", "#f59e0b", "#f472b6", "#a78bfa", "#34d399", "#fb7185"];

export const fmt = (v) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  if (typeof v !== "number") return String(v);
  if (v !== 0 && (Math.abs(v) >= 10000 || Math.abs(v) < 0.001)) return v.toExponential(1);
  return Number(v.toPrecision(3)).toString();
};

export const timeAgo = (iso) => {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

export function StatusBadge({ status }) {
  return <span className={`badge ${status || "running"}`}>{status || "running"}</span>;
}

export function Spinner({ text = "Loading…" }) {
  return <p className="muted">{text}</p>;
}

export function ErrorNote({ error }) {
  if (!error) return null;
  const missing = error.status === 404;
  return (
    <div className="error">
      {missing
        ? "This part of the backend isn't available yet (404). The page will work once the API is added."
        : error.message || String(error)}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <p className="muted">{children}</p>
    </div>
  );
}

// Dependency-free SVG line chart with hover tooltip.
// series: [{ name, color, points: [{ x, y }] }]
export function LineChart({ series, height = 220 }) {
  const [hover, setHover] = useState(null);
  const W = 640;
  const H = height;
  const m = { l: 50, r: 14, t: 12, b: 28 };

  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return <div className="chart-empty">No data yet</div>;

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  if (x0 === x1) x1 = x0 + 1;
  if (y0 === y1) {
    y0 -= 0.5;
    y1 += 0.5;
  }
  const pad = (y1 - y0) * 0.08;
  y0 -= pad;
  y1 += pad;

  const sx = (x) => m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r);
  const sy = (y) => H - m.b - ((y - y0) / (y1 - y0)) * (H - m.t - m.b);

  const yTicks = Array.from({ length: 5 }, (_, i) => y0 + ((y1 - y0) * i) / 4);
  const xTicks = Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * i) / 4);

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const dx = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
    let bestX = null;
    let bestD = Infinity;
    for (const p of pts) {
      const d = Math.abs(p.x - dx);
      if (d < bestD) {
        bestD = d;
        bestX = p.x;
      }
    }
    const items = series
      .map((s) => ({ name: s.name, color: s.color, p: s.points.find((p) => p.x === bestX) }))
      .filter((i) => i.p);
    setHover({ x: bestX, items });
  }

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} className="grid-line" />
            <text x={m.l - 8} y={sy(t) + 4} textAnchor="end" className="tick">
              {fmt(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={sx(t)} y={H - 8} textAnchor="middle" className="tick">
            {Math.round(t)}
          </text>
        ))}
        {series.map((s) => (
          <polyline
            key={s.name}
            fill="none"
            stroke={s.color}
            strokeWidth="2"
            strokeLinejoin="round"
            points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
          />
        ))}
        {hover && (
          <g>
            <line x1={sx(hover.x)} x2={sx(hover.x)} y1={m.t} y2={H - m.b} className="hover-line" />
            {hover.items.map((i) => (
              <circle key={i.name} cx={sx(i.p.x)} cy={sy(i.p.y)} r="4" fill={i.color} />
            ))}
          </g>
        )}
      </svg>

      {hover && (
        <div className="tooltip" style={{ left: `${(sx(hover.x) / W) * 100}%` }}>
          <div className="muted">step {hover.x}</div>
          {hover.items.map((i) => (
            <div key={i.name}>
              <i style={{ background: i.color }} /> {i.name}: <b>{fmt(i.p.y)}</b>
            </div>
          ))}
        </div>
      )}

      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} /> {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
