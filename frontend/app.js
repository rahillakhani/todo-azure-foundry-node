const config = window.APP_CONFIG || {};
const API_BASE_URL = config.apiBaseUrl || "http://localhost:3000";
const WS_URL = config.wsUrl || "ws://localhost:8080";
const USER_ID_KEY = "todo-app:userId";
const MAX_RECONNECT_DELAY_MS = 30_000;
const SUMMARY_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // matches the backend's hourly summary cache

function getUserId() {
  let userId = localStorage.getItem(USER_ID_KEY);
  if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, userId);
  }
  return userId;
}

const userId = getUserId();

const form = document.getElementById("todo-form");
const textInput = document.getElementById("todo-text");
const dueInput = document.getElementById("todo-due");
const priorityInput = document.getElementById("todo-priority");
const formError = document.getElementById("form-error");
const activeTodosList = document.getElementById("todos-active-list");
const snoozedTodosList = document.getElementById("todos-snoozed-list");
const completedTodosList = document.getElementById("todos-completed-list");
const summaryText = document.getElementById("summary-text");
const remindersList = document.getElementById("reminders-list");
const connectionStatus = document.getElementById("connection-status");
const refreshTodosBtn = document.getElementById("refresh-todos");
const refreshSummaryBtn = document.getElementById("refresh-summary");
const refreshRemindersBtn = document.getElementById("refresh-reminders");
const toast = document.getElementById("toast");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
const searchResultsList = document.getElementById("search-results-list");
const clearSearchBtn = document.getElementById("clear-search");
const todoLanes = document.getElementById("todo-lanes");

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

