import { fetchCloudItems, saveCloudItem, deleteCloudItem, isFirebaseReady } from "./firebase.js";

const LOCAL_KEY = "ainos_v2_library";
let items = [];
let onChange = () => {};

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || []; }
  catch { return []; }
}

function saveLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
}

export function setLibraryChangeHandler(handler) {
  onChange = handler;
}

export function getItems() {
  return [...items];
}

export async function loadLibrary() {
  const cloudItems = await fetchCloudItems();
  items = cloudItems || loadLocal();
  saveLocal();
  onChange(getItems());
  return getItems();
}

export async function addItem(raw) {
  const item = {
    id: raw.id || crypto.randomUUID(),
    title: (raw.title || "Untitled").trim(),
    key: (raw.key || "").trim(),
    url: (raw.url || "").trim(),
    createdAt: raw.createdAt || Date.now(),
    updatedAt: Date.now()
  };

  const saved = isFirebaseReady() ? await saveCloudItem(item) : item;
  const index = items.findIndex(x => x.id === saved.id);
  if (index >= 0) items[index] = saved; else items.push(saved);
  saveLocal();
  onChange(getItems());
  return saved;
}

export async function removeItem(id) {
  await deleteCloudItem(id);
  items = items.filter(item => item.id !== id);
  saveLocal();
  onChange(getItems());
}

export function renderLibrary(container, handlers = {}) {
  if (!items.length) {
    container.innerHTML = `<div class="muted">아직 라이브러리에 항목이 없습니다.</div>`;
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="item-card" data-id="${item.id}">
      <div>
        <div class="item-title">${escapeHtml(item.title)}</div>
        <div class="item-meta">${item.key ? `Key: ${escapeHtml(item.key)}` : "No key"}${item.url ? " · URL attached" : ""}</div>
      </div>
      <button data-action="left">Left</button>
      <button data-action="right">Right</button>
      <button class="delete-btn" data-action="delete">Delete</button>
    </div>
  `).join("");

  container.querySelectorAll("button[data-action]").forEach(button => {
    button.addEventListener("click", async event => {
      const card = event.currentTarget.closest(".item-card");
      const item = items.find(x => x.id === card.dataset.id);
      const action = event.currentTarget.dataset.action;
      if (action === "delete") return handlers.delete?.(item);
      if (action === "left") return handlers.left?.(item);
      if (action === "right") return handlers.right?.(item);
    });
  });
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}
