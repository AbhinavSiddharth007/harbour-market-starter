// The only file the HTML loads. It wires events to state and starts the page.
import { state, toggleSaved } from "./state.js";
import { save, load } from "./storage.js";
import { render } from "./render.js";
import { setupMenu } from "./menu.js";
import { setupTickets } from "./tickets.js";
import { getJSON } from "./api.js";

const filters = document.querySelector(".filters");
const list = document.querySelector(".vendor-list");

// Every change goes through here: draw, then remember
function update() {
  render();
  save();
}

filters.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  state.tag = button.dataset.filter;
  update();
});

document.querySelector("#vendor-search").addEventListener("input", (event) => {
  state.query = event.target.value;
  update();
});

// The cards are redrawn all the time: one listener on the list hears every ♡
list.addEventListener("click", (event) => {
  const button = event.target.closest(".save");
  if (!button) return;
  toggleSaved(button.closest(".stall").dataset.id);
  update();
});

// GET /stalls into state: loading → ready | error, drawing each step.
// One request at a time: a second click on Try again while loading does nothing.
let loading = null;
export function loadStalls() {
  if (loading) return loading;
  loading = (async () => {
    state.status = "loading";
    state.error = null;
    render();
    try {
      state.stalls = await getJSON("/stalls");
      state.status = "ready";
    } catch (error) {
      console.error("GET /stalls failed:", error);
      state.error = error;
      state.status = "error";
    } finally {
      loading = null;
      render();
    }
  })();
  return loading;
}

// Try again: focus the status line first, so screen readers hear "Loading…"
// and keyboard focus doesn't vanish when the button hides
document.querySelector(".retry").addEventListener("click", () => {
  document.querySelector(".status").focus();
  loadStalls();
});

setupMenu();
setupTickets();
load(); // the filter and the ♥ from localStorage, before the stalls arrive
await loadStalls();
