let isDrawing = false;
let isErasing = false;
let isFilling = false;
let currentColor = "#000000";
let lastStylusTime = 0;
let lastPenTapTime = 0;
let lastPenTapX = 0;
let lastPenTapY = 0;
let historyStack = [];
let currentStroke = []; // Stores { layerId, x, y, prevColor, prevPercent, newColor, newPercent }
const MAX_HISTORY = 50;

// Drawing mode
let drawingMode = "progressive";

// Cached colors
let cachedBaseColors = { r: 255, g: 255, b: 255 }; // Default to white
let cachedCurrentColorRGB = { r: 0, g: 0, b: 0 };

// Canvas Engine State
let gridCount = 16;
let layers = []; // Array of { id, name, canvas, ctx, matrix, opacity, visible }
let activeLayerIndex = 0;
let layerCounter = 1;
let container = null;
let bgCanvas = null; // Dedicated canvas for grid lines and background color
let bgCtx = null;

// Pro State
let isProUser = false;
const LICENSE_KEY_STORAGE = "pixy_license_key";
const LICENSE_VALIDATED_STORAGE = "pixy_license_validated";
const OFFLINE_GRACE_DAYS = 7;

// LemonSqueezy Config — REPLACE WITH REAL IDs FROM YOUR LEMONSQUEEZY DASHBOARD
const LEMON_CHECKOUT_LIFETIME = "https://pixystudio.lemonsqueezy.com/checkout/buy/0dba630b-5f1d-4215-85dc-b9f927f2d5bd";
const LEMON_CHECKOUT_MONTHLY = "https://pixystudio.lemonsqueezy.com/checkout/buy/64c0ba55-ae8f-40c8-a4ca-be8b909b7cde";

// RevenueCat (Mobile only)
const ENTITLEMENT_ID = "pro_access";
const API_KEY_IOS = "appl_PLACEHOLDER_KEY";
const API_KEY_ANDROID = "goog_PLACEHOLDER_KEY";

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
  initApp();
  initPaymentSystem();
  initAds();
});

function initApp() {
  const loadingEl = document.getElementById("appLoading");
  if (loadingEl) loadingEl.style.display = "none";

  const contentWrapper = document.querySelector(".content-wrapper");
  if (contentWrapper) {
    contentWrapper.style.visibility = "visible";
    contentWrapper.style.opacity = "1";
  }

  // Error Handler
  window.onerror = function (msg, source, lineno, colno, error) {
    console.error("Global Error:", msg, source, lineno);
  };

  // Container Setup
  const tools = document.getElementById("tools");
  container = document.createElement("div");
  container.classList.add("container");
  // Ensure container has relative positioning for absolute canvas stacking
  container.style.position = "relative";
  container.style.overflow = "hidden";

  if (tools && tools.parentNode) {
    tools.parentNode.insertBefore(container, tools);
  } else {
    const board = document.getElementById("drawingBoard");
    if (board) board.appendChild(container);
  }

  // Attach Listeners
  attachContainerListeners();

  // Prevent native drag
  container.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });

  // Create Initial Grid (Defaults to 16, or loads save)
  // We defer creation until we check for saves, but default to 16 if no save.

  try {
    // Try rendering saved drawings first (populates sidebar)
    renderSavedDrawings();
    // Just create default grid, user can load save if they want
    createGrid(16);
  } catch (e) {
    console.warn("Init failed", e);
    createGrid(16);
  }

  // Initialize Color Picker
  const colorPicker = document.getElementById("colorPicker");
  if (colorPicker) {
    currentColor = colorPicker.value || "#000000";
    updateCachedColor();
    colorPicker.oninput = handleColorChange;
    colorPicker.onchange = handleColorChange;
  }
}

function handleColorChange(e) {
  currentColor = e.target.value;
  updateCachedColor();
  isErasing = false;
  const eraserBtn = document.getElementById("eraserBtn");
  if (eraserBtn) eraserBtn.classList.remove("active");
  isFilling = false;
  const fillBtn = document.getElementById("fillBtn");
  if (fillBtn) fillBtn.classList.remove("active");
}

function updateCachedColor() {
  if (currentColor.startsWith("#")) {
    const rgb = hexToRgb(currentColor);
    if (rgb) cachedCurrentColorRGB = rgb;
  } else {
    const parsed = parseColorString(currentColor);
    if (parsed) cachedCurrentColorRGB = parsed;
  }
}

// --- CANVAS ENGINE ---

function createGrid(size) {
  gridCount = parseInt(size);
  if (gridCount < 1) gridCount = 1;

  const maxSize = isProUser ? 256 : 64;
  if (gridCount > maxSize) {
    if (!isProUser) {
      showPaywall("Canvas sizes above 64x64 require Pro");
      gridCount = 64;
    } else {
      gridCount = 256;
    }
  }
  window.currentGridNumber = gridCount;

  // Reset System
  container.innerHTML = "";
  layers = [];
  historyStack = [];
  layerCounter = 1;
  activeLayerIndex = 0;

  // 1. Create Background/Grid Canvas
  bgCanvas = document.createElement("canvas");
  bgCanvas.style.position = "absolute";
  bgCanvas.style.top = "0";
  bgCanvas.style.left = "0";
  bgCanvas.style.width = "100%";
  bgCanvas.style.height = "100%";
  bgCanvas.style.pointerEvents = "none"; // Clicks go through to container events
  bgCanvas.style.zIndex = "0";
  // Crisp Pixels
  bgCanvas.style.imageRendering = "pixelated";

  // Resize Observer to handle Responsive Canvas Resolution
  // We will set internal resolution to match logical pixels or higher for sharpness?
  // Actually, distinct requirement: "Pixel Perfect".
  // Best approach: Match internal resolution to CSS size * dpr,
  // OR just set it to a fixed reasonable size (e.g. 1024x1024) and let CSS scale?
  // User asked for "Crisp Pixels" and "ctx.imageSmoothingEnabled = false".
  // Let's use a fixed high internal resolution to ensure quality, but proportional to grid.
  setupCanvasResolution(bgCanvas);

  bgCtx = bgCanvas.getContext("2d");
  bgCtx.imageSmoothingEnabled = false;
  container.appendChild(bgCanvas);

  // 2. Draw Grid (Initial)
  drawGrid();

  // 3. Create First Layer
  addLayer();

  // 4. Update UI
  renderLayerList();

  // 5. Force theme apply to ensure colors are correct
  // (This calls drawGrid again potentially, but safe)
  // We need to fetch current colors from CSS variables
  setTimeout(refreshThemeColors, 50);
}

function setupCanvasResolution(canvas) {
  // We'll use a standard internal resolution that scales well.
  // 2048 is decent, but let's match container's bounding box * DPR or similar?
  // For simplicity and performance, let's use a fixed size that is a multiple of gridCount if possible?
  // No, dynamic is better.
  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  // We want at least ~1000px for good quality export
  const size = Math.max(rect.width * dpr, 1024);

  canvas.width = size;
  canvas.height = size;
  // Only square canvas supported per app Logic
}

function drawGrid() {
  if (!bgCtx || !bgCanvas) return;

  const w = bgCanvas.width;
  const h = bgCanvas.height;
  const cellSize = w / gridCount;

  bgCtx.clearRect(0, 0, w, h);

  // 1. Fill Background (Layer 0 Background Logic)
  // Per spec: "Bottom layer gets the theme background".
  // Since layers are transparent, we put the base color on the bgCanvas.
  const bgCellColor = getCSSVariable("--bg-cell") || "#ffffff";
  bgCtx.fillStyle = bgCellColor;
  bgCtx.fillRect(0, 0, w, h);

  // 2. Draw Dotted Grid Lines
  const borderCellColor = getCSSVariable("--border-cell") || "rgba(0,0,0,0.1)";
  bgCtx.strokeStyle = borderCellColor;
  bgCtx.lineWidth = Math.max(1, w / 500); // Scale line width slightly
  bgCtx.setLineDash([Math.max(2, w / 400), Math.max(2, w / 400)]); // Dotted

  // Draw grid
  bgCtx.beginPath();

  // Vertical lines
  for (let x = 0; x <= gridCount; x++) {
    // Round to nearest pixel to avoid fuzziness?
    const pos = Math.floor(x * cellSize) + 0.5;
    bgCtx.moveTo(pos, 0);
    bgCtx.lineTo(pos, h);
  }
  // Horizontal lines
  for (let y = 0; y <= gridCount; y++) {
    const pos = Math.floor(y * cellSize) + 0.5;
    bgCtx.moveTo(0, pos);
    bgCtx.lineTo(w, pos);
  }

  bgCtx.stroke();

  // Also draw individual cell borders?
  // "The current .cell has border: 1px dotted".
  // The loop above effectively draws borders around every cell.
  // StrokeRect approach for every cell as requested:
  /*
    for (let y=0; y<gridCount; y++) {
        for (let x=0; x<gridCount; x++) {
             bgCtx.strokeRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
    }
    */
  // The path approach above is faster than thousands of strokeRects and achieves result.
}

function refreshThemeColors() {
  // Re-read CSS variables and redraw
  // Update cachedBaseColors for shading
  const bgCell = getCSSVariable("--bg-cell");
  if (bgCell) {
    cachedBaseColors = parseColorString(bgCell) || { r: 255, g: 255, b: 255 };
  }
  drawGrid();
}

function getCSSVariable(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

// --- LAYER MANAGEMENT ---

function addLayer() {
  // LAYER LIMIT CHECK
  if (!isProUser && layers.length >= 3) {
    showPaywall("Unlimited Layers is a Pro Feature!");
    return;
  }

  const index = layers.length;
  const layerId = layerCounter++;
  const layerName = `Layer ${layerId}`;

  const canvas = document.createElement("canvas");
  canvas.classList.add("layer-canvas");
  canvas.dataset.layerId = layerId;

  // Style
  canvas.style.position = "absolute";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.zIndex = index + 1;
  canvas.style.imageRendering = "pixelated";
  canvas.style.pointerEvents = "none"; // Pass through

  // Resolution
  setupCanvasResolution(canvas);

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;

  // Matrix Initialization
  const matrix = [];
  for (let y = 0; y < gridCount; y++) {
    const row = [];
    for (let x = 0; x < gridCount; x++) {
      row.push({ color: "transparent", percent: 0 });
    }
    matrix.push(row);
  }

  container.appendChild(canvas);

  const newLayer = {
    id: layerId,
    name: layerName,
    canvas: canvas,
    ctx: ctx,
    matrix: matrix,
    visible: true,
    previewDataUrl: "",
  };

  layers.push(newLayer);

  // Update active
  activeLayerIndex = layers.length - 1;
  updateLayerPreview(activeLayerIndex);
  renderLayerList();

  return newLayer;
}

function setActiveLayer(index) {
  if (index < 0 || index >= layers.length) return;
  activeLayerIndex = index;
  renderLayerList();
}

function deleteLayer() {
  if (layers.length <= 1) {
    alert("Cannot delete the last layer!");
    return;
  }

  const layerToRemove = layers[activeLayerIndex];
  container.removeChild(layerToRemove.canvas);

  layers.splice(activeLayerIndex, 1);

  if (activeLayerIndex >= layers.length) {
    activeLayerIndex = layers.length - 1;
  }

  updateLayerZIndices();
  historyStack = []; // Clear undo to avoid sync issues
  renderLayerList();
}

function moveLayerUp() {
  if (activeLayerIndex >= layers.length - 1) return;

  const current = layers[activeLayerIndex];
  layers[activeLayerIndex] = layers[activeLayerIndex + 1];
  layers[activeLayerIndex + 1] = current;

  activeLayerIndex++;
  updateLayerZIndices();
  renderLayerList();
}

function moveLayerDown() {
  if (activeLayerIndex <= 0) return;

  const current = layers[activeLayerIndex];
  layers[activeLayerIndex] = layers[activeLayerIndex - 1];
  layers[activeLayerIndex - 1] = current;

  activeLayerIndex--;
  updateLayerZIndices();
  renderLayerList();
}

function updateLayerZIndices() {
  layers.forEach((layer, i) => {
    layer.canvas.style.zIndex = i + 1;
  });
}

// Generate Preview
const previewCanvas = document.createElement("canvas");
const previewCtx = previewCanvas.getContext("2d");
previewCanvas.width = 32;
previewCanvas.height = 32;

function updateLayerPreview(index) {
  if (index < 0 || index >= layers.length) return;

  const layer = layers[index];
  previewCtx.clearRect(0, 0, 32, 32);

  // Draw from matrix
  const cellW = 32 / gridCount;
  const cellH = 32 / gridCount;

  for (let y = 0; y < gridCount; y++) {
    for (let x = 0; x < gridCount; x++) {
      const cell = layer.matrix[y][x];
      if (cell.percent > 0) {
        previewCtx.fillStyle = cell.color;
        previewCtx.fillRect(x * cellW, y * cellH, cellW, cellH);
      }
    }
  }

  layer.previewDataUrl = previewCanvas.toDataURL();

  // DOM Update optimization
  const idx = layers.length - 1 - index;
  const items = document.querySelectorAll(".layer-item");
  if (items[idx]) {
    const img = items[idx].querySelector(".layer-preview");
    if (img) img.src = layer.previewDataUrl;
  }
}

// --- INPUT HANDLING ---

function AttachContainerListenersFunc() {
  // This function acts as the "attachContainerListeners" from original
  // but adapted for Canvas

  container.style.touchAction = "none"; // Critical for Pointer Events

  container.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "pen") window.hasDetectedStylus = true;
    if (window.hasDetectedStylus && e.pointerType !== "pen") return;
    if (e.button !== 0 && e.pointerType === "mouse") return;

    e.preventDefault();

    // DOUBLE TAP DETECTION FOR PEN
    if (e.pointerType === "pen") {
      const now = Date.now();
      const dist = Math.hypot(e.clientX - lastPenTapX, e.clientY - lastPenTapY);

      if (now - lastPenTapTime < 300 && dist < 20) {
        // Double Tap Detected!
        // Toggle Eraser
        toggleEraser();

        // Prevent drawing a dot for this tap?
        // We set isDrawing false so it stops immediately?
        // Or we just let it be. But usually double tap is "gesture".
        // Let's prevent default action (drawing) for this specific tap
        isDrawing = false;
        lastPenTapTime = 0; // Reset
        return;
      }

      lastPenTapTime = now;
      lastPenTapX = e.clientX;
      lastPenTapY = e.clientY;
    }

    isDrawing = true;
    currentStroke = [];
    container.setPointerCapture(e.pointerId);

    handlePointerDraw(e);
  });

  container.addEventListener("pointermove", (e) => {
    if (window.hasDetectedStylus && e.pointerType !== "pen") return;
    if (isDrawing) {
      e.preventDefault();
      handlePointerDraw(e);
    }
  });

  container.addEventListener("pointerup", (e) => {
    if (window.hasDetectedStylus && e.pointerType !== "pen") return;

    isDrawing = false;
    if (currentStroke.length > 0) {
      historyStack.push({
        layerId: layers[activeLayerIndex].id,
        strokes: currentStroke, // Copy ref
      });
      if (historyStack.length > MAX_HISTORY) historyStack.shift();

      updateLayerPreview(activeLayerIndex);
      currentStroke = [];
    }

    try {
      container.releasePointerCapture(e.pointerId);
    } catch (err) {}
  });
}
// define alias to match legacy name if needed, but we used it in init
const attachContainerListeners = AttachContainerListenersFunc;

