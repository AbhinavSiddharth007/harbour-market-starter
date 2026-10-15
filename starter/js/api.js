// Every request to the Harbour Market API goes through this module.
// The rest of the app imports these functions and never calls fetch() itself.

// Your own market on the course server (GitHub username, lower case).
// The control page: https://harbour-api.lopin.me
export const API = "https://harbour-api.lopin.me/abhinavsiddharth007/api";

// An Error for a 4xx/5xx response, carrying the status and the parsed error
// body, so callers can tell a 404 from a 422 and read body.fields.
export class HttpError extends Error {
  constructor(response, body) {
    const detail = body && typeof body.message === "string" ? `: ${body.message}` : "";
    super(`HTTP ${response.status}${detail}`);
    this.name = "HttpError";
    this.status = response.status;
    this.body = body;
    this.headers = response.headers;
  }
}

// One request, JSON in and out. `path` is relative to API: request("GET", "/stalls").
// Resolves with the parsed body (null for a 204); rejects with an HttpError
// for 4xx/5xx, and lets network errors (TypeError) and aborts through.
export async function request(method, path, data, options = {}) {
  const { headers = {}, ...rest } = options;
  const init = { method, ...rest, headers: { Accept: "application/json", ...headers } };
  if (data !== undefined) {
    init.body = JSON.stringify(data);
    init.headers["Content-Type"] = "application/json";
  }

  const response = await fetch(API + path, init);

  if (!response.ok) {
    let body = null;
    try {
      body = await response.json();
    } catch {
      // not JSON (a proxy's HTML page, an empty body): keep null
    }
    throw new HttpError(response, body);
  }

  if (response.status === 204) return null;
  return response.json();
}

export const getJSON = (path, options) => request("GET", path, undefined, options);
export const postJSON = (path, data, options) => request("POST", path, data, options);
export const putJSON = (path, data, options) => request("PUT", path, data, options);
export const deleteJSON = (path, options) => request("DELETE", path, undefined, options);

// A short sentence for people; the error itself goes to the console.
export function describe(error) {
  if (error?.name === "AbortError") return "The request was cancelled.";
  if (error instanceof HttpError) {
    const s = error.status;
    if (s === 404) return "The server couldn't find that (404).";
    if (s === 422) return "Some fields need fixing (422).";
    if (s === 401 || s === 403) return `You're not allowed to do that (${s}).`;
    if (s === 503) return "The server is busy right now (503). Try again in a moment.";
    if (s >= 500) return `The server had a problem (${s}). Nothing changed, so it's safe to try again.`;
    return `The server answered ${s}.`;
  }
  if (error instanceof TypeError) return "No connection: check your network and try again.";
  return "Something went wrong.";
}
