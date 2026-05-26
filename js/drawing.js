let canvas, ctx;
let drawing = false;
let color = "#111111";
let mode = "pen";

export function initDrawing() {
  canvas = document.getElementById("noteCanvas");
  ctx = canvas.getContext("2d");
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  canvas.addEventListener("pointerdown", start);
  canvas.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);

  document.getElementById("penBlack").addEventListener("click", () => setPen("#111111"));
  document.getElementById("penRed").addEventListener("click", () => setPen("#c1121f"));
  document.getElementById("eraser").addEventListener("click", () => { mode = "eraser"; });
  document.getElementById("clearCanvas").addEventListener("click", clearCanvas);
}

function setPen(nextColor) {
  color = nextColor;
  mode = "pen";
}

function getPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height)
  };
}

function start(event) {
  event.preventDefault();
  drawing = true;
  const p = getPoint(event);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
}

function move(event) {
  if (!drawing) return;
  event.preventDefault();
  const p = getPoint(event);
  ctx.globalCompositeOperation = mode === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = color;
  ctx.lineWidth = mode === "eraser" ? 24 : 4;
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
}

function stop() {
  drawing = false;
  ctx.globalCompositeOperation = "source-over";
}

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}
