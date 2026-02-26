/**
 * PIXY - CANVAS ENGINE
 * High-performance Canvas-based pixel art tool
 * STRICT REQUIREMENT: 100% Visual Parity with DOM version
 */

// ==================== GLOBAL STATE ====================
let isDrawing = false;
let isErasing = false;
let currentColor = "#000000";
let historyStack = [];
let currentStroke = [];
const MAX_HISTORY = 50;

// Cached colors for performance
let cachedBaseColors = { r: 255, g: 255, b: 255 };
let cachedCurrentColorRGB = { r: 0, g: 0, b: 0 };

// Layer system
let layers = [];
let activeLayerIndex = 0;
let currentGridNumber = 16;

// DOM references
let container;
let gridCanvas; // Overlay for grid lines

// ==================== HELPER FUNCTIONS ====================

function hexToRgb(hex) {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

function parseColorString(colorStr) {
  if (!colorStr) return { r: 255, g: 255, b: 255 };
  if (colorStr.startsWith("#"))
    return hexToRgb(colorStr) || { r: 0, g: 0, b: 0 };

  const dummy = document.createElement("div");
  dummy.style.color = colorStr;
  document.body.appendChild(dummy);
  const computedColor = window.getComputedStyle(dummy).color;
  document.body.removeChild(dummy);

  if (computedColor) {
    const parts = computedColor.match(/\d+/g);
    if (parts && parts.length >= 3) {
      return {
        r: parseInt(parts[0], 10),
        g: parseInt(parts[1], 10),
        b: parseInt(parts[2], 10),
      };
    }
  }
  return { r: 255, g: 255, b: 255 };
}

function updateCachedColor() {
  cachedCurrentColorRGB = parseColorString(currentColor);
}

// ==================== LAYER CLASS ====================

class Layer {
  constructor(id, gridSize) {
    this.id = id;
    this.gridSize = gridSize;
    this.data = this.initData(gridSize);

    // Create canvas
    this.canvas = document.createElement("canvas");
    this.canvas.classList.add("layer-canvas");
    this.canvas.dataset.layerId = id;

    // CRITICAL: Pixelated rendering
    this.canvas.style.imageRendering = "pixelated";
    this.canvas.style.position = "absolute";
    this.canvas.style.top = "0";
    this.canvas.style.left = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";

    this.ctx = this.canvas.getContext("2d", { alpha: true });
    this.ctx.imageSmoothingEnabled = false; // CRITICAL: Sharp pixels
  }

  initData(size) {
    const data = [];
    for (let y = 0; y < size; y++) {
      const row = [];
      for (let x = 0; x < size; x++) {
        row.push({ color: "transparent", percent: 0 });
      }
      data.push(row);
    }
    return data;
  }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx.imageSmoothingEnabled = false; // Reset after resize
    this.redrawAll();
  }

  redrawAll() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const cellW = this.canvas.width / this.gridSize;
    const cellH = this.canvas.height / this.gridSize;

    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        const pixel = this.data[y][x];
        if (pixel.percent > 0 && pixel.color !== "transparent") {
          this.ctx.fillStyle = pixel.color;
          this.ctx.fillRect(
            Math.floor(x * cellW),
            Math.floor(y * cellH),
            Math.ceil(cellW),
            Math.ceil(cellH)
          );
        }
      }
    }
  }

  updatePixel(x, y, color, percent) {
    if (x < 0 || x >= this.gridSize || y < 0 || y >= this.gridSize) return;

    this.data[y][x] = { color, percent };

    // Redraw this pixel
    const cellW = this.canvas.width / this.gridSize;
    const cellH = this.canvas.height / this.gridSize;

    this.ctx.clearRect(
      Math.floor(x * cellW),
      Math.floor(y * cellH),
      Math.ceil(cellW),
      Math.ceil(cellH)
    );

    if (percent > 0 && color !== "transparent") {
      this.ctx.fillStyle = color;
      this.ctx.fillRect(
        Math.floor(x * cellW),
        Math.floor(y * cellH),
        Math.ceil(cellW),
        Math.ceil(cellH)
      );
    }
  }

  getPixel(x, y) {
    if (x < 0 || x >= this.gridSize || y < 0 || y >= this.gridSize) return null;
    return this.data[y][x];
  }

  clear() {
    this.data = this.initData(this.gridSize);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

// ==================== GRID FUNCTIONS ====================

function createGrid(size) {
  currentGridNumber = size;

  // Clear existing
  layers = [];
  container.innerHTML = "";

  // Re-add grid canvas
  container.appendChild(gridCanvas);

  // Create first layer
  addLayer();

  // Resize and draw
  resizeCanvases();
}

function addLayer() {
  const id = layers.length + 1;
  const layer = new Layer(id, currentGridNumber);

  // Insert before grid canvas
  container.insertBefore(layer.canvas, gridCanvas);

  layers.push(layer);
  activeLayerIndex = layers.length - 1;

  // Resize the new layer
  const rect = container.getBoundingClientRect();
  layer.resize(rect.width, rect.height);

  if (typeof renderLayerList === "function") renderLayerList();
}

function resizeCanvases() {
  const rect = container.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  if (w === 0 || h === 0) return;

  // Resize all layers
  layers.forEach((layer) => layer.resize(w, h));

  // Resize grid canvas
  gridCanvas.width = w;
  gridCanvas.height = h;

  // Redraw grid
  drawGridLines();
}

function drawGridLines() {
  const ctx = gridCanvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);

  const w = gridCanvas.width;
  const h = gridCanvas.height;
  const cellW = w / currentGridNumber;
  const cellH = h / currentGridNumber;

  // Get border color from CSS
  const computedStyle = getComputedStyle(document.documentElement);
  const borderColor =
    computedStyle.getPropertyValue("--border-cell").trim() || "rgba(0,0,0,0.1)";

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.setLineDash([1, 1]); // Dotted: 1px dash, 1px gap

  // CRITICAL: Draw rectangles for each cell to match DOM `1px dotted` border
  for (let y = 0; y < currentGridNumber; y++) {
    for (let x = 0; x < currentGridNumber; x++) {
      const cellX = Math.floor(x * cellW) + 0.5;
      const cellY = Math.floor(y * cellH) + 0.5;
      const cellWidth = Math.floor(cellW);
      const cellHeight = Math.floor(cellH);

      ctx.strokeRect(cellX, cellY, cellWidth, cellHeight);
    }
  }
}