let lastGridX = -1;
let lastGridY = -1;

function handlePointerDraw(e) {
  const rect = container.getBoundingClientRect();

  // Calculate Grid Coordinates
  let x = e.clientX - rect.left;
  let y = e.clientY - rect.top;

  const cellW = rect.width / gridCount;
  const cellH = rect.height / gridCount;

  const gridX = Math.floor(x / cellW);
  const gridY = Math.floor(y / cellH);

  // Bounds check
  if (gridX < 0 || gridX >= gridCount || gridY < 0 || gridY >= gridCount)
    return;

  if (isFilling) {
    if (e.type === "pointerdown") {
      floodFill(gridX, gridY);
    }
    return;
  }

  // Optimization: Don't redraw same cell in same drag event frame if logic determines it's redundant
  // However, for "progressive" mode, continuous holding might want to increase opacity?
  // Legacy script checked `target !== lastTouchedElement`.
  if (gridX === lastGridX && gridY === lastGridY) return;

  lastGridX = gridX;
  lastGridY = gridY;

  // Reset lastGrid on pointerup/out? No, just keep tracking.
  // Actually, we need to reset separate from this function.
  // For now, simple dedupe is enough.

  drawPixelLogic(gridX, gridY);
}

// Ensure we reset lastGridX/Y on pointer up to allow re-tapping same cell
document.addEventListener("pointerup", () => {
  lastGridX = -1;
  lastGridY = -1;
});

function floodFill(startX, startY) {
  const layer = layers[activeLayerIndex];
  if (!layer) return;

  const targetColorCell = layer.matrix[startY][startX];
  const targetColor =
    targetColorCell.percent > 0 ? targetColorCell.color : "transparent";
  const replacementColor = currentColor;

  if (targetColor === replacementColor && targetColorCell.percent === 100)
    return;

  const queue = [[startX, startY]];
  const seen = new Set();
  const strokesForUndo = [];
  const getHash = (x, y) => `${x},${y}`;

  while (queue.length > 0) {
    const [cx, cy] = queue.shift();
    const key = getHash(cx, cy);
    if (seen.has(key)) continue;
    seen.add(key);

    const cell = layer.matrix[cy][cx];
    const cColor = cell.percent > 0 ? cell.color : "transparent";

    if (cColor === targetColor) {
      strokesForUndo.push({
        x: cx,
        y: cy,
        prevColor: cell.color,
        prevPercent: cell.percent,
        newColor: replacementColor,
        newPercent: 100,
      });

      updateMatrixAndCanvas(layer, cx, cy, replacementColor, 100);

      if (cx > 0) queue.push([cx - 1, cy]);
      if (cx < gridCount - 1) queue.push([cx + 1, cy]);
      if (cy > 0) queue.push([cx, cy - 1]);
      if (cy < gridCount - 1) queue.push([cx, cy + 1]);
    }
  }

  if (strokesForUndo.length > 0) {
    historyStack.push({
      layerId: layer.id,
      strokes: strokesForUndo,
    });
    if (historyStack.length > MAX_HISTORY) historyStack.shift();
    updateLayerPreview(activeLayerIndex);
  }
}

function drawPixelLogic(x, y) {
  const layer = layers[activeLayerIndex];
  if (!layer || !layer.matrix[y] || !layer.matrix[y][x]) return;

  const cell = layer.matrix[y][x];

  // Record State for Undo
  const prevColor = cell.color;
  const prevPercent = cell.percent;

  // Logic from legacy changeColor
  if (isErasing) {
    if (cell.percent !== 0) {
      updateMatrixAndCanvas(layer, x, y, "transparent", 0);
      currentStroke.push({
        x,
        y,
        prevColor,
        prevPercent,
        newColor: "transparent",
        newPercent: 0,
      });
    }
    return;
  }

  let newColor = currentColor;
  let newPercent = 100; // Default instant

  if (drawingMode === "instant") {
    updateMatrixAndCanvas(layer, x, y, currentColor, 100);
    currentStroke.push({
      x,
      y,
      prevColor,
      prevPercent,
      newColor: currentColor,
      newPercent: 100,
    });
  } else {
    // Progressve
    let currentP = cell.percent;
    if (currentP < 100) {
      newPercent = currentP + 10;

      // Mixing Logic
      const baseR = cachedBaseColors.r;
      const baseG = cachedBaseColors.g;
      const baseB = cachedBaseColors.b;

      const targetR = cachedCurrentColorRGB.r;
      const targetG = cachedCurrentColorRGB.g;
      const targetB = cachedCurrentColorRGB.b;

      const mix = newPercent / 100;
      const mixedR = Math.round(baseR + (targetR - baseR) * mix) || 0;
      const mixedG = Math.round(baseG + (targetG - baseG) * mix) || 0;
      const mixedB = Math.round(baseB + (targetB - baseB) * mix) || 0;

      newColor = `rgb(${mixedR}, ${mixedG}, ${mixedB})`;

      updateMatrixAndCanvas(layer, x, y, newColor, newPercent);
      currentStroke.push({
        x,
        y,
        prevColor,
        prevPercent,
        newColor,
        newPercent,
      });
    }
  }
}

function updateMatrixAndCanvas(layer, x, y, color, percent) {
  // 1. Update Matrix
  layer.matrix[y][x] = { color, percent };

  // 2. Draw on Canvas
  const ctx = layer.ctx;
  const w = layer.canvas.width;
  const h = layer.canvas.height;
  const cellW = w / gridCount;
  const cellH = h / gridCount;

  // Clear Rect first (crucial for transparency or color changes)
  // We expand clear slightly to avoid artifacts? No, exact is fine for pixel art.
  // Use Math.floor/ceil to be safe with pixel boundaries.
  const px = Math.floor(x * cellW);
  const py = Math.floor(y * cellH);
  const pw = Math.ceil(cellW);
  const ph = Math.ceil(cellH);

  ctx.clearRect(px, py, pw, ph);

  if (percent > 0 && color !== "transparent") {
    ctx.fillStyle = color;
    ctx.fillRect(px, py, pw, ph);
  }
}

// --- UNDO / REDO ---

function undo() {
  if (historyStack.length === 0) return;

  const action = historyStack.pop();
  const layer = layers.find((l) => l.id === action.layerId);

  // If layer was deleted, we can't undo (classic simple implementation)
  // Or we handle it gracefully
  if (!layer) {
    console.warn("Cannot undo: Layer does not exist");
    return;
  }

  // Reverse strokes
  action.strokes.reverse().forEach((stroke) => {
    updateMatrixAndCanvas(
      layer,
      stroke.x,
      stroke.y,
      stroke.prevColor,
      stroke.prevPercent,
    );
  });

  // Update preview for the layer modified
  const idx = layers.findIndex((l) => l.id === action.layerId);
  if (idx !== -1) updateLayerPreview(idx);
}

// --- SAVE / LOAD ---

function saveDraft() {
  try {
    const savedLayers = layers.map((l) => {
      // Flatten matrix for serialization
      // Provide exact same data structure as legacy "data" array
      // array of objects: { color, percent }
      // Legacy was DOM querySelectorAll -> row by row.
      // Our matrix is row by row.
      const flatData = [];
      for (let y = 0; y < gridCount; y++) {
        for (let x = 0; x < gridCount; x++) {
          flatData.push(l.matrix[y][x]);
        }
      }
      return {
        name: l.name,
        data: flatData,
      };
    });

    // Generate Thumbnail using Compositing (Offscreen)
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = 100;
    thumbCanvas.height = 100;
    const tCtx = thumbCanvas.getContext("2d");
    const tCellSize = 100 / gridCount;

    // Background
    tCtx.fillStyle = getCSSVariable("--bg-cell") || "#fff";
    tCtx.fillRect(0, 0, 100, 100);

    // Draw Layers
    layers.forEach((l) => {
      for (let y = 0; y < gridCount; y++) {
        for (let x = 0; x < gridCount; x++) {
          const cell = l.matrix[y][x];
          if (cell.percent > 0) {
            tCtx.fillStyle = cell.color;
            tCtx.fillRect(
              x * tCellSize,
              y * tCellSize,
              tCellSize + 0.5,
              tCellSize + 0.5,
            );
          }
        }
      }
    });

    const thumbnail = thumbCanvas.toDataURL();

    const save = {
      id: Date.now(),
      version: 2,
      gridCount: gridCount,
      layers: savedLayers,
      thumbnail: thumbnail,
    };

    const saves = JSON.parse(localStorage.getItem("pixy_saves") || "[]");
    saves.unshift(save);
    if (saves.length > 20) saves.pop();
    localStorage.setItem("pixy_saves", JSON.stringify(saves));

    renderSavedDrawings();

    const btn = document.getElementById("saveDraftBtn");
    const originalText = btn.textContent;
    btn.textContent = "Saved!";
    setTimeout(() => (btn.textContent = originalText), 1000);
  } catch (e) {
    console.warn("Save failed", e);
    alert("Save failed: " + e.message);
  }
}

function loadDraft(save) {
  try {
    createGrid(save.gridCount);

    // If V2
    if (save.version === 2 && save.layers) {
      // Update Layer 0
      const l0Data = save.layers[0].data;
      loadLayerData(layers[0], l0Data);

      // Add subsequent
      for (let i = 1; i < save.layers.length; i++) {
        const newL = addLayer();
        loadLayerData(newL, save.layers[i].data);
      }
    } else if (save.data) {
      // V1 Legacy
      loadLayerData(layers[0], save.data);
    }
  } catch (e) {
    console.warn("Load failed", e);
  }
}

function loadLayerData(layer, dataArray) {
  // dataArray is flat list of {color, percent}
  // we need to map to matrix [y][x]

  // Reset Layer first
  const w = layer.canvas.width;
  const h = layer.canvas.height;
  layer.ctx.clearRect(0, 0, w, h);

  dataArray.forEach((cellData, i) => {
    const y = Math.floor(i / gridCount);
    const x = i % gridCount;
    if (y < gridCount && x < gridCount) {
      updateMatrixAndCanvas(
        layer,
        x,
        y,
        cellData.color,
        parseFloat(cellData.percent),
      );
    }
  });

  // Update preview
  updateLayerPreview(layers.indexOf(layer));
}

// --- THEMES & UI ---

// Same as legacy, but we need to ensure `applyTheme` calls `refreshThemeColors`
function applyTheme(themeObj) {
  // Check Premium Theme
  if (themeObj.isPremium && !isProUser) {
    showPaywall("This theme is for Pro users!");
    return;
  }

  for (const [key, value] of Object.entries(themeObj)) {
    document.documentElement.style.setProperty(key, value);
  }

  // Update Cache
  if (themeObj["--bg-cell"]) {
    cachedBaseColors = parseColorString(themeObj["--bg-cell"]);
  }

  // Refresh Canvas Grid
  refreshThemeColors();
}

// --- PAYMENT SYSTEM ---

