import { initFirebase } from "./firebase.js";
import { addItem, loadLibrary, removeItem, renderLibrary, setLibraryChangeHandler } from "./library.js";
import { setPane, swapPanes, clearRightPane, renderDual } from "./dual.js";
import { initDrawing } from "./drawing.js";

const syncStatus = document.getElementById("syncStatus");
const libraryList = document.getElementById("libraryList");

init();

async function init() {
  setupTabs();
  setupForms();
  setupDualButtons();
  initDrawing();

  const fb = await initFirebase();
  syncStatus.textContent = fb.message;

  setLibraryChangeHandler(() => renderLibraryList());
  await loadLibrary();
  renderDual();
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.view).classList.add("active");
    });
  });
}

function setupForms() {
  document.getElementById("addItemForm").addEventListener("submit", async event => {
    event.preventDefault();
    await addItem({
      title: document.getElementById("itemTitle").value,
      key: document.getElementById("itemKey").value,
      url: document.getElementById("itemUrl").value
    });
    event.currentTarget.reset();
  });
}

function setupDualButtons() {
  document.getElementById("swapDual").addEventListener("click", swapPanes);
  document.getElementById("clearRight").addEventListener("click", clearRightPane);
}

function renderLibraryList() {
  renderLibrary(libraryList, {
    left: item => setPane("left", item),
    right: item => setPane("right", item),
    delete: async item => removeItem(item.id)
  });
}