// Minimal inline icon set (no external icon library/CDN). Each is a plain
// stroke path using currentColor, so it inherits the button's text color
// (including on hover) automatically.
const ICON_PATHS = {
  check: '<polyline points="20 6 9 17 4 12" />',
  undo: '<path d="M3 12a9 9 0 1 0 3.3-6.9" /><polyline points="3 3 3 9 9 9" />',
  clock: '<circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />',
  clockOff:
    '<circle cx="12" cy="12" r="9" /><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" />',
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

// Icon-only action button: visible icon, accessible name + hover tooltip
// via title/aria-label rather than visible text (these repeat 1-3x per
// list item, so text labels get crowded fast, especially on mobile).
function actionButton(action, label, iconName, id) {
  return `<button type="button" class="todo-action todo-action--${action}" data-action="${action}" data-id="${id}" title="${label}" aria-label="${label}">${icon(iconName)}</button>`;
}

function describeMeta(todo) {
  if (todo.due_date) {
    return `${new Date(todo.due_date).toLocaleString()}${todo.priority ? " · High priority" : ""}`;
  }
  return todo.priority ? "High priority" : "No due date";
}

// Reminders are read-only (no complete/undo/snooze actions there).
function renderReminderItem(todo) {
  return `
    <li class="todo-list__item${todo.priority ? " todo-list__item--priority" : ""}">
      <div class="todo-list__body">
        <span class="todo-list__description">${escapeHtml(todo.description)}</span>
        <span class="todo-list__meta">${describeMeta(todo)}</span>
      </div>
    </li>
  `;
}

function renderTodoItem(todo) {
  const isDone = todo.status === "done";
  const isSnoozed = !isDone && Boolean(todo.due_date);
  const actions = isDone
    ? actionButton("undo", "Undo", "undo", todo.id)
    : actionButton("complete", "Complete", "check", todo.id) +
      actionButton("snooze", "Snooze 1h", "clock", todo.id) +
      (isSnoozed ? actionButton("unsnooze", "Unsnooze", "clockOff", todo.id) : "");

  const classes = [
    "todo-list__item",
    todo.priority && "todo-list__item--priority",
    isSnoozed && "todo-list__item--snoozed",
    isDone && "todo-list__item--done",
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <li class="${classes}">
      <div class="todo-list__body">
        <span class="todo-list__description">${escapeHtml(todo.description)}</span>
        <span class="todo-list__meta">${describeMeta(todo)}</span>
      </div>
      <div class="todo-list__actions">${actions}</div>
    </li>
  `;
}

function renderList(el, todos, emptyMessage, renderItem) {
  el.innerHTML = todos.length ? todos.map(renderItem).join("") : `<li class="todo-list__empty">${emptyMessage}</li>`;
}

function showError(message) {
  formError.textContent = message;
  formError.hidden = !message;
}

let toastTimer;
function showToast(message, variant = "success") {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toast.classList.toggle("toast--error", variant === "error");
  // Force layout so the hidden -> visible opacity transition actually runs.
  toast.getBoundingClientRect();
  toast.classList.add("toast--visible");

  toastTimer = setTimeout(() => {
    toast.classList.remove("toast--visible");
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 250);
  }, 3000);
}

async function loadTodos() {
  try {
    const res = await fetch(`${API_BASE_URL}/todos?userId=${encodeURIComponent(userId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to load todos");

    // Snoozed = active (not done) with a due date, whether that date came
    // from the Snooze button or was set at creation time. Active = not
    // done and no due date at all.
    const active = data.todos.filter((todo) => todo.status !== "done" && !todo.due_date);
    const snoozed = data.todos.filter((todo) => todo.status !== "done" && todo.due_date);
    const completed = data.todos.filter((todo) => todo.status === "done");
    renderList(activeTodosList, active, "No active todos.", renderTodoItem);
    renderList(snoozedTodosList, snoozed, "Nothing snoozed.", renderTodoItem);
    renderList(completedTodosList, completed, "No completed todos yet.", renderTodoItem);
  } catch (err) {
    console.error("Failed to load todos", err);
    renderList(activeTodosList, [], "Couldn't load todos.", renderTodoItem);
    renderList(snoozedTodosList, [], "Couldn't load todos.", renderTodoItem);
    renderList(completedTodosList, [], "Couldn't load todos.", renderTodoItem);
  }
}

// Semantic search: the backend embeds `query` and orders todos by vector
// similarity (see backend/docs/README.md's Agent Logic section) — this
// finds e.g. "groceries" matches against "Buy milk and eggs" even though
// no words overlap. Results reuse renderTodoItem, so Complete/Snooze/etc.
// work directly from the search results too.
let lastSearchQuery = null;

async function performSearch(query) {
  try {
    const url = `${API_BASE_URL}/todos/search?userId=${encodeURIComponent(userId)}&q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Search failed");

    lastSearchQuery = query;
    searchResults.hidden = false;
    todoLanes.hidden = true;
    renderList(searchResultsList, data.todos, "No matching todos.", renderTodoItem);
  } catch (err) {
    console.error("Search failed", err);
    showToast(err.message || "Search failed.", "error");
  }
}

function clearSearch() {
  lastSearchQuery = null;
  searchInput.value = "";
  searchResults.hidden = true;
  todoLanes.hidden = false;
}

// Handles clicks on the Complete/Undo/Snooze buttons inside any lane, or
// the search results list (event delegation, since list items are
// re-rendered wholesale on every update rather than diffed).
async function handleTodoAction(event) {
  const button = event.target.closest(".todo-action");
  if (!button) return;

  const { action, id } = button.dataset;
  const pathByAction = {
    complete: `/todos/${id}/complete`,
    undo: `/todos/${id}/undo`,
    snooze: `/todos/${id}/snooze`,
    unsnooze: `/todos/${id}/unsnooze`,
  };
  const path = pathByAction[action];
  if (!path) return;

  button.disabled = true;
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `Failed to ${action} todo`);

    await loadTodos();
    requestReminders();
    if (!searchResults.hidden && lastSearchQuery) {
      await performSearch(lastSearchQuery);
    }
  } catch (err) {
    console.error(`Failed to ${action} todo`, err);
    showToast(err.message || `Couldn't ${action} that todo.`, "error");
    button.disabled = false;
  }
}

async function submitTodo(event) {
  event.preventDefault();
  showError("");

  const text = textInput.value.trim();
  if (!text) {
    showError("Enter a todo before submitting.");
    return;
  }

  const payload = { text, userId };
  if (dueInput.value) {
    payload.due_date = new Date(dueInput.value).toISOString();
  }
  if (priorityInput.checked) {
    payload.priority = true;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    const res = await fetch(`${API_BASE_URL}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to add todo");

    form.reset();
    await loadTodos();
    requestSummary();
    requestReminders();
    showToast(`Created ${data.count} todo${data.count === 1 ? "" : "s"}.`);
  } catch (err) {
    showError(err.message || "Something went wrong adding the todo.");
  } finally {
    submitButton.disabled = false;
  }
}

// --- WebSocket, with reconnect-on-close using capped exponential backoff ---
let socket = null;
let reconnectAttempts = 0;

function setConnectionStatus(state, label) {
  connectionStatus.textContent = label;
  connectionStatus.className = `status status--${state}`;
}

function connectWebSocket() {
  setConnectionStatus("connecting", "Connecting to server…");
  socket = new WebSocket(WS_URL);

  socket.addEventListener("open", () => {
    reconnectAttempts = 0;
    setConnectionStatus("open", "Connected");
    requestSummary();
    requestReminders();
  });

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === "summary") {
      summaryText.textContent = message.data;
    } else if (message.type === "reminders") {
      renderList(remindersList, message.data, "No upcoming reminders.", renderReminderItem);
    } else if (message.type === "error") {
      console.warn("WebSocket error message", message.message);
    }
  });

  socket.addEventListener("close", () => {
    setConnectionStatus("closed", "Disconnected — reconnecting…");
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    socket.close();
  });
}

function scheduleReconnect() {
  reconnectAttempts += 1;
  const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS);
  setTimeout(connectWebSocket, delay);
}

function requestSummary() {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "getSummary", userId }));
  }
}

function requestReminders() {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "getReminders", userId }));
  }
}

form.addEventListener("submit", submitTodo);
refreshTodosBtn.addEventListener("click", loadTodos);
refreshSummaryBtn.addEventListener("click", requestSummary);
refreshRemindersBtn.addEventListener("click", requestReminders);
activeTodosList.addEventListener("click", handleTodoAction);
snoozedTodosList.addEventListener("click", handleTodoAction);
completedTodosList.addEventListener("click", handleTodoAction);
searchResultsList.addEventListener("click", handleTodoAction);
searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (query) performSearch(query);
});
clearSearchBtn.addEventListener("click", clearSearch);

loadTodos();
connectWebSocket();
// The backend only recomputes the summary once an hour anyway; this just
// keeps the panel from going stale in a long-lived tab without the user
// having to click Refresh.
setInterval(requestSummary, SUMMARY_REFRESH_INTERVAL_MS);