async function initPaymentSystem() {
  // Mobile: use RevenueCat
  if (
    window.Capacitor?.Plugins?.Purchases
  ) {
    initRevenueCat();
    return;
  }

  // Web: use LemonSqueezy license key
  const storedKey = localStorage.getItem(LICENSE_KEY_STORAGE);
  if (storedKey) {
    await validateLicense(storedKey);
  }

  // Load LemonSqueezy.js for overlay checkout
  if (!document.getElementById("lemonsqueezy-js")) {
    const script = document.createElement("script");
    script.id = "lemonsqueezy-js";
    script.src = "https://app.lemonsqueezy.com/js/lemon.js";
    script.defer = true;
    document.head.appendChild(script);
  }

  // Wire up web paywall buttons
  document.getElementById("purchaseLifetimeBtn")?.addEventListener("click", () => {
    trackEvent("checkout_started", { plan: "lifetime" });
    openCheckout(LEMON_CHECKOUT_LIFETIME);
  });

  document.getElementById("purchaseMonthlyBtn")?.addEventListener("click", () => {
    trackEvent("checkout_started", { plan: "monthly" });
    openCheckout(LEMON_CHECKOUT_MONTHLY);
  });

  document.getElementById("activateLicenseBtn")?.addEventListener("click", async () => {
    const input = document.getElementById("licenseKeyInput");
    const key = input?.value?.trim();
    if (!key) {
      alert("Please enter your license key.");
      return;
    }
    await validateLicense(key);
    if (isProUser) {
      alert("Pro activated! Enjoy Pixy Pro.");
    } else {
      alert("Invalid or expired license key.");
    }
  });
}

async function validateLicense(key) {
  try {
    const resp = await fetch("/api/validate-license", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ license_key: key }),
    });
    const data = await resp.json();

    if (data.valid) {
      isProUser = true;
      localStorage.setItem(LICENSE_KEY_STORAGE, key);
      localStorage.setItem(LICENSE_VALIDATED_STORAGE, String(Date.now()));
      updateProUI();
      hideAllAds();
      trackEvent("purchase_completed", { method: "license_key" });
    } else {
      localStorage.removeItem(LICENSE_KEY_STORAGE);
      localStorage.removeItem(LICENSE_VALIDATED_STORAGE);
      isProUser = false;
      updateProUI();
    }
  } catch {
    // Offline fallback: trust cached key within grace period
    const lastValidated = localStorage.getItem(LICENSE_VALIDATED_STORAGE);
    if (
      lastValidated &&
      Date.now() - parseInt(lastValidated) < OFFLINE_GRACE_DAYS * 24 * 60 * 60 * 1000
    ) {
      isProUser = true;
      updateProUI();
      hideAllAds();
    }
  }
}

function openCheckout(checkoutUrl) {
  // LemonSqueezy overlay checkout (stays on your domain)
  if (window.createLemonSqueezy) {
    window.createLemonSqueezy();
  }
  if (window.LemonSqueezy?.Url?.Open) {
    window.LemonSqueezy.Url.Open(checkoutUrl + "?embed=1");
  } else {
    // Fallback: open in new tab
    window.open(checkoutUrl, "_blank");
  }
}

// Listen for LemonSqueezy checkout success (postMessage from overlay)
window.addEventListener("message", (event) => {
  if (event.data?.event === "Checkout.Success") {
    const licenseKey = event.data?.data?.order?.first_order_item?.license_key;
    if (licenseKey) {
      validateLicense(licenseKey);
    }
  }
});

// --- REVENUECAT (MOBILE ONLY) ---

async function initRevenueCat() {
  const { Purchases } = window.Capacitor.Plugins;

  try {
    const platform = (await window.Capacitor.Plugins.Device?.getInfo())
      ?.platform;

    let apiKey = "";
    if (platform === "ios") apiKey = API_KEY_IOS;
    else if (platform === "android") apiKey = API_KEY_ANDROID;

    if (apiKey) {
      await Purchases.configure({ apiKey });
      await checkProStatus();
    }

    Purchases.addListener("purchasesReceived", (info) => {
      handleCustomerInfo(info.customerInfo);
    });
  } catch (e) {
    console.error("RC Init Failed", e);
  }
}

async function checkProStatus() {
  try {
    const { Purchases } = window.Capacitor.Plugins;
    const info = await Purchases.getCustomerInfo();
    handleCustomerInfo(info.customerInfo);
  } catch (e) {
    console.warn("Check Pro Status failed", e);
  }
}

function handleCustomerInfo(customerInfo) {
  const entitlements = customerInfo.entitlements.active;
  isProUser = !!entitlements[ENTITLEMENT_ID];
  updateProUI();
  if (isProUser) hideAllAds();
}

// --- PRO UI ---

function updateProUI() {
  const badge = document.getElementById("proBadge");
  if (badge) {
    if (isProUser) badge.classList.remove("hidden");
    else badge.classList.add("hidden");
  }

  // Close paywall if open and user just bought
  if (isProUser) {
    document.getElementById("paywallModal").classList.remove("show");
  }
}

function showPaywall(msg) {
  const modal = document.getElementById("paywallModal");
  modal.classList.add("show");
  if (msg) document.querySelector(".paywall-title").innerText = msg;
  trackEvent("paywall_shown", { trigger: msg || "unknown" });
}

document.querySelector(".close-paywall")?.addEventListener("click", () => {
  document.getElementById("paywallModal").classList.remove("show");
  trackEvent("paywall_dismissed");
});

document
  .getElementById("restorePurchasesBtn")
  ?.addEventListener("click", async () => {
    // Mobile: RevenueCat restore
    if (window.Capacitor?.Plugins?.Purchases) {
      try {
        const { Purchases } = window.Capacitor.Plugins;
        const { customerInfo } = await Purchases.restorePurchases();
        handleCustomerInfo(customerInfo);

        if (customerInfo.entitlements.active[ENTITLEMENT_ID]) {
          alert("Purchases restored!");
        } else {
          alert("No Pro subscription found.");
        }
      } catch (e) {
        alert("Restore failed: " + e.message);
      }
    }
  });

// --- ADS MANAGEMENT ---

function initAds() {
  if (isProUser) {
    hideAllAds();
    return;
  }

  try {
    const adUnits = document.querySelectorAll(".adsbygoogle");
    adUnits.forEach(() => {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    });
    trackEvent("ad_impression");
  } catch (e) {
    console.warn("Ad init failed", e);
  }
}

function hideAllAds() {
  document.querySelectorAll(".ad-container").forEach((el) => {
    el.style.display = "none";
  });
}

function showExportInterstitial(callback) {
  if (isProUser) {
    callback();
    return;
  }

  let exportCount = parseInt(localStorage.getItem("pixy_export_count") || "0");
  exportCount++;
  localStorage.setItem("pixy_export_count", String(exportCount));

  // Show interstitial every 3rd export
  if (exportCount % 3 !== 0) {
    callback();
    return;
  }

  // Create overlay
  const overlay = document.createElement("div");
  overlay.className = "ad-interstitial-overlay";
  overlay.innerHTML = `
    <div class="ad-interstitial-content">
      <p class="ad-interstitial-label">Your download will begin shortly...</p>
      <div class="ad-interstitial-slot">
        <ins class="adsbygoogle"
          style="display:block"
          data-ad-client="ca-pub-XXXXXXX"
          data-ad-slot="XXXXXXX"
          data-ad-format="rectangle"></ins>
      </div>
      <button class="ad-interstitial-skip" id="adSkipBtn" disabled>Skip in <span id="adCountdown">5</span>s</button>
      <p class="ad-interstitial-upgrade" onclick="showPaywall('Remove ads with Pixy Pro')">or upgrade to Pro</p>
    </div>
  `;
  document.body.appendChild(overlay);

  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch (e) {
    console.warn("Interstitial ad failed", e);
  }

  let countdown = 5;
  const countdownEl = overlay.querySelector("#adCountdown");
  const skipBtn = overlay.querySelector("#adSkipBtn");

  const timer = setInterval(() => {
    countdown--;
    if (countdownEl) countdownEl.textContent = countdown;
    if (countdown <= 0) {
      clearInterval(timer);
      skipBtn.disabled = false;
      skipBtn.textContent = "Continue";
    }
  }, 1000);

  skipBtn.addEventListener("click", () => {
    overlay.remove();
    callback();
  });

  trackEvent("ad_impression", { type: "interstitial" });
}

// --- ANALYTICS ---

function trackEvent(eventName, params) {
  if (typeof gtag === "function") {
    gtag("event", eventName, params);
  }
}

// --- HELPER FUNCS ---

function hexToRgb(hex) {
  var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, function (m, r, g, b) {
    return r + r + g + g + b + b;
  });

  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

