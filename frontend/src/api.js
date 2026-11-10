// Single place for backend access.
export const API = "http://localhost:8000";
export const WS_BASE = API.replace(/^http/, "ws");

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function request(path, { method = "GET", token, json, form, formData } = {}) {
  const headers = {};
  let body;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(form).toString();
  } else if (formData) {
    body = formData; // browser sets multipart boundary
  }

  let res;
  try {
    res = await fetch(API + path, { method, headers, body });
  } catch {
    throw new ApiError("Cannot reach the backend. Is `docker compose up` running?", 0);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    let msg = `Request failed (${res.status})`;
    if (data?.detail) {
      msg = Array.isArray(data.detail)
        ? data.detail.map((d) => `${(d.loc || []).slice(1).join(".")}: ${d.msg}`).join(" · ")
        : data.detail;
    }
    throw new ApiError(msg, res.status);
  }
  return data;
}

export const makeApi = (token) => ({
  get: (p) => request(p, { token }),
  post: (p, json) => request(p, { method: "POST", token, json }),
  patch: (p, json) => request(p, { method: "PATCH", token, json }),
  del: (p) => request(p, { method: "DELETE", token }),
  upload: (p, formData) => request(p, { method: "POST", token, formData }),
});