// ==================== POINTER EVENTS ====================

let lastGridX = -1;
let lastGridY = -1;

function attachContainerListeners() {
  container.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();

    isDrawing = true;
    currentStroke = [];
    container.setPointerCapture(e.pointerId);

    handlePointerDraw(e);
  });

  container.addEventListener("pointermove", (e) => {
    if (isDrawing) {
      e.preventDefault();
      handlePointerDraw(e);
    }
  });

  container.addEventListener("pointerup", (e) => {
    isDrawing = false;
    container.releasePointerCapture(e.pointerId);

    if (currentStroke.length > 0) {
      historyStack.push(currentStroke);
      if (historyStack.length > MAX_HISTORY) historyStack.shift();
      currentStroke = [];

      if (typeof updateLayerPreview === "function") {
        updateLayerPreview(activeLayerIndex);
      }
    }

    lastGridX = -1;
    lastGridY = -1;
  });
}

function handlePointerDraw(e) {
  // CRITICAL: Relative coordinate calculation
  const rect = container.getBoundingClientRect();
  const cellW = rect.width / currentGridNumber;
  const cellH = rect.height / currentGridNumber;

  // Calculate grid position
  const gridX = Math.floor((e.clientX - rect.left) / cellW);
  const gridY = Math.floor((e.clientY - rect.top) / cellH);

  // Bounds check
  if (
    gridX < 0 ||
    gridX >= currentGridNumber ||
    gridY < 0 ||
    gridY >= currentGridNumber
  ) {
    return;
  }

  // Avoid repainting same cell
  if (gridX === lastGridX && gridY === lastGridY) return;

  lastGridX = gridX;
  lastGridY = gridY;

  paintPixel(gridX, gridY);
}

function paintPixel(x, y) {
  const layer = layers[activeLayerIndex];
  if (!layer) return;

  const pixel = layer.getPixel(x, y);
  const prevColor = pixel.color;
  const prevPercent = pixel.percent;

  if (isErasing) {
    if (prevColor !== "transparent") {
      layer.updatePixel(x, y, "transparent", 0);
      recordStroke(x, y, prevColor, prevPercent, "transparent", 0);
    }
    return;
  }

  // Progressive opacity (10% increments)
  let newPercent = Number(pixel.percent) || 0;
  if (newPercent < 100) {
    newPercent += 10;

    // Color mixing
    const targetR = cachedCurrentColorRGB.r;
    const targetG = cachedCurrentColorRGB.g;
    const targetB = cachedCurrentColorRGB.b;

    const baseR = cachedBaseColors.r;
    const baseG = cachedBaseColors.g;
    const baseB = cachedBaseColors.b;

    const mix = newPercent / 100;
    const mixedR = Math.round(baseR + (targetR - baseR) * mix);
    const mixedG = Math.round(baseG + (targetG - baseG) * mix);
    const mixedB = Math.round(baseB + (targetB - baseB) * mix);

    const newColor = `rgb(${mixedR}, ${mixedG}, ${mixedB})`;

    layer.updatePixel(x, y, newColor, newPercent);
    recordStroke(x, y, prevColor, prevPercent, newColor, newPercent);
  }
}