function parseColorString(colorStr) {
  const dummy = document.createElement("div");
  dummy.style.color = colorStr;
  dummy.style.display = "none";
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

// --- EXPORT ---

function showHdExportDialog() {
  const overlay = document.createElement("div");
  overlay.className = "ad-interstitial-overlay";
  overlay.innerHTML = `
    <div class="ad-interstitial-content" style="max-width:300px">
      <h3 style="margin:0 0 12px;font-family:'VT323',monospace;font-size:24px">HD EXPORT</h3>
      <p style="font-size:14px;opacity:0.7;margin:0 0 16px">Choose export resolution:</p>
      <div style="display:flex;flex-direction:column;gap:8px;width:100%">
        <button class="paywall-btn" onclick="this.closest('.ad-interstitial-overlay').remove();exportCanvas(false,false,2)">2x (${gridCount*2}px)</button>
        <button class="paywall-btn" onclick="this.closest('.ad-interstitial-overlay').remove();exportCanvas(false,false,4)">4x (${gridCount*4}px)</button>
        <button class="paywall-btn highlight" onclick="this.closest('.ad-interstitial-overlay').remove();exportCanvas(false,false,8)">8x (${gridCount*8}px)</button>
        <button class="restore-btn" onclick="this.closest('.ad-interstitial-overlay').remove()">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function exportCanvas(isTransparent, isClipboard, scale) {
  const canvas = document.createElement("canvas");
  const size = scale ? gridCount * scale : 1048;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cellSize = size / gridCount;

  if (!isTransparent) {
    // Fill BG
    // We use Container BG or Cell BG? Usually Pixel art export implies the art itself.
    // Legacy: "ctx.fillStyle = containerStyle.backgroundColor"
    // Let's stick to simple Background color from Theme
    ctx.fillStyle = getCSSVariable("--bg-cell");
    ctx.fillRect(0, 0, size, size);
  }

  // Draw all layers
  layers.forEach((l) => {
    if (!l.visible) return; // Should we respect visibility? Yes.

    for (let y = 0; y < gridCount; y++) {
      for (let x = 0; x < gridCount; x++) {
        const cell = l.matrix[y][x];
        if (cell.percent > 0) {
          ctx.fillStyle = cell.color;
          ctx.fillRect(x * cellSize, y * cellSize, cellSize + 1, cellSize + 1);
        }
      }
    }
  });

  if (isClipboard) {
    const dataURL = canvas.toDataURL("image/png");
    copyToClipboard(dataURL);
  } else {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `pixy-${timestamp}.png`;
    canvas.toBlob((blob) => {
      if (blob) shareFile(blob, filename);
    });
  }
}

async function exportStickerToPhotos() {
  // Same as exportCanvas(true) basically
  const canvas = document.createElement("canvas");
  const size = 1048;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cellSize = size / gridCount;

  layers.forEach((l) => {
    for (let y = 0; y < gridCount; y++) {
      for (let x = 0; x < gridCount; x++) {
        const cell = l.matrix[y][x];
        if (cell.percent > 0) {
          ctx.fillStyle = cell.color;
          // +1 overlaps to prevent subpixel gaps
          ctx.fillRect(x * cellSize, y * cellSize, cellSize + 1, cellSize + 1);
        }
      }
    }
  });

  const dataURL = canvas.toDataURL("image/png");

  if (window.Capacitor?.Plugins?.Media) {
    try {
      await window.Capacitor.Plugins.Media.savePhoto({ path: dataURL });
      alert("Saved to Gallery");
    } catch (e) {
      alert("Error: " + e.message);
    }
  } else {
    const link = document.createElement("a");
    link.download = "pixy-sticker.png";
    link.href = dataURL;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// --- PROJECT EXPORT/IMPORT ---

async function exportProject() {
  try {
    const savedLayers = layers.map((l) => {
      const flatData = [];
      for (let y = 0; y < gridCount; y++) {
        for (let x = 0; x < gridCount; x++) {
          flatData.push(l.matrix[y][x]);
        }
      }
      return {
        name: l.name,
        data: flatData,
      };
    });

    const project = {
      version: 2,
      gridCount: gridCount,
      layers: savedLayers,
      exportedAt: new Date().toISOString(),
    };

    const jsonStr = JSON.stringify(project);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const filename = `pixy-project-${timestamp}.pixy`;

    const triggerDownload = () => {
      const link = document.createElement("a");
      link.download = filename;
      link.href = URL.createObjectURL(blob);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    // Use native share if available, successfully
    let shared = false;
    if (
      navigator.share &&
      navigator.canShare &&
      navigator.canShare({ files: [new File([blob], filename)] })
    ) {
      try {
        await navigator.share({
          files: [new File([blob], filename, { type: "application/json" })],
          title: "Pixy Project",
        });
        shared = true;
      } catch (e) {
        // Ignore AbortError (user cancelled), fallback for others if needed
        if (e.name !== "AbortError") {
          console.warn("Share failed, falling back to download", e);
          triggerDownload();
        }
        return; // Don't trigger download below if we tried sharing
      }
    }

    if (!shared) {
      triggerDownload();
    }

    // Visual feedback
    const btn = document.getElementById("exportProjectBtn");
    if (btn) {
      const originalText = btn.textContent;
      btn.textContent = "Exported!";
      setTimeout(() => (btn.textContent = originalText), 1500);
    }
  } catch (e) {
    console.error("Export project failed:", e);
    alert("Export failed: " + e.message);
  }
}

function importProject(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const project = JSON.parse(e.target.result);

      // Validate structure
      if (!project.version || !project.gridCount || !project.layers) {
        throw new Error("Invalid project file format");
      }

      // Use existing loadDraft function
      loadDraft(project);

      // Close the saved modal if open
      const savedProjectsModal = document.getElementById("savedProjectsModal");
      if (savedProjectsModal) savedProjectsModal.classList.remove("active");

      // Visual feedback
      alert("Project imported successfully!");
    } catch (err) {
      console.error("Import project failed:", err);
      alert("Import failed: " + err.message);
    }
  };

  reader.readAsText(file);
}

// --- BOILERPLATE FOR UI (Re-paste of legacy UI logic for buttons) ---
// I need to ensure all UI bindings from legacy script are present.

// Layers UI
const layersListEl = document.getElementById("layersList");
function renderLayerList() {
  if (!layersListEl) return;
  layersListEl.innerHTML = "";

  // Reverse order
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const item = document.createElement("div");
    item.classList.add("layer-item");
    if (i === activeLayerIndex) item.classList.add("active");

    const img = document.createElement("img");
    img.classList.add("layer-preview");
    img.src =
      layer.previewDataUrl ||
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    item.appendChild(img);

    item.onclick = () => setActiveLayer(i);
    layersListEl.appendChild(item);
  }
}

const addLayerBtn = document.getElementById("addLayerBtn");
if (addLayerBtn) addLayerBtn.addEventListener("click", addLayer);

const deleteLayerBtn = document.getElementById("deleteLayerBtn");
if (deleteLayerBtn) deleteLayerBtn.addEventListener("click", deleteLayer);

const moveLayerUpBtn = document.getElementById("moveLayerUpBtn");
if (moveLayerUpBtn) moveLayerUpBtn.addEventListener("click", moveLayerUp);

const moveLayerDownBtn = document.getElementById("moveLayerDownBtn");
if (moveLayerDownBtn) moveLayerDownBtn.addEventListener("click", moveLayerDown);

const layersPanel = document.getElementById("layersPanel");
const layersBtn = document.getElementById("layersBtn");
const closeLayersBtn = document.getElementById("closeLayersBtn");

if (layersBtn) {
  layersBtn.onclick = () => {
    layersPanel.classList.toggle("hidden");
    layersPanel.classList.toggle("active");
  };
}
if (closeLayersBtn) {
  closeLayersBtn.onclick = () => {
    layersPanel.classList.add("hidden");
    layersPanel.classList.remove("active");
  };
}

// Eraser
const eraserBtn = document.getElementById("eraserBtn");
if (eraserBtn) {
  eraserBtn.onclick = () => {
    isErasing = !isErasing;
    isFilling = false;
    eraserBtn.classList.toggle("active");
    const fillBtn = document.getElementById("fillBtn");
    if (fillBtn) fillBtn.classList.remove("active");

    // Update cursor
    if (container) {
      container.classList.remove("cursor-fill");
      if (isErasing) {
        container.classList.add("cursor-eraser");
      } else {
        container.classList.remove("cursor-eraser");
      }
    }
  };
}

// Fill
const fillBtn = document.getElementById("fillBtn");
if (fillBtn) {
  fillBtn.onclick = () => {
    isFilling = !isFilling;
    isErasing = false;
    fillBtn.classList.toggle("active");
    if (eraserBtn) eraserBtn.classList.remove("active");

    // Update cursor
    if (container) {
      container.classList.remove("cursor-eraser");
      if (isFilling) {
        container.classList.add("cursor-fill");
      } else {
        container.classList.remove("cursor-fill");
      }
    }
  };
}

// Save
const saveDraftBtn = document.getElementById("saveDraftBtn");
if (saveDraftBtn) saveDraftBtn.addEventListener("click", saveDraft);

// Undo
const undoBtn = document.getElementById("undoBtn");
if (undoBtn) undoBtn.onclick = undo;

// Reset
function resetCanvas() {
  // Clear all layers
  layers.forEach((l) => {
    l.matrix.forEach((row) => {
      row.forEach((c) => {
        c.color = "transparent";
        c.percent = 0;
      });
    });
    l.ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
    updateLayerPreview(layers.indexOf(l));
  });
  historyStack = [];
}

const resetBtn = document.getElementById("resetBtn");
if (resetBtn) {
  resetBtn.addEventListener("click", resetCanvas);
}

function toggleEraser() {
  const eraserBtn = document.getElementById("eraserBtn");
  const fillBtn = document.getElementById("fillBtn");

  isErasing = !isErasing;

  if (isErasing) {
    // Activated Eraser
    if (eraserBtn) eraserBtn.classList.add("active");

    // Disable Fill
    isFilling = false;
    if (fillBtn) fillBtn.classList.remove("active");

    // Update cursor
    if (container) {
      container.classList.remove("cursor-fill");
      container.classList.add("cursor-eraser");
    }
  } else {
    // Deactivated Eraser (Back to Brush)
    if (eraserBtn) eraserBtn.classList.remove("active");

    // Reset cursor
    if (container) {
      container.classList.remove("cursor-eraser");
    }
  }
}

// Native Hardware Event Listener (iOS/Android)
window.addEventListener("pencilDoubleTap", () => {
  console.log("Hardware Double Tap Detected");
  toggleEraser();
});

// Cell Count
const changeGridNumberBtn = document.getElementById("changeGridNumber");
const cellCountPanel = document.getElementById("cellCountPanel");
const cellSlider = document.getElementById("cellSlider");
const cellNumberInput = document.getElementById("cellNumberInput");
const applyCellCountBtn = document.getElementById("applyCellCount");

function toggleCellCountPanel() {
  cellCountPanel.classList.toggle("hidden");
  document.body.classList.toggle("cell-panel-open");
}

if (changeGridNumberBtn) {
  changeGridNumberBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleCellCountPanel();
  });
}
if (cellCountPanel) {
  cellCountPanel.addEventListener("click", (e) => e.stopPropagation());

  cellSlider.oninput = () => {
    cellNumberInput.value = cellSlider.value;
  };

  cellNumberInput.oninput = () => {
    let val = parseInt(cellNumberInput.value) || 1;
    if (val < 1) val = 1;
    if (val > 100) val = 100;
    cellSlider.value = val;
  };

  applyCellCountBtn.onclick = () => {
    let gridNumber = parseInt(cellNumberInput.value) || 16;
    createGrid(gridNumber);
    toggleCellCountPanel();
  };

  // Presets Logic
  const presetMarks = cellCountPanel.querySelectorAll(".preset-mark");

  function updateActivePreset() {
    const currentVal = parseInt(cellSlider.value);
    presetMarks.forEach((p) => {
      const pVal = parseInt(p.dataset.val);
      if (pVal === currentVal) {
        p.classList.add("active");
      } else {
        p.classList.remove("active");
      }
    });
  }

  presetMarks.forEach((preset) => {
    preset.onclick = (e) => {
      e.stopPropagation();
      const val = parseInt(preset.dataset.val);
      if (val) {
        cellSlider.value = val;
        cellNumberInput.value = val;
        updateActivePreset();
      }
    };
  });

  cellSlider.addEventListener("input", updateActivePreset);
  updateActivePreset(); // Initialize on load
}

// Saved Modal stuff
const savedProjectsModal = document.getElementById("savedProjectsModal");
const openSavedBtn = document.getElementById("openSavedBtn");
if (openSavedBtn) {
  openSavedBtn.addEventListener("click", (e) => {
    e.preventDefault();
    savedProjectsModal.classList.toggle("active");
    renderSavedDrawings();
  });
}
const closeSavedBtn = document.querySelector(".close-saved-btn");
if (closeSavedBtn) {
  closeSavedBtn.onclick = () => savedProjectsModal.classList.remove("active");
}

// Theme Constants & Logic to hydrate menu
// (Copying defaultThemes object from legacy script is necessary for menu to work)
const defaultThemes = {
  poolsuite: {
    name: "Retro OS (Default)",
    id: "poolsuite",
    colors: {
      "--bg-main": "#ffdad5",
      "--bg-container": "#fff8f0",
      "--bg-cell": "#ffffff",
      "--border-cell": "rgba(0, 0, 0, 0.1)",
      "--text-main": "#000000",
      "--btn-bg": "#ececec",
      "--btn-text": "#000000",
      "--btn-border": "#000000",
      "--btn-hover": "#ffffff",
      "--btn-active-bg": "#000000",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#000000",
    },
  },
  dark: {
    name: "Dark (Classic)",
    id: "dark",
    colors: {
      "--bg-main": "rgb(48, 48, 48)",
      "--bg-container": "#222",
      "--bg-cell": "#333333",
      "--border-cell": "rgba(255, 255, 255, 0.1)",
      "--text-main": "white",
      "--btn-bg": "rgb(81, 81, 81)",
      "--btn-text": "white",
      "--btn-border": "rgb(120, 120, 120)",
      "--btn-hover": "rgb(90, 90, 90)",
      "--btn-active-bg": "white",
      "--btn-active-text": "black",
      "--btn-hover-text": "white",
    },
  },
  retroLight: {
    name: "Light (Retro)",
    id: "retroLight",
    colors: {
      "--bg-main": "#f0f0f0",
      "--bg-container": "#ffffff",
      "--bg-cell": "#e0e0e0",
      "--border-cell": "rgba(0, 0, 0, 0.1)",
      "--text-main": "#333333",
      "--btn-bg": "#ffffff",
      "--btn-text": "#333333",
      "--btn-border": "#cccccc",
      "--btn-hover": "#e6e6e6",
      "--btn-active-bg": "#333333",
      "--btn-active-text": "white",
      "--btn-hover-text": "#333333",
    },
  },
  mac: {
    name: "Mac Classic",
    id: "mac",
    colors: {
      "--bg-main": "#ffffff",
      "--bg-container": "#e0e0e0",
      "--bg-cell": "#aaaaaa",
      "--border-cell": "rgba(0, 0, 0, 0.2)",
      "--text-main": "#000000",
      "--btn-bg": "#ffffff",
      "--btn-text": "#000000",
      "--btn-border": "#000000",
      "--btn-hover": "#cccccc",
      "--btn-active-bg": "#000000",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#000000",
    },
  },
  windows95: {
    name: "Windows 95",
    id: "windows95",
    colors: {
      "--bg-main": "#008080",
      "--bg-container": "#c0c0c0",
      "--bg-cell": "#ffffff",
      "--border-cell": "rgba(0, 0, 0, 0.2)",
      "--text-main": "#000000",
      "--btn-bg": "#c0c0c0",
      "--btn-text": "#000000",
      "--btn-border": "#000000",
      "--btn-hover": "#dfdfdf",
      "--btn-active-bg": "#000080",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#000000",
    },
  },
  cga: {
    name: "CGA",
    id: "cga",
    colors: {
      "--bg-main": "#000000",
      "--bg-container": "#555555",
      "--bg-cell": "#AA00AA",
      "--border-cell": "rgba(255, 85, 255, 0.2)",
      "--text-main": "#55FFFF",
      "--btn-bg": "#FF55FF",
      "--btn-text": "#FFFFFF",
      "--btn-border": "#FFFFFF",
      "--btn-hover": "#AA00AA",
      "--btn-active-bg": "#55FFFF",
      "--btn-active-text": "#000000",
      "--btn-hover-text": "#FFFFFF",
    },
  },
  vaporwave: {
    name: "Vaporwave",
    id: "vaporwave",
    colors: {
      "--bg-main": "#ff71ce",
      "--bg-container": "#01cdfe",
      "--bg-cell": "#05ffa1",
      "--border-cell": "rgba(255, 113, 206, 0.2)",
      "--text-main": "#b967ff",
      "--btn-bg": "#fffb96",
      "--btn-text": "#01cdfe",
      "--btn-border": "#b967ff",
      "--btn-hover": "#ff71ce",
      "--btn-active-bg": "#05ffa1",
      "--btn-active-text": "#000000",
      "--btn-hover-text": "#ffffff",
    },
  },
  blueprint: {
    name: "Blueprint",
    id: "blueprint",
    colors: {
      "--bg-main": "#2a4b8d",
      "--bg-container": "#3659a2",
      "--bg-cell": "#1e3768",
      "--border-cell": "rgba(255, 255, 255, 0.1)",
      "--text-main": "#ffffff",
      "--btn-bg": "#3659a2",
      "--btn-text": "#ffffff",
      "--btn-border": "#6ba4ff",
      "--btn-hover": "#4a75c7",
      "--btn-active-bg": "#ffffff",
      "--btn-active-text": "#2a4b8d",
      "--btn-hover-text": "#ffffff",
    },
  },
  sepia: {
    name: "Sepia",
    id: "sepia",
    colors: {
      "--bg-main": "#704214",
      "--bg-container": "#d2b48c",
      "--bg-cell": "#654321",
      "--border-cell": "rgba(0, 0, 0, 0.3)",
      "--text-main": "#3e2723",
      "--btn-bg": "#d2b48c",
      "--btn-text": "#3e2723",
      "--btn-border": "#3e2723",
      "--btn-hover": "#c19a6b",
      "--btn-active-bg": "#3e2723",
      "--btn-active-text": "#d2b48c",
      "--btn-hover-text": "#3e2723",
    },
  },
  terminator: {
    name: "Terminator",
    id: "terminator",
    colors: {
      "--bg-main": "#000000",
      "--bg-container": "#1a0505",
      "--bg-cell": "#1a1a1a",
      "--border-cell": "rgba(255, 0, 0, 0.3)",
      "--text-main": "#ff0000",
      "--btn-bg": "#330000",
      "--btn-text": "#ff0000",
      "--btn-border": "#ff0000",
      "--btn-hover": "#660000",
      "--btn-active-bg": "#ff0000",
      "--btn-active-text": "#000000",
      "--btn-hover-text": "#ffffff",
    },
  },
  ocean: {
    name: "Ocean",
    id: "ocean",
    colors: {
      "--bg-main": "#1a4b6e",
      "--bg-container": "#133854",
      "--bg-cell": "#0f2d44",
      "--border-cell": "rgba(186, 230, 253, 0.1)",
      "--text-main": "#bae6fd",
      "--btn-bg": "#0ea5e9",
      "--btn-text": "white",
      "--btn-border": "#0284c7",
      "--btn-hover": "#0284c7",
      "--btn-active-bg": "#bae6fd",
      "--btn-active-text": "#0f2d44",
      "--btn-hover-text": "white",
    },
  },
  forest: {
    name: "Forest",
    id: "forest",
    colors: {
      "--bg-main": "#2c3e38",
      "--bg-container": "#1b2925",
      "--bg-cell": "#121f1b",
      "--border-cell": "rgba(216, 245, 229, 0.1)",
      "--text-main": "#d8f5e5",
      "--btn-bg": "#4a7c68",
      "--btn-text": "#e0f2eb",
      "--btn-border": "#365c4d",
      "--btn-hover": "#59917a",
      "--btn-active-bg": "#d8f5e5",
      "--btn-active-text": "#1b2925",
      "--btn-hover-text": "#e0f2eb",
    },
  },
  sunset: {
    name: "Sunset",
    id: "sunset",
    colors: {
      "--bg-main": "#4a2c3a",
      "--bg-container": "#2e1a23",
      "--bg-cell": "#1f1118",
      "--border-cell": "rgba(255, 214, 186, 0.1)",
      "--text-main": "#ffd6ba",
      "--btn-bg": "#c45b5b",
      "--btn-text": "#fff0e6",
      "--btn-border": "#a64545",
      "--btn-hover": "#d97070",
      "--btn-active-bg": "#ffd6ba",
      "--btn-active-text": "#4a2c3a",
      "--btn-hover-text": "#fff0e6",
    },
  },
  lavender: {
    name: "Lavender",
    id: "lavender",
    colors: {
      "--bg-main": "#e6e6fa",
      "--bg-container": "#f8f8ff",
      "--bg-cell": "#dcdcdc",
      "--border-cell": "rgba(72, 61, 139, 0.1)",
      "--text-main": "#483d8b",
      "--btn-bg": "#9370db",
      "--btn-text": "white",
      "--btn-border": "#7b68ee",
      "--btn-hover": "#8a2be2",
      "--btn-active-bg": "#483d8b",
      "--btn-active-text": "white",
      "--btn-hover-text": "white",
    },
  },
  dracula: {
    name: "Dracula",
    id: "dracula",
    colors: {
      "--bg-main": "#282a36",
      "--bg-container": "#44475a",
      "--bg-cell": "#6272a4",
      "--border-cell": "rgba(189, 147, 249, 0.3)",
      "--text-main": "#f8f8f2",
      "--btn-bg": "#bd93f9",
      "--btn-text": "#282a36",
      "--btn-border": "#6272a4",
      "--btn-hover": "#ff79c6",
      "--btn-active-bg": "#f8f8f2",
      "--btn-active-text": "#282a36",
      "--btn-hover-text": "#282a36",
    },
  },
  solarizedLight: {
    name: "Solarized Light",
    id: "solarizedLight",
    colors: {
      "--bg-main": "#fdf6e3",
      "--bg-container": "#eee8d5",
      "--bg-cell": "#93a1a1",
      "--border-cell": "rgba(0, 0, 0, 0.1)",
      "--text-main": "#657b83",
      "--btn-bg": "#b58900",
      "--btn-text": "#fdf6e3",
      "--btn-border": "#93a1a1",
      "--btn-hover": "#cb4b16",
      "--btn-active-bg": "#073642",
      "--btn-active-text": "#839496",
      "--btn-hover-text": "#fdf6e3",
    },
  },
  nord: {
    name: "Nord",
    id: "nord",
    colors: {
      "--bg-main": "#2e3440",
      "--bg-container": "#3b4252",
      "--bg-cell": "#434c5e",
      "--border-cell": "rgba(143, 188, 187, 0.2)",
      "--text-main": "#d8dee9",
      "--btn-bg": "#88c0d0",
      "--btn-text": "#2e3440",
      "--btn-border": "#81a1c1",
      "--btn-hover": "#5e81ac",
      "--btn-active-bg": "#eceff4",
      "--btn-active-text": "#2e3440",
      "--btn-hover-text": "#2e3440",
    },
  },
  monokai: {
    name: "Monokai",
    id: "monokai",
    colors: {
      "--bg-main": "#272822",
      "--bg-container": "#3e3d32",
      "--bg-cell": "#75715e",
      "--border-cell": "rgba(255, 255, 255, 0.1)",
      "--text-main": "#f8f8f2",
      "--btn-bg": "#a6e22e",
      "--btn-text": "#272822",
      "--btn-border": "#f92672",
      "--btn-hover": "#66d9ef",
      "--btn-active-bg": "#ae81ff",
      "--btn-active-text": "#f8f8f2",
      "--btn-hover-text": "#272822",
    },
  },
  synthwave: {
    name: "Synthwave '84",
    id: "synthwave",
    isPremium: true,
    colors: {
      "--bg-main": "#2b213a",
      "--bg-container": "#241b2f",
      "--bg-cell": "#090b20",
      "--border-cell": "rgba(255, 0, 212, 0.2)",
      "--text-main": "#fffb96",
      "--btn-bg": "#01cdfe",
      "--btn-text": "#000000",
      "--btn-border": "#05ffa1",
      "--btn-hover": "#b967ff",
      "--btn-active-bg": "#ff71ce",
      "--btn-active-text": "#2b213a",
      "--btn-hover-text": "#2b213a",
    },
  },
  matrix: {
    name: "The Matrix",
    id: "matrix",
    colors: {
      "--bg-main": "#000000",
      "--bg-container": "#0d110d",
      "--bg-cell": "#002200",
      "--border-cell": "rgba(0, 255, 0, 0.1)",
      "--text-main": "#00ff00",
      "--btn-bg": "#003b00",
      "--btn-text": "#00ff00",
      "--btn-border": "#00ff00",
      "--btn-hover": "#008f11",
      "--btn-active-bg": "#00ff00",
      "--btn-active-text": "#000000",
      "--btn-hover-text": "#000000",
    },
  },
  dos: {
    name: "MS-DOS",
    id: "dos",
    colors: {
      "--bg-main": "#000084",
      "--bg-container": "#0000a8",
      "--bg-cell": "#000084",
      "--border-cell": "rgba(255, 255, 255, 0.2)",
      "--text-main": "#ffffff",
      "--btn-bg": "#aaaaaa",
      "--btn-text": "#000000",
      "--btn-border": "#ffffff",
      "--btn-hover": "#ffffff",
      "--btn-active-bg": "#000084",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#000084",
    },
  },
  gruvbox: {
    name: "Gruvbox",
    id: "gruvbox",
    colors: {
      "--bg-main": "#282828",
      "--bg-container": "#3c3836",
      "--bg-cell": "#504945",
      "--border-cell": "rgba(235, 219, 178, 0.1)",
      "--text-main": "#ebdbb2",
      "--btn-bg": "#d65d0e",
      "--btn-text": "#282828",
      "--btn-border": "#fabd2f",
      "--btn-hover": "#fe8019",
      "--btn-active-bg": "#ebdbb2",
      "--btn-active-text": "#282828",
      "--btn-hover-text": "#282828",
    },
  },
  ubuntu: {
    name: "Ubuntu",
    id: "ubuntu",
    colors: {
      "--bg-main": "#300a24",
      "--bg-container": "#4a1c38",
      "--bg-cell": "#5e2750",
      "--border-cell": "rgba(221, 72, 20, 0.2)",
      "--text-main": "#ffffff",
      "--btn-bg": "#e95420",
      "--btn-text": "#ffffff",
      "--btn-border": "#77216f",
      "--btn-hover": "#c74312",
      "--btn-active-bg": "#ffffff",
      "--btn-active-text": "#e95420",
      "--btn-hover-text": "#ffffff",
    },
  },
  highContrast: {
    name: "High Contrast",
    id: "highContrast",
    colors: {
      "--bg-main": "#000000",
      "--bg-container": "#ffffff",
      "--bg-cell": "#000000",
      "--border-cell": "rgba(255, 255, 255, 0.4)",
      "--text-main": "#ffff00",
      "--btn-bg": "#0000ff",
      "--btn-text": "#ffffff",
      "--btn-border": "#ffff00",
      "--btn-hover": "#ffff00",
      "--btn-active-bg": "#ffffff",
      "--btn-active-text": "#000000",
      "--btn-hover-text": "#000000",
    },
  },
  hotdogStand: {
    name: "Hotdog Stand",
    id: "hotdogStand",
    colors: {
      "--bg-main": "#ff0000",
      "--bg-container": "#ffff00",
      "--bg-cell": "#ffcccc",
      "--border-cell": "rgba(0, 0, 0, 0.1)",
      "--text-main": "#000000",
      "--btn-bg": "#ffffff",
      "--btn-text": "#000000",
      "--btn-border": "#000000",
      "--btn-hover": "#ffff00",
      "--btn-active-bg": "#ff0000",
      "--btn-active-text": "#ffff00",
      "--btn-hover-text": "#000000",
    },
  },
  paper: {
    name: "Paper",
    id: "paper",
    colors: {
      "--bg-main": "#fdfbf7",
      "--bg-container": "#ffffff",
      "--bg-cell": "#ffffff",
      "--border-cell": "rgba(74, 144, 226, 0.2)",
      "--text-main": "#333333",
      "--btn-bg": "#ffffff",
      "--btn-text": "#333333",
      "--btn-border": "#333333",
      "--btn-hover": "#f0f0f0",
      "--btn-active-bg": "#333333",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#333333",
    },
  },
  draculaDark: {
    name: "Dracula (Deep)",
    id: "draculaDark",
    colors: {
      "--bg-main": "#1e1e24",
      "--bg-container": "#21222c",
      "--bg-cell": "#282a36",
      "--border-cell": "rgba(98, 114, 164, 0.3)",
      "--text-main": "#f8f8f2",
      "--btn-bg": "#6272a4",
      "--btn-text": "#f8f8f2",
      "--btn-border": "#bd93f9",
      "--btn-hover": "#50fa7b",
      "--btn-active-bg": "#ff5555",
      "--btn-active-text": "#f8f8f2",
      "--btn-hover-text": "#282a36",
    },
  },
  cyberpunk: {
    name: "Cyberpunk",
    id: "cyberpunk",
    isPremium: true,
    colors: {
      "--bg-main": "#fceeb5",
      "--bg-container": "#000b1e",
      "--bg-cell": "#ee0000",
      "--border-cell": "rgba(0, 240, 255, 0.4)",
      "--text-main": "#00f0ff",
      "--btn-bg": "#fcdf03",
      "--btn-text": "#000000",
      "--btn-border": "#00f0ff",
      "--btn-hover": "#ee0000",
      "--btn-active-bg": "#00f0ff",
      "--btn-active-text": "#000000",
      "--btn-hover-text": "#000000",
    },
  },
  coffee: {
    name: "Coffee",
    id: "coffee",
    colors: {
      "--bg-main": "#dcc6b8",
      "--bg-container": "#6f4e37",
      "--bg-cell": "#4b3621",
      "--border-cell": "rgba(255, 255, 255, 0.2)",
      "--text-main": "#2c1b0e",
      "--btn-bg": "#8b5a2b",
      "--btn-text": "#f3e5ab",
      "--btn-border": "#4b3621",
      "--btn-hover": "#a0522d",
      "--btn-active-bg": "#dcc6b8",
      "--btn-active-text": "#4b3621",
      "--btn-hover-text": "#f3e5ab",
    },
  },
  winter: {
    name: "Winter",
    id: "winter",
    colors: {
      "--bg-main": "#f0fcff",
      "--bg-container": "#dff9fb",
      "--bg-cell": "#c7ecee",
      "--border-cell": "rgba(0, 168, 255, 0.1)",
      "--text-main": "#2f3640",
      "--btn-bg": "#7ed6df",
      "--btn-text": "#2f3640",
      "--btn-border": "#22a6b3",
      "--btn-hover": "#e056fd",
      "--btn-active-bg": "#2f3640",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#000000",
    },
  },
  mint: {
    name: "Mint",
    id: "mint",
    colors: {
      "--bg-main": "#f5fffa",
      "--bg-container": "#e0ffff",
      "--bg-cell": "#98fb98",
      "--border-cell": "rgba(0, 128, 128, 0.2)",
      "--text-main": "#2f4f4f",
      "--btn-bg": "#66cdaa",
      "--btn-text": "#f5fffa",
      "--btn-border": "#20b2aa",
      "--btn-hover": "#48d1cc",
      "--btn-active-bg": "#20b2aa",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#f5fffa",
    },
  },
  gameboy: {
    name: "GameBoy",
    id: "gameboy",
    colors: {
      "--bg-main": "#8bac0f",
      "--bg-container": "#9bbc0f",
      "--bg-cell": "#306230",
      "--border-cell": "rgba(15, 56, 15, 0.3)",
      "--text-main": "#0f380f",
      "--btn-bg": "#9bbc0f",
      "--btn-text": "#0f380f",
      "--btn-border": "#306230",
      "--btn-hover": "#8bac0f",
      "--btn-active-bg": "#0f380f",
      "--btn-active-text": "#9bbc0f",
      "--btn-hover-text": "#0f380f",
    },
  },
  gtaViceCity: {
    name: "GTA Vice City",
    id: "gtaViceCity",
    isPremium: true, // PRO FEATURE
    colors: {
      "--bg-main": "#ff6ec7",
      "--bg-container": "#1a0a2e",
      "--bg-cell": "#16213e",
      "--border-cell": "rgba(255, 110, 199, 0.3)",
      "--text-main": "#00fff7",
      "--btn-bg": "#00fff7",
      "--btn-text": "#1a0a2e",
      "--btn-border": "#00fff7",
      "--btn-hover": "#ff69b4",
      "--btn-active-bg": "#ff1493",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#ffffff",
    },
  },
  gtaSanAndreas: {
    name: "GTA San Andreas",
    id: "gtaSanAndreas",
    colors: {
      "--bg-main": "#f4a460",
      "--bg-container": "#2d1b0e",
      "--bg-cell": "#1a0f05",
      "--border-cell": "rgba(244, 164, 96, 0.3)",
      "--text-main": "#ffd700",
      "--btn-bg": "#8b4513",
      "--btn-text": "#ffd700",
      "--btn-border": "#ffd700",
      "--btn-hover": "#cd853f",
      "--btn-active-bg": "#ffd700",
      "--btn-active-text": "#2d1b0e",
      "--btn-hover-text": "#2d1b0e",
    },
  },
  commodore64: {
    name: "Commodore 64",
    id: "commodore64",
    colors: {
      "--bg-main": "#40318d",
      "--bg-container": "#352879",
      "--bg-cell": "#6c5eb5",
      "--border-cell": "rgba(134, 122, 222, 0.3)",
      "--text-main": "#867ade",
      "--btn-bg": "#6c5eb5",
      "--btn-text": "#867ade",
      "--btn-border": "#867ade",
      "--btn-hover": "#7b6fc4",
      "--btn-active-bg": "#867ade",
      "--btn-active-text": "#352879",
      "--btn-hover-text": "#ffffff",
    },
  },
  atari: {
    name: "Atari 2600",
    id: "atari",
    colors: {
      "--bg-main": "#000000",
      "--bg-container": "#3a2000",
      "--bg-cell": "#6a4a00",
      "--border-cell": "rgba(255, 165, 0, 0.2)",
      "--text-main": "#ffa500",
      "--btn-bg": "#c37b00",
      "--btn-text": "#000000",
      "--btn-border": "#ffa500",
      "--btn-hover": "#e69500",
      "--btn-active-bg": "#ffa500",
      "--btn-active-text": "#000000",
      "--btn-hover-text": "#000000",
    },
  },
  sega: {
    name: "SEGA Genesis",
    id: "sega",
    colors: {
      "--bg-main": "#0000aa",
      "--bg-container": "#000066",
      "--bg-cell": "#000044",
      "--border-cell": "rgba(255, 255, 255, 0.2)",
      "--text-main": "#ffffff",
      "--btn-bg": "#cc0000",
      "--btn-text": "#ffffff",
      "--btn-border": "#ffffff",
      "--btn-hover": "#ff3333",
      "--btn-active-bg": "#ffffff",
      "--btn-active-text": "#0000aa",
      "--btn-hover-text": "#ffffff",
    },
  },
  nes: {
    name: "NES Classic",
    id: "nes",
    colors: {
      "--bg-main": "#bcbcbc",
      "--bg-container": "#7c7c7c",
      "--bg-cell": "#f8f8f8",
      "--border-cell": "rgba(0, 0, 0, 0.3)",
      "--text-main": "#000000",
      "--btn-bg": "#cc0000",
      "--btn-text": "#ffffff",
      "--btn-border": "#000000",
      "--btn-hover": "#ff0000",
      "--btn-active-bg": "#000000",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#ffffff",
    },
  },
  snes: {
    name: "SNES",
    id: "snes",
    colors: {
      "--bg-main": "#9090c0",
      "--bg-container": "#606090",
      "--bg-cell": "#d0d0e8",
      "--border-cell": "rgba(75, 0, 130, 0.2)",
      "--text-main": "#2d0060",
      "--btn-bg": "#8050a0",
      "--btn-text": "#ffffff",
      "--btn-border": "#2d0060",
      "--btn-hover": "#9060b0",
      "--btn-active-bg": "#2d0060",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#ffffff",
    },
  },
  playstation: {
    name: "PlayStation",
    id: "playstation",
    colors: {
      "--bg-main": "#0070d1",
      "--bg-container": "#00439c",
      "--bg-cell": "#003087",
      "--border-cell": "rgba(255, 255, 255, 0.2)",
      "--text-main": "#ffffff",
      "--btn-bg": "#ffffff",
      "--btn-text": "#003087",
      "--btn-border": "#ffffff",
      "--btn-hover": "#e0e0e0",
      "--btn-active-bg": "#003087",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#003087",
    },
  },
  xbox: {
    name: "Xbox",
    id: "xbox",
    colors: {
      "--bg-main": "#107c10",
      "--bg-container": "#0e6b0e",
      "--bg-cell": "#094509",
      "--border-cell": "rgba(255, 255, 255, 0.2)",
      "--text-main": "#ffffff",
      "--btn-bg": "#52b043",
      "--btn-text": "#000000",
      "--btn-border": "#ffffff",
      "--btn-hover": "#7ed56f",
      "--btn-active-bg": "#ffffff",
      "--btn-active-text": "#107c10",
      "--btn-hover-text": "#000000",
    },
  },
  nintendo: {
    name: "Nintendo",
    id: "nintendo",
    colors: {
      "--bg-main": "#e60012",
      "--bg-container": "#ffffff",
      "--bg-cell": "#fce4ec",
      "--border-cell": "rgba(230, 0, 18, 0.2)",
      "--text-main": "#000000",
      "--btn-bg": "#e60012",
      "--btn-text": "#ffffff",
      "--btn-border": "#000000",
      "--btn-hover": "#ff1a2b",
      "--btn-active-bg": "#000000",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#ffffff",
    },
  },
  arcade: {
    name: "Arcade",
    id: "arcade",
    colors: {
      "--bg-main": "#000000",
      "--bg-container": "#1a1a2e",
      "--bg-cell": "#16213e",
      "--border-cell": "rgba(255, 255, 0, 0.2)",
      "--text-main": "#ffff00",
      "--btn-bg": "#e94560",
      "--btn-text": "#ffffff",
      "--btn-border": "#ffff00",
      "--btn-hover": "#ff6b6b",
      "--btn-active-bg": "#ffff00",
      "--btn-active-text": "#000000",
      "--btn-hover-text": "#ffffff",
    },
  },
  minecraft: {
    name: "Minecraft",
    id: "minecraft",
    colors: {
      "--bg-main": "#7ec850",
      "--bg-container": "#866043",
      "--bg-cell": "#8b7355",
      "--border-cell": "rgba(0, 0, 0, 0.3)",
      "--text-main": "#ffffff",
      "--btn-bg": "#565656",
      "--btn-text": "#ffffff",
      "--btn-border": "#000000",
      "--btn-hover": "#3c6e28",
      "--btn-active-bg": "#866043",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#ffffff",
    },
  },
  zelda: {
    name: "Zelda",
    id: "zelda",
    colors: {
      "--bg-main": "#2e7d32",
      "--bg-container": "#1b5e20",
      "--bg-cell": "#4a5d23",
      "--border-cell": "rgba(255, 215, 0, 0.3)",
      "--text-main": "#ffd700",
      "--btn-bg": "#8bc34a",
      "--btn-text": "#1b5e20",
      "--btn-border": "#ffd700",
      "--btn-hover": "#9ccc65",
      "--btn-active-bg": "#ffd700",
      "--btn-active-text": "#1b5e20",
      "--btn-hover-text": "#1b5e20",
    },
  },
  mario: {
    name: "Super Mario",
    id: "mario",
    colors: {
      "--bg-main": "#5c94fc",
      "--bg-container": "#fcbcb0",
      "--bg-cell": "#88d800",
      "--border-cell": "rgba(0, 0, 0, 0.2)",
      "--text-main": "#000000",
      "--btn-bg": "#e52521",
      "--btn-text": "#ffffff",
      "--btn-border": "#000000",
      "--btn-hover": "#ff3b30",
      "--btn-active-bg": "#fbd000",
      "--btn-active-text": "#000000",
      "--btn-hover-text": "#ffffff",
    },
  },
  pacman: {
    name: "Pac-Man",
    id: "pacman",
    isPremium: true,
    colors: {
      "--bg-main": "#000000",
      "--bg-container": "#21177d",
      "--bg-cell": "#2121de",
      "--border-cell": "rgba(255, 255, 0, 0.3)",
      "--text-main": "#ffff00",
      "--btn-bg": "#ff0000",
      "--btn-text": "#ffffff",
      "--btn-border": "#ffff00",
      "--btn-hover": "#ff6699",
      "--btn-active-bg": "#ffff00",
      "--btn-active-text": "#000000",
      "--btn-hover-text": "#ffffff",
    },
  },
  tetris: {
    name: "Tetris",
    id: "tetris",
    colors: {
      "--bg-main": "#9ead86",
      "--bg-container": "#8e9c76",
      "--bg-cell": "#7d8b66",
      "--border-cell": "rgba(0, 0, 0, 0.3)",
      "--text-main": "#1d1f0f",
      "--btn-bg": "#c8d4ac",
      "--btn-text": "#1d1f0f",
      "--btn-border": "#000000",
      "--btn-hover": "#d8e4bc",
      "--btn-active-bg": "#1d1f0f",
      "--btn-active-text": "#c8d4ac",
      "--btn-hover-text": "#1d1f0f",
    },
  },
  portal: {
    name: "Portal",
    id: "portal",
    colors: {
      "--bg-main": "#2c2c2c",
      "--bg-container": "#1a1a1a",
      "--bg-cell": "#3d3d3d",
      "--border-cell": "rgba(0, 162, 255, 0.3)",
      "--text-main": "#ffffff",
      "--btn-bg": "#00a2ff",
      "--btn-text": "#ffffff",
      "--btn-border": "#ff6600",
      "--btn-hover": "#ff6600",
      "--btn-active-bg": "#ff6600",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#ffffff",
    },
  },
  fallout: {
    name: "Fallout",
    id: "fallout",
    colors: {
      "--bg-main": "#0a0a0a",
      "--bg-container": "#1a1a1a",
      "--bg-cell": "#0d0d0d",
      "--border-cell": "rgba(18, 255, 128, 0.2)",
      "--text-main": "#12ff80",
      "--btn-bg": "#2a2a2a",
      "--btn-text": "#12ff80",
      "--btn-border": "#12ff80",
      "--btn-hover": "#3a3a3a",
      "--btn-active-bg": "#12ff80",
      "--btn-active-text": "#0a0a0a",
      "--btn-hover-text": "#12ff80",
    },
  },
  amberTerminal: {
    name: "Amber Terminal",
    id: "amberTerminal",
    colors: {
      "--bg-main": "#0d0208",
      "--bg-container": "#1a0510",
      "--bg-cell": "#0d0208",
      "--border-cell": "rgba(255, 176, 0, 0.2)",
      "--text-main": "#ffb000",
      "--btn-bg": "#2d1a00",
      "--btn-text": "#ffb000",
      "--btn-border": "#ffb000",
      "--btn-hover": "#3d2a00",
      "--btn-active-bg": "#ffb000",
      "--btn-active-text": "#0d0208",
      "--btn-hover-text": "#ffb000",
    },
  },
  outrun: {
    name: "Outrun",
    id: "outrun",
    colors: {
      "--bg-main": "#2d1f4e",
      "--bg-container": "#1a1030",
      "--bg-cell": "#0f0820",
      "--border-cell": "rgba(255, 0, 128, 0.3)",
      "--text-main": "#ff0080",
      "--btn-bg": "#00ffff",
      "--btn-text": "#1a1030",
      "--btn-border": "#00ffff",
      "--btn-hover": "#ff0080",
      "--btn-active-bg": "#ff6600",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#ffffff",
    },
  },
  miami: {
    name: "Miami",
    id: "miami",
    colors: {
      "--bg-main": "#f4a7b9",
      "--bg-container": "#a5dee5",
      "--bg-cell": "#e0ffcd",
      "--border-cell": "rgba(255, 107, 107, 0.2)",
      "--text-main": "#ff6b6b",
      "--btn-bg": "#feceab",
      "--btn-text": "#ff6b6b",
      "--btn-border": "#ff6b6b",
      "--btn-hover": "#ffdfc8",
      "--btn-active-bg": "#ff6b6b",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#ff6b6b",
    },
  },
  neonNights: {
    name: "Neon Nights",
    id: "neonNights",
    isPremium: true,
    colors: {
      "--bg-main": "#0f0f1a",
      "--bg-container": "#1a1a2e",
      "--bg-cell": "#0a0a15",
      "--border-cell": "rgba(0, 255, 136, 0.3)",
      "--text-main": "#00ff88",
      "--btn-bg": "#ff0055",
      "--btn-text": "#ffffff",
      "--btn-border": "#00ff88",
      "--btn-hover": "#ff3377",
      "--btn-active-bg": "#00ff88",
      "--btn-active-text": "#0f0f1a",
      "--btn-hover-text": "#ffffff",
    },
  },
  retrowave: {
    name: "Retrowave",
    id: "retrowave",
    isPremium: true,
    colors: {
      "--bg-main": "#2d132c",
      "--bg-container": "#801336",
      "--bg-cell": "#c72c41",
      "--border-cell": "rgba(238, 66, 102, 0.3)",
      "--text-main": "#ee4266",
      "--btn-bg": "#ffd23f",
      "--btn-text": "#2d132c",
      "--btn-border": "#ee4266",
      "--btn-hover": "#ffe066",
      "--btn-active-bg": "#ee4266",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#2d132c",
    },
  },
  hackerGold: {
    name: "Hacker Gold",
    id: "hackerGold",
    isPremium: true,
    colors: {
      "--bg-main": "#000000",
      "--bg-container": "#0a0a0a",
      "--bg-cell": "#050505",
      "--border-cell": "rgba(255, 215, 0, 0.2)",
      "--text-main": "#ffd700",
      "--btn-bg": "#1a1a00",
      "--btn-text": "#ffd700",
      "--btn-border": "#ffd700",
      "--btn-hover": "#2a2a00",
      "--btn-active-bg": "#ffd700",
      "--btn-active-text": "#000000",
      "--btn-hover-text": "#ffd700",
    },
  },
  sunset80s: {
    name: "80s Sunset",
    id: "sunset80s",
    isPremium: true,
    colors: {
      "--bg-main": "#ff6b35",
      "--bg-container": "#f72585",
      "--bg-cell": "#7209b7",
      "--border-cell": "rgba(72, 149, 239, 0.3)",
      "--text-main": "#4895ef",
      "--btn-bg": "#4cc9f0",
      "--btn-text": "#3a0ca3",
      "--btn-border": "#4895ef",
      "--btn-hover": "#7ae7ff",
      "--btn-active-bg": "#f72585",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#3a0ca3",
    },
  },
  spaceInvaders: {
    name: "Space Invaders",
    id: "spaceInvaders",
    isPremium: true,
    colors: {
      "--bg-main": "#000000",
      "--bg-container": "#111111",
      "--bg-cell": "#000000",
      "--border-cell": "rgba(0, 255, 0, 0.3)",
      "--text-main": "#00ff00",
      "--btn-bg": "#00ff00",
      "--btn-text": "#000000",
      "--btn-border": "#00ff00",
      "--btn-hover": "#00cc00",
      "--btn-active-bg": "#ffffff",
      "--btn-active-text": "#000000",
      "--btn-hover-text": "#000000",
    },
  },
  donkeyKong: {
    name: "Donkey Kong",
    id: "donkeyKong",
    colors: {
      "--bg-main": "#000000",
      "--bg-container": "#330000",
      "--bg-cell": "#660000",
      "--border-cell": "rgba(255, 204, 0, 0.3)",
      "--text-main": "#ffcc00",
      "--btn-bg": "#ff0000",
      "--btn-text": "#ffffff",
      "--btn-border": "#ffcc00",
      "--btn-hover": "#cc0000",
      "--btn-active-bg": "#ffcc00",
      "--btn-active-text": "#000000",
      "--btn-hover-text": "#ffffff",
    },
  },
  streetFighter: {
    name: "Street Fighter",
    id: "streetFighter",
    colors: {
      "--bg-main": "#1a1a2e",
      "--bg-container": "#16213e",
      "--bg-cell": "#0f3460",
      "--border-cell": "rgba(233, 69, 96, 0.3)",
      "--text-main": "#e94560",
      "--btn-bg": "#ffc107",
      "--btn-text": "#1a1a2e",
      "--btn-border": "#e94560",
      "--btn-hover": "#ffca2c",
      "--btn-active-bg": "#e94560",
      "--btn-active-text": "#ffffff",
      "--btn-hover-text": "#1a1a2e",
    },
  },
};

let customThemes = {};
let activeThemeId = "poolsuite"; // Default theme
let editingThemeId = null;

try {
  customThemes = JSON.parse(localStorage.getItem("customThemes") || "{}");
} catch (e) {}

const themeModal = document.getElementById("themeModal");
const themeBtn = document.getElementById("themeBtn");
const themePresetsContainer = document.querySelector(".theme-presets");
const saveCustomBtn = document.getElementById("saveCustomThemeBtn");

// Inputs for Custom Theme
const customInputs = {
  name: document.getElementById("customThemeName"),
  "--bg-main": document.getElementById("customBgMain"),
  "--bg-container": document.getElementById("customBgContainer"),
  "--bg-cell": document.getElementById("customBgCell"),
  "--btn-bg": document.getElementById("customBtnBg"),
  "--text-main": document.getElementById("customText"),
};

// Load Custom Themes
function loadCustomThemes() {
  try {
    const custom = localStorage.getItem("customThemes");
    if (custom) {
      try {
        customThemes = JSON.parse(custom);
      } catch (e) {
        console.error("Error parsing custom themes", e);
        customThemes = {};
      }
    }
  } catch (e) {
    console.warn("Storage access denied (loadCustomThemes)", e);
    customThemes = {};
  }
}

function saveCustomThemesToStorage() {
  try {
    localStorage.setItem("customThemes", JSON.stringify(customThemes));
  } catch (e) {
    console.warn("Storage access denied (saveCustomThemes)", e);
  }
}

const applyPreviewBtn = document.getElementById("applyPreviewBtn");

// Helper to get current input values as a theme object
function getValuesFromInputs() {
  return {
    "--bg-main": customInputs["--bg-main"].value,
    "--bg-container": customInputs["--bg-container"].value,
    "--bg-cell": customInputs["--bg-cell"].value,
    "--border-cell": "rgba(0,0,0,0.1)", // Default for custom themes for now
    "--text-main": customInputs["--text-main"].value,
    "--btn-bg": customInputs["--btn-bg"].value,
    "--btn-text": customInputs["--text-main"].value,
    "--btn-border": customInputs["--text-main"].value,
    "--btn-hover": customInputs["--bg-container"].value,
    "--btn-active-bg": customInputs["--text-main"].value,
    "--btn-active-text": customInputs["--bg-main"].value,
    "--btn-hover-text": customInputs["--text-main"].value,
  };
}

if (applyPreviewBtn) {
  applyPreviewBtn.onclick = () => {
    const previewColors = getValuesFromInputs();
    applyTheme(previewColors);
    themeModal.classList.remove("show");
  };
}

if (themeBtn) {
  themeBtn.onclick = (e) => {
    e.stopPropagation();
    renderThemeOptions();
    themeModal.classList.add("show");
  };
}

document.addEventListener("click", (e) => {
  if (themeModal.classList.contains("show")) {
    const modalContent = themeModal.querySelector(".modal-content");
    // If click is outside the modal content AND not on the toggle button
    // Note: themeModal is the wrapper/backdrop, modal-content is the card
    // detecting click on backdrop vs content
    if (
      modalContent &&
      !modalContent.contains(e.target) &&
      e.target !== themeBtn
    ) {
      themeModal.classList.remove("show");
    }
  }
});

if (document.querySelector(".close")) {
  document.querySelector(".close").onclick = () =>
    themeModal.classList.remove("show");
}

function createThemeCard(theme, isCustom) {
  const themeCard = document.createElement("div");
  themeCard.classList.add("theme-card");

  if (activeThemeId === theme.id) {
    themeCard.classList.add("active");
  }

  // Preview circles
  const preview = document.createElement("div");
  preview.classList.add("theme-preview");

  const c1 = document.createElement("div");
  c1.style.backgroundColor = theme.colors["--bg-main"];
  const c2 = document.createElement("div");
  c2.style.backgroundColor = theme.colors["--btn-bg"];
  const c3 = document.createElement("div");
  c3.style.backgroundColor = theme.colors["--bg-cell"];

  preview.appendChild(c1);
  preview.appendChild(c2);
  preview.appendChild(c3);

  const name = document.createElement("span");
  name.innerText = theme.name;

  if (theme.isPremium && !isProUser) {
    const lock = document.createElement("span");
    lock.className = "pro-badge-inline";
    lock.textContent = "PRO";
    lock.style.marginLeft = "6px";
    name.appendChild(lock);
  }

  themeCard.appendChild(preview);
  themeCard.appendChild(name);

  if (isCustom) {
    const actions = document.createElement("div");
    actions.classList.add("card-actions");

    const renameBtn = document.createElement("button");
    renameBtn.innerHTML = "✎";
    renameBtn.title = "Edit";
    renameBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      startEditingTheme(theme.id);
    };

    const deleteBtn = document.createElement("button");
    deleteBtn.innerHTML = "×";
    deleteBtn.title = "Delete";
    deleteBtn.classList.add("delete-btn");
    deleteBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        deleteTheme(null, theme.id);
      } catch (err) {
        alert("Error deleting: " + err.message);
      }
    };

    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    themeCard.appendChild(actions);
  }

  themeCard.onclick = () => {
    applyTheme(theme.colors);
    activeThemeId = theme.id;
    try {
      localStorage.setItem("pixelArtThemeId", activeThemeId);
    } catch (e) {
      console.warn("Storage access denied", e);
    }

    document
      .querySelectorAll(".theme-card")
      .forEach((c) => c.classList.remove("active"));
    themeCard.classList.add("active");
  };

  return themeCard;
}

function renderSectionHeader(text) {
  const h = document.createElement("h4");
  h.innerText = text;
  h.classList.add("theme-section-header");
  return h;
}

// Render Themes
function renderThemeOptions() {
  themePresetsContainer.innerHTML = ""; // Clear existing
  loadCustomThemes(); // Refresh list memory

  // Defaults
  themePresetsContainer.appendChild(renderSectionHeader("Presets"));
  const presetsGrid = document.createElement("div");
  presetsGrid.classList.add("theme-grid-container");

  Object.values(defaultThemes).forEach((theme) => {
    presetsGrid.appendChild(createThemeCard(theme, false));
  });
  themePresetsContainer.appendChild(presetsGrid);

  // Custom
  if (Object.keys(customThemes).length > 0) {
    themePresetsContainer.appendChild(document.createElement("hr"));
    themePresetsContainer.appendChild(renderSectionHeader("My Themes"));

    const customGrid = document.createElement("div");
    customGrid.classList.add("theme-grid-container");

    Object.values(customThemes).forEach((theme) => {
      customGrid.appendChild(createThemeCard(theme, true));
    });
    themePresetsContainer.appendChild(customGrid);
  }
}

// Export Menu

// Import Project Button & File Input (in export menu)
document.addEventListener("DOMContentLoaded", () => {
  const exportMainBtn = document.getElementById("exportMainBtn");
  const exportMenu = document.getElementById("exportMenu");

  if (exportMainBtn && exportMenu) {
    exportMainBtn.onclick = (e) => {
      e.stopPropagation();
      exportMenu.classList.toggle("hidden");
    };
  }

  const btnProject = document.getElementById("exportProjectBtn");
  if (btnProject) {
    btnProject.onclick = () => {
      exportProject();
      if (exportMenu) exportMenu.classList.add("hidden");
    };
  }

  const btnSticker = document.getElementById("exportStickerBtn");
  if (btnSticker) {
    btnSticker.onclick = () => {
      if (exportMenu) exportMenu.classList.add("hidden");
      showExportInterstitial(() => {
        exportStickerToPhotos();
        trackEvent("export_used", { format: "sticker" });
      });
    };
  }

  const btnPng = document.getElementById("exportPngBtn");
  if (btnPng) {
    btnPng.onclick = () => {
      if (exportMenu) exportMenu.classList.add("hidden");
      showExportInterstitial(() => {
        exportCanvas(false, false);
        trackEvent("export_used", { format: "png" });
      });
    };
  }

  // HD Export (Pro only)
  const btnHdExport = document.getElementById("exportHdBtn");
  if (btnHdExport) {
    btnHdExport.onclick = () => {
      if (!isProUser) {
        showPaywall("HD Export is a Pro feature");
        return;
      }
      if (exportMenu) exportMenu.classList.add("hidden");
      showHdExportDialog();
    };
  }

  const importProjectBtn = document.getElementById("importProjectBtn");
  const importFileInput = document.getElementById("importFileInput");

  if (importProjectBtn && importFileInput) {
    importProjectBtn.onclick = () => {
      importFileInput.click();
      if (exportMenu) exportMenu.classList.add("hidden");
    };

    importFileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        importProject(file);
        importFileInput.value = ""; // Reset for next import
      }
    };
  }
});

// Clipboard / Share helpers
async function copyToClipboard(dataUrl) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    if (navigator.clipboard && navigator.clipboard.write) {
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
      alert("Copied!");
    } else {
      throw new Error("Clipboard API unavailable");
    }
  } catch (e) {
    alert("Copy failed (requires HTTPS)");
  }
}

async function shareFile(blob, filename) {
  if (
    navigator.share &&
    navigator.canShare &&
    navigator.canShare({
      files: [new File([blob], filename, { type: "image/png" })],
    })
  ) {
    try {
      await navigator.share({
        files: [new File([blob], filename, { type: "image/png" })],
        title: "Pixy Art",
      });
    } catch (e) {}
  } else {
    const link = document.createElement("a");
    link.download = filename;
    link.href = URL.createObjectURL(blob);
    link.click();
  }
}

// Drawing Mode Switch
const drawModeSwitch = document.getElementById("drawModeSwitch");
if (drawModeSwitch) {
  drawModeSwitch.querySelectorAll(".mode-option").forEach((opt) => {
    opt.onclick = (e) => {
      e.preventDefault();
      if (opt.innerText.includes("INST")) drawingMode = "instant";
      else drawingMode = "progressive";

      drawModeSwitch
        .querySelectorAll(".mode-option")
        .forEach((o) => o.classList.remove("active"));
      opt.classList.add("active");
    };
  });
}

// Render Saved Drawings Helper
const savedList = document.getElementById("savedList");
const mobileSavedList = document.getElementById("mobileSavedList");

function renderSavedDrawings() {
  let saves = JSON.parse(localStorage.getItem("pixy_saves") || "[]");

  [savedList, mobileSavedList].forEach((list) => {
    if (!list) return;
    list.innerHTML = "";
    saves.forEach((save) => {
      const div = document.createElement("div");
      div.className = "saved-item";

      const img = document.createElement("img");
      img.src = save.thumbnail;
      div.appendChild(img);

      // Delete button
      const del = document.createElement("div");
      del.className = "delete-save";
      del.innerHTML = "&times;";
      del.onclick = (e) => {
        e.stopPropagation();
        pendingDeleteId = save.id;
        document.getElementById("deleteConfirmModal").classList.add("show");
      };

      div.appendChild(del);

      div.onclick = () => {
        if (document.body.classList.contains("edit-mode")) return; // Edit mode protection logic
        loadDraft(save);
        if (savedProjectsModal) savedProjectsModal.classList.remove("active");
      };

      // Validation for Edit Mode (Long press logic)
      let longPressTimer;
      const startLongPress = (e) => {
        // Only if not already in edit mode?
        longPressTimer = setTimeout(() => {
          document.body.classList.add("edit-mode");
          // Add visual wiggle or just show delete buttons via CSS
        }, 800); // 800ms threshold
      };
      const cancelLongPress = () => {
        clearTimeout(longPressTimer);
      };

      div.addEventListener("mousedown", startLongPress);
      div.addEventListener("touchstart", startLongPress);
      div.addEventListener("mouseup", cancelLongPress);
      div.addEventListener("mouseleave", cancelLongPress);
      div.addEventListener("touchend", cancelLongPress);
      div.addEventListener("touchmove", cancelLongPress);

      list.appendChild(div);
    });
  });

  // Global listener to exit edit mode if clicking outside (and not clicking a delete button)
  if (!window.hasAddedEditModeListener) {
    document.addEventListener("click", (e) => {
      if (
        document.body.classList.contains("edit-mode") &&
        !e.target.closest(".saved-item")
      ) {
        document.body.classList.remove("edit-mode");
      }
    });
    window.hasAddedEditModeListener = true;
  }
}

// Global variable for pending delete
let pendingDeleteId = null;

// Initialize Delete Modal Listeners
const deleteConfirmModal = document.getElementById("deleteConfirmModal");
const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
const cancelDeleteBtn = document.getElementById("cancelDeleteBtn");

if (confirmDeleteBtn) {
  confirmDeleteBtn.onclick = () => {
    if (pendingDeleteId) {
      let saves = JSON.parse(localStorage.getItem("pixy_saves") || "[]");
      saves = saves.filter((s) => s.id !== pendingDeleteId);
      localStorage.setItem("pixy_saves", JSON.stringify(saves));
      renderSavedDrawings();
      pendingDeleteId = null;
    }
    deleteConfirmModal.classList.remove("show");
  };
}

if (cancelDeleteBtn) {
  cancelDeleteBtn.onclick = () => {
    pendingDeleteId = null;
    deleteConfirmModal.classList.remove("show");
  };
}

// Close modal when clicking outside
if (deleteConfirmModal) {
  deleteConfirmModal.onclick = (e) => {
    if (e.target === deleteConfirmModal) {
      pendingDeleteId = null;
      deleteConfirmModal.classList.remove("show");
    }
  };
}
saveCustomBtn.onclick = () => {
  const name = customInputs.name.value.trim() || `Custom Theme ${Date.now()}`;

  let id;
  if (editingThemeId) {
    // Update existing
    id = editingThemeId;
  } else {
    // Create new
    id = `custom_${Date.now()}`;
  }

  const customTheme = {
    name: name,
    id: id,
    colors: getValuesFromInputs(),
  };

  customThemes[id] = customTheme;
  saveCustomThemesToStorage();

  // Render the new theme in the list
  renderThemeOptions();

  // Visual Feedback
  const originalText = saveCustomBtn.textContent;
  saveCustomBtn.textContent = editingThemeId ? "Updated!" : "Saved!";
  setTimeout(() => {
    saveCustomBtn.textContent = "Save Custom Theme"; // Always revert to default text
    // If we were editing, stop editing mode now
    if (editingThemeId) {
      cancelEditMode();
    }
  }, 1000);

  // If creating new, clear name. If updating, we keep it (or clear it via cancelEditMode above?)
  // Let's clear inputs if it was a new creation
  if (!editingThemeId) {
    customInputs.name.value = "";
  }
};

function startEditingTheme(id) {
  const theme = customThemes[id];
  if (!theme) return;

  editingThemeId = id;

  // Populate inputs
  customInputs.name.value = theme.name;
  customInputs["--bg-main"].value = theme.colors["--bg-main"];
  customInputs["--bg-container"].value = theme.colors["--bg-container"];
  customInputs["--bg-cell"].value = theme.colors["--bg-cell"];
  customInputs["--btn-bg"].value = theme.colors["--btn-bg"];
  customInputs["--text-main"].value = theme.colors["--text-main"];

  // Update Button Text
  saveCustomBtn.textContent = "Update Theme";

  // Scroll to inputs
  const customSection = document.querySelector(".custom-theme-inputs");
  if (customSection) customSection.scrollIntoView({ behavior: "smooth" });

  // Show Cancel Button (if we added one, or toggle visibility)
  let cancelBtn = document.getElementById("cancelEditThemeBtn");
  if (!cancelBtn) {
    // Create if doesn't exist (lazy init)
    cancelBtn = document.createElement("button");
    cancelBtn.id = "cancelEditThemeBtn";
    cancelBtn.textContent = "Cancel Edit";
    cancelBtn.className = "secondary-btn";
    cancelBtn.style.marginLeft = "10px";
    cancelBtn.onclick = cancelEditMode;
    saveCustomBtn.parentNode.appendChild(cancelBtn);
  }
  cancelBtn.style.display = "inline-block";
}

function cancelEditMode() {
  editingThemeId = null;
  saveCustomBtn.textContent = "Save Custom Theme";
  customInputs.name.value = "";
  // Reset colors to defaults or keep? Better to clear or reset to current active theme?
  // Let's reset to active theme for convenience, or just leave as is. User can pick colors.

  const cancelBtn = document.getElementById("cancelEditThemeBtn");
  if (cancelBtn) cancelBtn.style.display = "none";
}
function deleteTheme(e, id) {
  if (e) e.stopPropagation();
  pendingThemeAction = id;
  if (deleteThemeModal) {
    deleteThemeModal.classList.add("show");
  } else {
    alert("Delete theme modal not found! Falling back to confirm.");
    if (confirm("Delete this theme?")) {
      if (customThemes[id]) {
        delete customThemes[id];
        saveCustomThemesToStorage();
        if (activeThemeId === id) {
          applyTheme(defaultThemes.poolsuite.colors);
          activeThemeId = "poolsuite";
          localStorage.setItem("pixelArtThemeId", activeThemeId);
        }
        renderThemeOptions();
      }
    }
  }
}

function renameTheme(e, id) {
  if (e) e.stopPropagation();
  pendingThemeAction = id;
  if (renameThemeModal && renameThemeInput) {
    renameThemeInput.value = customThemes[id]?.name || "";
    renameThemeModal.classList.add("show");
    setTimeout(() => renameThemeInput.focus(), 100);
  } else {
    alert("Rename modal not found! Falling back to prompt.");
    const newName = prompt("Enter new name:", customThemes[id]?.name || "");
    if (newName && newName.trim()) {
      customThemes[id].name = newName.trim();
      saveCustomThemesToStorage();
      renderThemeOptions();
    }
  }
}

// Delete theme modal handlers
if (confirmDeleteThemeBtn) {
  confirmDeleteThemeBtn.onclick = () => {
    if (pendingThemeAction && customThemes[pendingThemeAction]) {
      delete customThemes[pendingThemeAction];
      saveCustomThemesToStorage();
      // If deleted theme was active, revert to default
      if (activeThemeId === pendingThemeAction) {
        applyTheme(defaultThemes.poolsuite.colors);
        activeThemeId = "poolsuite";
        try {
          localStorage.setItem("pixelArtThemeId", activeThemeId);
        } catch (err) {
          console.warn("Storage access denied", err);
        }
      }
      renderThemeOptions();
    }
    pendingThemeAction = null;
    deleteThemeModal.classList.remove("show");
  };
}

if (cancelDeleteThemeBtn) {
  cancelDeleteThemeBtn.onclick = () => {
    pendingThemeAction = null;
    deleteThemeModal.classList.remove("show");
  };
}

// Rename theme modal handlers
if (confirmRenameBtn) {
  confirmRenameBtn.onclick = () => {
    const newName = renameThemeInput.value.trim();
    if (pendingThemeAction && customThemes[pendingThemeAction] && newName) {
      customThemes[pendingThemeAction].name = newName;
      saveCustomThemesToStorage();
      renderThemeOptions();
    }
    pendingThemeAction = null;
    renameThemeModal.classList.remove("show");
  };
}

if (cancelRenameBtn) {
  cancelRenameBtn.onclick = () => {
    pendingThemeAction = null;
    renameThemeModal.classList.remove("show");
  };
}

// Close modals when clicking outside
if (deleteThemeModal) {
  deleteThemeModal.onclick = (e) => {
    if (e.target === deleteThemeModal) {
      pendingThemeAction = null;
      deleteThemeModal.classList.remove("show");
    }
  };
}

if (renameThemeModal) {
  renameThemeModal.onclick = (e) => {
    if (e.target === renameThemeModal) {
      pendingThemeAction = null;
      renameThemeModal.classList.remove("show");
    }
  };
}

// Allow Enter key to confirm rename
if (renameThemeInput) {
  renameThemeInput.onkeydown = (e) => {
    if (e.key === "Enter") {
      confirmRenameBtn.click();
    } else if (e.key === "Escape") {
      cancelRenameBtn.click();
    }
  };
}

// --- KEYBOARD SHORTCUTS ---
document.addEventListener("keydown", (e) => {
  // Ignore shortcuts when typing in an input field
  if (
    e.target.tagName === "INPUT" ||
    e.target.tagName === "TEXTAREA" ||
    e.target.isContentEditable
  ) {
    return;
  }

  const key = e.key.toLowerCase();

  switch (key) {
    case "l": // Layers
      e.preventDefault();
      const layersPanel = document.getElementById("layersPanel");
      if (layersPanel) {
        layersPanel.classList.toggle("hidden");
        layersPanel.classList.toggle("active");
      }
      break;

    case "t": // Themes
      e.preventDefault();
      const themeModalEl = document.getElementById("themeModal");
      if (themeModalEl && themeModalEl.classList.contains("show")) {
        themeModalEl.classList.remove("show");
      } else {
        const themeBtnEl = document.getElementById("themeBtn");
        if (themeBtnEl) themeBtnEl.click();
      }
      break;

    case "e": // Eraser
      e.preventDefault();
      toggleEraser();
      break;

    case "f": // Fill
      e.preventDefault();
      const fillBtn = document.getElementById("fillBtn");
      if (fillBtn) fillBtn.click();
      break;

    case "c": // Cell Count
      e.preventDefault();
      const cellCountPanel = document.getElementById("cellCountPanel");
      if (cellCountPanel) {
        cellCountPanel.classList.toggle("hidden");
        document.body.classList.toggle("cell-panel-open");
      }
      break;

    case "r": // Reset
      e.preventDefault();
      const resetBtnEl = document.getElementById("resetBtn");
      if (resetBtnEl) {
        // Trigger visual press animation
        resetBtnEl.classList.add("active");
        setTimeout(() => resetBtnEl.classList.remove("active"), 150);
      }
      resetCanvas();
      break;

    case "s": // Save
      e.preventDefault();
      saveDraft();
      break;

    case "tab": // Mode Switch
      e.preventDefault();
      // Toggle between progressive and instant
      if (drawingMode === "progressive") {
        drawingMode = "instant";
      } else {
        drawingMode = "progressive";
      }
      // Update UI
      const modeSwitch = document.getElementById("drawModeSwitch");
      if (modeSwitch) {
        modeSwitch.querySelectorAll(".mode-option").forEach((opt) => {
          opt.classList.remove("active");
          if (drawingMode === "instant" && opt.innerText.includes("INST")) {
            opt.classList.add("active");
          } else if (
            drawingMode === "progressive" &&
            opt.innerText.includes("PROG")
          ) {
            opt.classList.add("active");
          }
        });
      }
      break;

    case "enter": // Export
      e.preventDefault();
      const exportMainBtn = document.getElementById("exportMainBtn");
      if (exportMainBtn) exportMainBtn.click();
      break;
  }
});

// Middle Mouse Click for Color Picker
document.addEventListener("auxclick", (e) => {
  if (e.button === 1) {
    // Middle mouse button
    e.preventDefault();
    const colorPicker = document.getElementById("colorPicker");
    if (colorPicker) colorPicker.click();
  }
});
