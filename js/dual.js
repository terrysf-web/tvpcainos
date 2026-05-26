let leftItem = null;
let rightItem = null;

export function setPane(side, item) {
  if (side === "left") leftItem = item;
  if (side === "right") rightItem = item;
  renderDual();
}

export function swapPanes() {
  [leftItem, rightItem] = [rightItem, leftItem];
  renderDual();
}

export function clearRightPane() {
  rightItem = null;
  renderDual();
}

export function renderDual() {
  renderPane(document.getElementById("leftPane"), leftItem, "라이브러리에서 Left를 선택하세요.");
  renderPane(document.getElementById("rightPane"), rightItem, "라이브러리에서 Right를 선택하세요.");
}

function renderPane(el, item, emptyText) {
  if (!item) {
    el.className = "viewer empty";
    el.textContent = emptyText;
    return;
  }

  el.className = "viewer";
  if (item.url) {
    el.innerHTML = `<iframe title="${escapeAttr(item.title)}" src="${escapeAttr(item.url)}"></iframe>`;
  } else {
    el.innerHTML = `
      <div class="sheet-preview">
        <h2>${escapeHtml(item.title)}</h2>
        ${item.key ? `<span class="key">Key ${escapeHtml(item.key)}</span>` : ""}
        <p class="muted">URL이 없어서 텍스트 카드로 표시 중입니다.</p>
      </div>
    `;
  }
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}
function escapeAttr(value) { return escapeHtml(value); }
