// Brief 1 · Review wall (issue #1)
// A Reviews button on each card opens one <dialog>: the stall's reviews
// (GET), a form that POSTs one, and delete for the reviews posted from this browser.
// Every request goes through api.js.
import { getJSON, postJSON, request, HttpError, describe } from "./api.js";
import { state } from "./state.js";
import { render } from "./render.js";

const MINE_KEY = "harbour-my-reviews";

const list = document.querySelector(".vendor-list");
const dialog = document.querySelector(".reviews-dialog");
const title = dialog.querySelector("#reviews-title");
const statusLine = dialog.querySelector(".reviews-status");
const errorMessage = dialog.querySelector(".reviews-error-message");
const retry = dialog.querySelector(".reviews-retry");
const reviewList = dialog.querySelector(".reviews-list");
const form = dialog.querySelector(".review-form");
const submit = form.querySelector(".review-submit");
const formError = form.querySelector(".review-form-error");

// The dialog's own state. stallId is kept here, not read from the card:
// render() replaces the cards all the time.
const wall = {
  stallId: null,
  status: "idle", // "loading" | "ready" | "error"
  error: null,
  reviews: [],
  controller: null, // the GET in flight, aborted when another stall opens
  posting: false,
  mine: loadMine(), // ids of reviews posted from this browser
};

function loadMine() {
  try {
    return new Set(JSON.parse(localStorage.getItem(MINE_KEY)) ?? []);
  } catch {
    return new Set();
  }
}
function saveMine() {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify([...wall.mine]));
  } catch {
    // storage full or blocked: delete only works until reload
  }
}

const stallById = (id) => state.stalls.find((stall) => stall.id === id);

// ---------- drawing ----------

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(iso) {
  const seconds = (new Date(iso) - Date.now()) / 1000;
  const units = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

function reviewItem(review) {
  // textContent everywhere: a review with <img onerror> stays text
  const li = document.createElement("li");
  li.className = "review";
  li.dataset.id = review.id;

  const header = document.createElement("header");
  const author = document.createElement("strong");
  author.textContent = review.author;
  const stars = document.createElement("span");
  stars.className = "stars-shown";
  stars.textContent = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
  stars.setAttribute("aria-label", `${review.rating} out of 5`);
  const time = document.createElement("time");
  time.dateTime = review.createdAt;
  time.textContent = ago(review.createdAt);
  header.append(author, stars, time);

  if (wall.mine.has(review.id)) {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete";
    del.textContent = "Delete";
    del.setAttribute("aria-label", `Delete your review from ${time.textContent}`);
    header.append(del);
  }

  const text = document.createElement("p");
  text.textContent = review.text;
  li.append(header, text);
  return li;
}

function draw() {
  const stall = stallById(wall.stallId);
  title.textContent = stall ? `Reviews · ${stall.name}` : "Reviews";
  dialog.setAttribute("aria-busy", String(wall.status === "loading"));

  if (wall.status === "loading") statusLine.textContent = "Loading the reviews…";
  else if (wall.status === "error") statusLine.textContent = "";
  else if (!wall.reviews.length) statusLine.textContent = "No reviews yet: be the first.";
  else statusLine.textContent = `${wall.reviews.length} ${wall.reviews.length === 1 ? "review" : "reviews"}, newest first`;

  errorMessage.textContent = wall.status === "error" ? `Couldn't load the reviews. ${describe(wall.error)}` : "";
  retry.hidden = wall.status !== "error";

  reviewList.replaceChildren(...(wall.status === "ready" ? wall.reviews.map(reviewItem) : []));
  submit.disabled = wall.posting;
  submit.textContent = wall.posting ? "Posting…" : "Post review";
}

// ---------- loading ----------

async function loadReviews() {
  wall.controller?.abort(); // a slower, older answer must never land
  const controller = new AbortController();
  wall.controller = controller;
  const id = wall.stallId;

  wall.status = "loading";
  wall.error = null;
  wall.reviews = [];
  draw();
  try {
    const reviews = await getJSON(`/stalls/${encodeURIComponent(id)}/reviews`, { signal: controller.signal });
    if (controller !== wall.controller) return; // another stall was opened meanwhile
    wall.reviews = reviews;
    wall.status = "ready";
  } catch (error) {
    if (error.name === "AbortError" || controller !== wall.controller) return;
    console.error(`GET /stalls/${id}/reviews failed:`, error);
    wall.error = error;
    wall.status = "error";
  }
  wall.controller = null;
  draw();
}

// The card's "★ 4.7 · 3 reviews" is stale after a POST or DELETE:
// the server computes the average, so ask it for the stall again.
// GET is safe to repeat, so one retry covers the server's random 500s.
// If both fail, work the numbers out from the reviews the dialog already has.
async function refreshStall(id) {
  const index = state.stalls.findIndex((stall) => stall.id === id);
  let fresh = null;
  for (let attempt = 1; attempt <= 2 && !fresh; attempt++) {
    try {
      fresh = await getJSON(`/stalls/${encodeURIComponent(id)}`);
    } catch (error) {
      console.warn(`GET /stalls/${id} failed (attempt ${attempt}):`, error);
    }
  }
  if (index !== -1) {
    if (fresh) {
      state.stalls[index] = fresh;
    } else if (wall.stallId === id && wall.status === "ready") {
      const count = wall.reviews.length;
      const average = count ? wall.reviews.reduce((sum, review) => sum + review.rating, 0) / count : null;
      state.stalls[index] = {
        ...state.stalls[index],
        reviewCount: count,
        rating: average === null ? null : Math.round(average * 10) / 10,
      };
    }
  }
  render();
  if (dialog.open) draw();
}

// ---------- the form ----------

const fields = ["author", "rating", "text"];

function clearErrors() {
  formError.textContent = "";
  for (const name of fields) {
    form.querySelector(`#review-${name}-error`).textContent = "";
    fieldControl(name).removeAttribute("aria-invalid");
  }
}
const fieldControl = (name) => (name === "rating" ? form.querySelector(".stars") : form.elements[name]);

function showFieldErrors(fieldMessages) {
  let first = null;
  for (const [name, message] of Object.entries(fieldMessages ?? {})) {
    const slot = form.querySelector(`#review-${name}-error`);
    if (!slot) continue;
    slot.textContent = message;
    fieldControl(name).setAttribute("aria-invalid", "true");
    first ??= name;
  }
  if (first === "rating") form.querySelector('input[name="rating"]').focus();
  else if (first) form.elements[first].focus();
  if (!first) formError.textContent = "Some fields need fixing. Your text is still here.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (wall.posting) return; // a double click posts once
  const id = wall.stallId;
  const data = new FormData(form);
  const body = {
    author: String(data.get("author") ?? ""),
    rating: Number(data.get("rating")), // a number, not "5"; 0 when nothing is picked → the server's 422
    text: String(data.get("text") ?? ""),
  };

  clearErrors();
  wall.posting = true;
  draw();
  try {
    const review = await postJSON(`/stalls/${encodeURIComponent(id)}/reviews`, body);
    wall.mine.add(review.id);
    saveMine();
    form.reset();
    if (wall.stallId === id && wall.status === "ready") {
      wall.reviews = [review, ...wall.reviews];
    }
    refreshStall(id);
  } catch (error) {
    console.error(`POST /stalls/${id}/reviews failed:`, error);
    if (error instanceof HttpError && error.status === 422) showFieldErrors(error.body?.fields);
    else formError.textContent = `Your review wasn't posted. ${describe(error)} Your text is still here.`;
  } finally {
    wall.posting = false;
    draw();
  }
});