function recordStroke(x, y, prevC, prevP, newC, newP) {
  currentStroke.push({
    layerIndex: activeLayerIndex,
    x,
    y,
    prevColor: prevC,
    prevPercent: prevP,
    newColor: newC,
    newPercent: newP,
  });
}

// ==================== UNDO/RESET ====================

function undo() {
  if (historyStack.length === 0) return;

  const lastStroke = historyStack.pop();

  for (let i = lastStroke.length - 1; i >= 0; i--) {
    const action = lastStroke[i];
    const layer = layers[action.layerIndex];
    if (layer) {
      layer.updatePixel(
        action.x,
        action.y,
        action.prevColor,
        action.prevPercent
      );
    }
  }

  if (typeof updateLayerPreview === "function") {
    updateLayerPreview(activeLayerIndex);
  }
}

function reset() {
  const resetStroke = [];

  layers.forEach((layer, layerIdx) => {
    for (let y = 0; y < layer.gridSize; y++) {
      for (let x = 0; x < layer.gridSize; x++) {
        const p = layer.data[y][x];
        if (p.percent > 0) {
          resetStroke.push({
            layerIndex: layerIdx,
            x,
            y,
            prevColor: p.color,
            prevPercent: p.percent,
            newColor: "transparent",
            newPercent: 0,
          });
        }
      }
    }
    layer.clear();
  });

  if (resetStroke.length > 0) {
    historyStack.push(resetStroke);
  }

  if (typeof updateLayerPreview === "function") {
    layers.forEach((_, i) => updateLayerPreview(i));
  }
}

// ==================== INITIALIZATION ====================

document.addEventListener("DOMContentLoaded", () => {
  console.log("Canvas Engine Loading...");

  // Create container
  const tools = document.getElementById("tools");
  container = document.createElement("div");
  container.classList.add("container");

  if (tools && tools.parentNode) {
    tools.parentNode.insertBefore(container, tools);
  } else {
    const board = document.getElementById("drawingBoard");
    if (board) board.appendChild(container);
  }

  // Create grid overlay
  gridCanvas = document.createElement("canvas");
  gridCanvas.classList.add("grid-overlay");
  gridCanvas.style.imageRendering = "pixelated"; // CRITICAL
  gridCanvas.style.pointerEvents = "none"; // Pass-through
  gridCanvas.style.position = "absolute";
  gridCanvas.style.top = "0";
  gridCanvas.style.left = "0";
  gridCanvas.style.width = "100%";
  gridCanvas.style.height = "100%";
  gridCanvas.style.zIndex = "999";
  container.appendChild(gridCanvas);

  // Attach listeners
  attachContainerListeners();

  // Prevent drag
  container.addEventListener("mousedown", (e) => e.preventDefault());

  // Create grid
  createGrid(16);

  // Resize observer
  const ro = new ResizeObserver(() => {
    clearTimeout(window.resizeTimeout);
    window.resizeTimeout = setTimeout(() => resizeCanvases(), 50);
  });
  ro.observe(container);

  // Init controls
  initControls();

  // Load theme
  const savedTheme = localStorage.getItem("pixelArtThemeId");
  if (savedTheme && window.themes && window.themes[savedTheme]) {
    window.applyTheme(window.themes[savedTheme].colors);
  }

  // Render saved
  try {
    renderSavedDrawings();
  } catch (e) {
    console.warn("Failed to render saved drawings", e);
  }
});

function initControls() {
  // Color picker
  const cp = document.getElementById("colorPicker");
  if (cp) {
    currentColor = cp.value;
    updateCachedColor();

    cp.oninput = (e) => {
      currentColor = e.target.value;
      updateCachedColor();
      isErasing = false;
      document.getElementById("eraserBtn")?.classList.remove("active");
    };
    cp.onchange = cp.oninput;
  }

  // Eraser
  const eb = document.getElementById("eraserBtn");
  if (eb) {
    eb.onclick = () => {
      isErasing = !isErasing;
      eb.classList.toggle("active");
    };
  }

  // Reset
  document.getElementById("resetBtn")?.addEventListener("click", reset);

  // Undo
  document.getElementById("undoBtn")?.addEventListener("click", undo);

  // Grid size
  document.getElementById("applyCellCount")?.addEventListener("click", () => {
    const inp = document.getElementById("cellNumberInput");
    let val = parseInt(inp.value) || 16;
    if (val < 1) val = 1;
    if (val > 100) val = 100;
    createGrid(val);
    document.getElementById("cellCountPanel").classList.add("hidden");
  });
}

// Export functions need to be available globally
window.createGrid = createGrid;
window.layers = layers;
window.currentGridNumber = currentGridNumber;