// ---------- delete ----------

reviewList.addEventListener("click", async (event) => {
  const button = event.target.closest(".delete");
  if (!button) return;
  const item = button.closest(".review");
  const reviewId = item.dataset.id;
  const stallId = wall.stallId;
  button.disabled = true;
  button.textContent = "Deleting…";
  try {
    await request("DELETE", `/reviews/${encodeURIComponent(reviewId)}`);
    forget(reviewId);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      forget(reviewId); // already gone: same end result
    } else {
      console.error(`DELETE /reviews/${reviewId} failed:`, error);
      formError.textContent = `The review wasn't deleted. ${describe(error)}`;
      button.disabled = false;
      button.textContent = "Delete";
      return;
    }
  }
  refreshStall(stallId);

  function forget(reviewIdToForget) {
    wall.mine.delete(reviewIdToForget);
    saveMine();
    wall.reviews = wall.reviews.filter((review) => review.id !== reviewIdToForget);
    draw();
    statusLine.focus();
  }
});

// ---------- open and close ----------

function open(stallId) {
  if (wall.stallId !== stallId) {
    form.reset(); // a half-written review belongs to the stall it was written for
    clearErrors();
  }
  wall.stallId = stallId;
  if (!dialog.open) dialog.showModal();
  loadReviews();
}

export function setupReviews() {
  statusLine.tabIndex = -1;
  list.addEventListener("click", (event) => {
    const button = event.target.closest(".reviews-open");
    if (!button) return;
    open(button.closest(".stall").dataset.id);
  });
  dialog.querySelector(".reviews-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    wall.controller?.abort(); // nothing lands in a closed dialog
    wall.controller = null;
  });
  // a click on the backdrop closes it too
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  retry.addEventListener("click", () => {
    statusLine.focus();
    loadReviews();
  });
}
