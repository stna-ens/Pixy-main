let isDrawing = false;
let isErasing = false;
// currentColor will be set after DOM load, but safe default here
let currentColor = "#000000";
let lastStylusTime = 0; // Track when the stylus was last used
let lastTouchedElement = null; // Track the last element touched to prevent rapid firing
let historyStack = [];
let currentStroke = []; // Buffer for the current continuous stroke
const MAX_HISTORY = 50;

// Cached base colors for color mixing (set by applyTheme)
let cachedBaseColors = { r: 255, g: 255, b: 255 };

// Cache the CURRENT drawing color as an object {r,g,b} to avoid parsing on every pixel
let cachedCurrentColorRGB = { r: 0, g: 0, b: 0 };

function updateCachedColor() {
  if (currentColor.startsWith("#")) {
    const rgb = hexToRgb(currentColor);
    if (rgb) cachedCurrentColorRGB = rgb;
  } else {
    const parsed = parseColorString(currentColor);
    if (parsed) cachedCurrentColorRGB = parsed;
  }
}

// --- POINTER EVENTS ARCHITECTURE ---
// Global release handler to ensure we stop drawing if cursor leaves page
document.addEventListener("pointerup", (e) => {
  isDrawing = false;
  lastTouchedElement = null;
  // If there's an active stroke, push it to history
  if (currentStroke.length > 0) {
    historyStack.push(currentStroke);
    if (historyStack.length > MAX_HISTORY) {
      historyStack.shift();
    }
    currentStroke = [];
  }
});

// Prevent double-click zoom on entire page
document.addEventListener("dblclick", (e) => {
  e.preventDefault();
  e.stopPropagation();
});

// Main initialization
document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

let container; // Global reference
// const tools reference moved inside initApp to prevent race conditions

function initApp() {
  // Mobile Debug Logger (Temporary)
  window.onerror = function (msg, source, lineno, colno, error) {
    const errDiv = document.createElement("div");
    errDiv.style.cssText =
      "position:fixed;top:0;left:0;right:0;background:rgba(255,0,0,0.9);color:white;padding:20px;z-index:99999;font-size:14px;font-family:monospace;pointer-events:none;white-space:pre-wrap;";
    errDiv.innerText = "Error: " + msg + "\nLine: " + lineno;
    document.body.appendChild(errDiv);
  };

  const tools = document.getElementById("tools");
  container = document.createElement("div");
  container.classList.add("container");

  if (tools && tools.parentNode) {
    tools.parentNode.insertBefore(container, tools);
  } else {
    // Fallback if tools not found
    const board = document.getElementById("drawingBoard");
    if (board) board.appendChild(container);
  }

  // Attach Event Listeners to Container
  attachContainerListeners();

  // Prevent native drag behavior on desktop which interrupts drawing
  container.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });

  // Create Initial Grid
  createGrid(16);

  // Init Saved Drawings Safely
  try {
    renderSavedDrawings();
  } catch (e) {
    console.warn("Failed to render saved drawings", e);
  }
}

// 1. Pointer Down (Start Drawing) - Moved to function
function attachContainerListeners() {
  container.addEventListener("pointerdown", (e) => {
    // Only left click or touch
    if (e.button !== 0 && e.pointerType === "mouse") return;

    e.preventDefault(); // Prevent scroll/drag
    isDrawing = true;
    currentStroke = [];
    container.setPointerCapture(e.pointerId); // CRITICAL: Captures all moves even if they leave elements

    handlePointerDraw(e);
  });

  // 2. Pointer Move (Draw Stroke)
  container.addEventListener("pointermove", (e) => {
    if (isDrawing) {
      e.preventDefault();
      handlePointerDraw(e);
    }
  });

  // 3. Pointer Up (Stop Drawing)
  container.addEventListener("pointerup", (e) => {
    isDrawing = false;
    lastTouchedElement = null;
    container.releasePointerCapture(e.pointerId);

    if (currentStroke.length > 0) {
      historyStack.push(currentStroke);
      if (historyStack.length > MAX_HISTORY) {
        historyStack.shift();
      }
      currentStroke = [];
    }
  });
}

// Unified Handler
function handlePointerDraw(e) {
  // elementFromPoint works for both mouse and touch
  const target = document.elementFromPoint(e.clientX, e.clientY);

  if (target && target.classList.contains("cell")) {
    // Avoid repainting the same cell endlessly in one move event
    if (target !== lastTouchedElement) {
      lastTouchedElement = target;
      changeColor(target); // Pass element DIRECTLY
    }
  }
}

function createDefaultGrid() {
  for (let i = 0; i < 256; i++) {
    const cell = document.createElement("div");
    cell.classList.add("cell");
    container.appendChild(cell);
  }
}

// Global listeners set, grid created in window.onload

function hexToRgb(hex) {
  // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
  var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, function (m, r, g, b) {
    return r + r + g + g + b + b;
  });

  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  // FIX: Return NULL on failure, not Black (0,0,0) so we can detect failure
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

function getBaseColors() {
  // Return the cached colors (set when theme was applied)
  if (!cachedBaseColors) {
    console.warn("Base colors missing, defaulting to white");
    return { r: 255, g: 255, b: 255 };
  }
  return cachedBaseColors;
}

// Undo support: Records cell state before modification
function addToCurrentStroke(
  cell,
  prevColor,
  prevPercent,
  newColor,
  newPercent
) {
  currentStroke.push({
    element: cell,
    prevColor: prevColor,
    prevPercent: prevPercent,
    newColor: newColor,
    newPercent: newPercent,
  });
}

function undo() {
  if (historyStack.length === 0) return;
  const lastStroke = historyStack.pop();
  // Revert each cell in the stroke IN REVERSE ORDER
  // This ensures if a cell was changed multiple times in one stroke,
  // we revert to the absolute oldest state first, effectively rewinding time correctly.
  lastStroke.reverse().forEach((item) => {
    item.element.style.backgroundColor = item.prevColor || "var(--bg-cell)";
    item.element.dataset.percent = item.prevPercent || 0;
  });
}

// 5. Change Color (Pure Logic) - calling with 'target' element
function changeColor(target) {
  try {
    // No event parsing - logic is upstream
    // const target = target; // (passed in)
    // Capture state BEFORE modification
    const prevColor = target.style.backgroundColor;
    const prevPercent = target.dataset.percent || 0;

    if (isErasing) {
      target.style.backgroundColor = "var(--bg-cell)";
      target.dataset.percent = 0;
      addToCurrentStroke(target, prevColor, prevPercent, "var(--bg-cell)", 0);
      return;
    }

    let currentPercent = Number(target.dataset.percent || 0);

    if (currentPercent < 100) {
      currentPercent += 10;

      // Calculate new color DYNAMICALLY
      const baseColors = getBaseColors();
      const baseR_val = baseColors.r != null ? baseColors.r : 255;
      const baseG_val = baseColors.g != null ? baseColors.g : 255;
      const baseB_val = baseColors.b != null ? baseColors.b : 255;

      let targetR = 0,
        targetG = 0,
        targetB = 0;

      // Use CACHED color (Performance critical)
      targetR = cachedCurrentColorRGB.r;
      targetG = cachedCurrentColorRGB.g;
      targetB = cachedCurrentColorRGB.b;

      // Safe mixing logic (prevent NaN but allow floats)
      const mix = currentPercent / 100;
      const mixedR = Math.round(baseR_val + (targetR - baseR_val) * mix) || 0;
      const mixedG = Math.round(baseG_val + (targetG - baseG_val) * mix) || 0;
      const mixedB = Math.round(baseB_val + (targetB - baseB_val) * mix) || 0;

      const newColor = `rgb(${mixedR}, ${mixedG}, ${mixedB})`;

      target.dataset.percent = currentPercent;
      target.style.backgroundColor = newColor;

      addToCurrentStroke(
        target,
        prevColor,
        prevPercent,
        newColor,
        currentPercent
      );
    }
  } catch (err) {
    console.warn("Drawing error (graceful):", err);
  }
}

function createGrid(gridNumber) {
  container.innerHTML = "";
  historyStack = []; // Clear history on new grid
  gridNumber = parseInt(gridNumber);
  if (gridNumber > 0 && gridNumber < 101) {
    for (let i = 0; i < gridNumber * gridNumber; i++) {
      const cell = document.createElement("div");
      cell.classList.add("cell");
      const cellSize = 100 / gridNumber;
      cell.style.width = `${cellSize}%`;
      cell.style.height = `${cellSize}%`;
      container.appendChild(cell);
      cell.dataset.percent = "0"; // Initialize percent state
      cell.style.backgroundColor = "var(--bg-cell)";
      cell.dataset.percent = "0"; // Initialize percent state
      cell.style.backgroundColor = "var(--bg-cell)";
    }
  }
}

const colorPicker = document.getElementById("colorPicker");
// Initialize from the actual DOM value so what user sees is what they get
currentColor = colorPicker.value || "#000000";
updateCachedColor();

const eraserBtn = document.getElementById("eraserBtn");
const undoBtn = document.getElementById("undoBtn");

colorPicker.oninput = (e) => {
  currentColor = e.target.value;
  updateCachedColor();
  isErasing = false;
  eraserBtn.classList.remove("active");
};
// Add onchange for better mobile compatibility
colorPicker.onchange = (e) => {
  currentColor = e.target.value;
  updateCachedColor();
  isErasing = false;
  eraserBtn.classList.remove("active");
};

eraserBtn.onclick = () => {
  isErasing = !isErasing;
  eraserBtn.classList.toggle("active");
};

undoBtn.onclick = () => {
  undo();
};

const changeGridNumberBtn = document.getElementById("changeGridNumber");
const cellCountPanel = document.getElementById("cellCountPanel");
const cellSlider = document.getElementById("cellSlider");
const cellNumberInput = document.getElementById("cellNumberInput");
const applyCellCountBtn = document.getElementById("applyCellCount");

function toggleCellCountPanel() {
  cellCountPanel.classList.toggle("hidden");
  // Toggle body class for Landscape Layout shifts ("Push" effect)
  document.body.classList.toggle("cell-panel-open");
}

if (changeGridNumberBtn) {
  changeGridNumberBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleCellCountPanel();
  });
}

// Ensure panel doesn't close when clicking inside it
cellCountPanel.addEventListener("click", (e) => {
  e.stopPropagation();
});

// Close when clicking outside (Optional, but user didn't ask. Stick to explicit buttons for now)

// Sync slider and input (no real-time grid changes for performance)
cellSlider.oninput = () => {
  cellNumberInput.value = cellSlider.value;
};

cellNumberInput.oninput = () => {
  let val = parseInt(cellNumberInput.value) || 1;
  if (val < 1) val = 1;
  if (val > 100) val = 100;
  cellSlider.value = val;
};

// Apply button creates the grid
applyCellCountBtn.onclick = () => {
  let gridNumber = parseInt(cellNumberInput.value) || 16;
  if (gridNumber < 1) gridNumber = 1;
  if (gridNumber > 100) gridNumber = 100;
  createGrid(gridNumber);
  toggleCellCountPanel();
};

const savedProjectsModal = document.getElementById("savedProjectsModal");
const openSavedBtn = document.getElementById("openSavedBtn");
const mobileSavedList = document.getElementById("mobileSavedList");
const savedList = document.getElementById("savedList"); // Moved here to fix initialization order

function toggleSavedModal() {
  savedProjectsModal.classList.toggle("active");
  if (savedProjectsModal.classList.contains("active")) {
    renderSavedDrawings(); // Refresh when opening
  }
}

if (openSavedBtn) {
  const handleOpen = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleSavedModal();
  };

  openSavedBtn.addEventListener("click", handleOpen);
  openSavedBtn.addEventListener("touchend", handleOpen);
}

const resetBtn = document.getElementById("resetBtn");
resetBtn.addEventListener("click", () => {
  const cells = document.querySelectorAll(".cell");

  // Save current state as a single "stroke" so reset can be undone
  const resetStroke = [];
  cells.forEach((cell) => {
    // Only save cells that were actually painted
    if (cell.dataset.percent && cell.dataset.percent !== "0") {
      resetStroke.push({
        element: cell,
        prevColor: cell.style.backgroundColor,
        prevPercent: cell.dataset.percent,
        newColor: "var(--bg-cell)",
        newPercent: 0,
      });
    }
  });

  // Only push if there was something to reset
  if (resetStroke.length > 0) {
    historyStack.push(resetStroke);
    // Keep only last 10 resets/strokes
    if (historyStack.length > MAX_HISTORY) {
      historyStack.shift();
    }
  }

  // Now clear the canvas
  cells.forEach((cell) => {
    cell.style.backgroundColor = "var(--bg-cell)";
    cell.dataset.percent = 0;
  });
});

/* Theme Logic */
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
    },
  },
  synthwave: {
    name: "Synthwave '84",
    id: "synthwave",
    colors: {
      "--bg-main": "#2b213a",
      "--bg-container": "#241b2f",
      "--bg-cell": "#090b20",
      "--border-cell": "rgba(255, 0, 212, 0.2)",
      "--text-main": "#fffb96",
      "--btn-bg": "#ff71ce",
      "--btn-text": "#2b213a",
      "--btn-border": "#05ffa1",
      "--btn-hover": "#b967ff",
      "--btn-active-bg": "#01cdfe",
      "--btn-active-text": "#000000",
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
    },
  },
  cyberpunk: {
    name: "Cyberpunk",
    id: "cyberpunk",
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
    },
  },
};

let customThemes = {};
let activeThemeId = "poolsuite";

const themeModal = document.getElementById("themeModal");
const themeBtn = document.getElementById("themeBtn");
const closeModal = document.querySelector(".close");
const saveCustomBtn = document.getElementById("saveCustomThemeBtn");
const themePresetsContainer = document.querySelector(".theme-presets");

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
  const custom = localStorage.getItem("customThemes");
  if (custom) {
    try {
      customThemes = JSON.parse(custom);
    } catch (e) {
      console.error("Error loading custom themes", e);
      customThemes = {};
    }
  }
}

function saveCustomThemesToStorage() {
  localStorage.setItem("customThemes", JSON.stringify(customThemes));
}

function deleteTheme(e, id) {
  e.stopPropagation(); // Prevent applying the theme
  if (confirm("Are you sure you want to delete this theme?")) {
    delete customThemes[id];
    saveCustomThemesToStorage();
    // If deleted theme was active, revert to default
    if (activeThemeId === id) {
      applyTheme(defaultThemes.poolsuite.colors);
      activeThemeId = "poolsuite";
      localStorage.setItem("pixelArtThemeId", activeThemeId);
    }
    renderThemeOptions();
  }
}

function renameTheme(e, id) {
  e.stopPropagation();
  const newName = prompt("Enter new name for theme:", customThemes[id].name);
  if (newName && newName.trim() !== "") {
    customThemes[id].name = newName.trim();
    saveCustomThemesToStorage();
    renderThemeOptions();
  }
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

  themeCard.appendChild(preview);
  themeCard.appendChild(name);

  if (isCustom) {
    const actions = document.createElement("div");
    actions.classList.add("card-actions");

    const renameBtn = document.createElement("button");
    renameBtn.innerHTML = "✎";
    renameBtn.title = "Rename";
    renameBtn.onclick = (e) => renameTheme(e, theme.id);

    const deleteBtn = document.createElement("button");
    deleteBtn.innerHTML = "×";
    deleteBtn.title = "Delete";
    deleteBtn.classList.add("delete-btn");
    deleteBtn.onclick = (e) => deleteTheme(e, theme.id);

    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    themeCard.appendChild(actions);
  }

  themeCard.onclick = () => {
    applyTheme(theme.colors);
    activeThemeId = theme.id;
    localStorage.setItem("pixelArtThemeId", activeThemeId);

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

// (Previous initialization removed to prevent duplicates)

// --- INITIALIZATION ---

// 1. Load Custom Themes from Storage
loadCustomThemes();

// 2. Determine Active Theme
const savedThemeId = localStorage.getItem("pixelArtThemeId");
activeThemeId = savedThemeId || "poolsuite";

let initialColors = defaultThemes.poolsuite.colors;
if (defaultThemes[activeThemeId]) {
  initialColors = defaultThemes[activeThemeId].colors;
} else if (customThemes[activeThemeId]) {
  initialColors = customThemes[activeThemeId].colors;
}

// 3. Apply Theme IMMEDIATELY
applyTheme(initialColors);

// 4. Create Grid (Classic Mode) - Critical Fix: Must run NOW.
// createGrid(16); // Managed by initApp now

// 5. Render Options
renderThemeOptions();

// 6. Force verify base colors after a short delay (just in case CSS vars lag)
// This is a safety check, but the grid is already built so user can see it.
setTimeout(() => {
  const bgCell = getComputedStyle(document.documentElement).getPropertyValue(
    "--bg-cell"
  );
  if (bgCell) {
    const rgb = parseColorString(bgCell.trim());
    if (rgb) cachedBaseColors = rgb;
  }
}, 100);

// Open Modal
themeBtn.onclick = () => {
  renderThemeOptions(); // Re-render to show active state and new themes
  themeModal.classList.add("show");
};

// Close Modal
closeModal.onclick = () => {
  themeModal.classList.remove("show");
};

window.onclick = (event) => {
  if (event.target === themeModal) {
    themeModal.classList.remove("show");
  }
};

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
  };
}

// Handle Preview Only
applyPreviewBtn.onclick = () => {
  const previewColors = getValuesFromInputs();
  applyTheme(previewColors);
  // Do NOT set activeThemeId or save to localStorage yet
  // This allows user to "try" without committing
  themeModal.classList.remove("show");
};

// Handle Custom Theme Save & Apply
saveCustomBtn.onclick = () => {
  const name = customInputs.name.value.trim() || `Custom Theme ${Date.now()}`;
  const id = `custom_${Date.now()}`;

  const customTheme = {
    name: name,
    id: id,
    colors: getValuesFromInputs(),
  };

  customThemes[id] = customTheme;
  saveCustomThemesToStorage();

  // Apply immediately
  applyTheme(customTheme.colors);
  activeThemeId = id;
  localStorage.setItem("pixelArtThemeId", id);

  themeModal.classList.remove("show");

  // Clear Name input (optional)
  customInputs.name.value = "";
};

// Robust Color Parser using the Browser's own engine
function parseColorString(colorStr) {
  // Use a temporary element to let the browser normalize the color
  const dummy = document.createElement("div");
  dummy.style.color = colorStr;
  dummy.style.display = "none";
  document.body.appendChild(dummy);

  const computedColor = window.getComputedStyle(dummy).color;
  document.body.removeChild(dummy);

  // Computed color is ALWAYS "rgb(r, g, b)" or "rgba(r, g, b, a)"
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

  // Fallback ONLY if browser completely failed to parse
  console.warn(`Failed to parse color: ${colorStr}, defaulting to White`);
  return { r: 255, g: 255, b: 255 };
}

function applyTheme(themeObj) {
  for (const [key, value] of Object.entries(themeObj)) {
    document.documentElement.style.setProperty(key, value);
  }

  // CACHE the base color for mixing
  if (themeObj["--bg-cell"]) {
    cachedBaseColors = parseColorString(themeObj["--bg-cell"]);
  }

  // Also update existing cells to the new grid color if they are "empty"
  const cells = document.querySelectorAll(".cell");
  cells.forEach((cell) => {
    // If cell is "blank" (percent 0), reset it to use the new var or update it.
    if (!cell.dataset.percent || cell.dataset.percent === "0") {
      cell.style.backgroundColor = "var(--bg-cell)";
    }
  });
}

/* Export Logic */
const exportMainBtn = document.getElementById("exportMainBtn");
const exportMenu = document.getElementById("exportMenu");
const exportStickerBtn = document.getElementById("exportStickerBtn");
const exportPngBtn = document.getElementById("exportPngBtn");

exportMainBtn.addEventListener("click", (e) => {
  e.stopPropagation(); // Prevent immediate closing
  exportMenu.classList.toggle("hidden");
});

document.addEventListener("click", (e) => {
  if (
    !exportMenu.classList.contains("hidden") &&
    !exportMenu.contains(e.target) &&
    e.target !== exportMainBtn
  ) {
    exportMenu.classList.add("hidden");
  }
});

exportStickerBtn.addEventListener("click", () => {
  // Save sticker directly to Photos for reliable "Add to Stickers" workflow
  exportStickerToPhotos();
  exportMenu.classList.add("hidden");
});

exportPngBtn.addEventListener("click", () => {
  exportCanvas(false, false); // false for transparent, false for clipboard (use Share)
  exportMenu.classList.add("hidden");
});

async function exportStickerToPhotos() {
  const canvas = document.createElement("canvas");
  const size = 1048;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // Get current grid size
  const cells = document.querySelectorAll(".cell");
  const gridCount = Math.sqrt(cells.length);
  const cellSize = size / gridCount;

  // Transparent background - no fill

  // Draw Cells
  cells.forEach((cell, index) => {
    const row = Math.floor(index / gridCount);
    const col = index % gridCount;
    const percent = parseFloat(cell.dataset.percent || 0);
    const backgroundColor = getComputedStyle(cell).backgroundColor;

    if (percent > 0) {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(col * cellSize, row * cellSize, cellSize + 1, cellSize + 1);
    }
  });

  const dataURL = canvas.toDataURL("image/png");

  // Use Capacitor Media plugin to save to Photos
  if (
    window.Capacitor &&
    window.Capacitor.Plugins &&
    window.Capacitor.Plugins.Media
  ) {
    try {
      await window.Capacitor.Plugins.Media.savePhoto({
        path: dataURL, // The plugin accepts data URLs
        albumIdentifier: undefined, // Saves to Camera Roll
      });
      alert("Saved to Gallery");
    } catch (e) {
      console.error("Save to Photos failed", e);
      alert("Could not save to Photos. Error: " + e.message);
    }
  } else {
    // Fallback for web: Download the file
    const link = document.createElement("a");
    link.download = "pixy-sticker.png";
    link.href = dataURL;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    alert(
      "Sticker downloaded! On mobile, use the native app for direct Photos saving."
    );
  }
}

function exportCanvas(isTransparent, isClipboard) {
  const canvas = document.createElement("canvas");
  const size = 1048; // Moderate resolution for clipboard
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // Get current grid size
  const cells = document.querySelectorAll(".cell");
  const gridCount = Math.sqrt(cells.length);
  const cellSize = size / gridCount;

  // 1. Fill Background (if not transparent)
  if (!isTransparent) {
    // Get current grid background color
    const containerStyle = getComputedStyle(
      document.querySelector(".container")
    );
    ctx.fillStyle = containerStyle.backgroundColor;
    ctx.fillRect(0, 0, size, size);
  }

  // 2. Draw Cells
  cells.forEach((cell, index) => {
    const row = Math.floor(index / gridCount);
    const col = index % gridCount;

    const percent = parseFloat(cell.dataset.percent || 0);
    const backgroundColor = getComputedStyle(cell).backgroundColor;

    if (percent > 0) {
      ctx.fillStyle = backgroundColor;
      // Draw with slight overlap to prevent gaps
      ctx.fillRect(col * cellSize, row * cellSize, cellSize + 1, cellSize + 1);
    }
  });

  if (isClipboard) {
    const dataURL = canvas.toDataURL("image/png");
    copyToClipboard(dataURL);
  } else {
    // 3. Convert to Blob to share
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `pixy-export-${
      isTransparent ? "sticker" : "image"
    }-${timestamp}.png`;

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      shareFile(blob, filename);
    }, "image/png");
  }
}

async function copyToClipboard(base64Data) {
  try {
    let base64String = base64Data;
    if (base64String.indexOf(",") > -1) {
      base64String = base64String.split(",")[1];
    }

    if (
      window.Capacitor &&
      window.Capacitor.Plugins &&
      window.Capacitor.Plugins.Clipboard
    ) {
      await window.Capacitor.Plugins.Clipboard.write({
        image: base64String,
      });
      alert("Sticker copied! Paste it anywhere.");
    } else {
      try {
        const blob = await (await fetch(base64Data)).blob();
        // Check if Clipboard Item API is supported (Safari requires it)
        if (typeof ClipboardItem !== "undefined") {
          await navigator.clipboard.write([
            new ClipboardItem({
              [blob.type]: blob,
            }),
          ]);
          alert("Sticker copied to clipboard!");
        } else {
          // Fallback for older browsers or non-secure context
          alert("Clipboard API not supported in this context.");
        }
      } catch (err) {
        console.error("Clipboard API failed", err);
        alert(
          "Could not copy to clipboard. Ensure you are on a secure (HTTPS) context."
        );
      }
    }
  } catch (e) {
    console.error("Copy failed", e);
    alert("Failed to copy sticker.");
  }
}

async function shareFile(blob, filename) {
  // Use Capacitor Native Share if available
  if (window.Capacitor && window.Capacitor.Plugins) {
    try {
      const { Filesystem, Share } = window.Capacitor.Plugins;

      // Convert Blob to Base64
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64Data = reader.result;
        // Write to Cache
        try {
          // filename example: "pixy-sticker-123.png"
          const writeFileResult = await Filesystem.writeFile({
            path: filename,
            data: base64Data, // WriteFile handles data URLs correctly or regular base64
            directory: "CACHE", // Use Cache to avoid cluttering Documents
            recursive: true,
          });

          // Shared URI
          const uri = writeFileResult.uri;

          await Share.share({
            files: [uri], // Sharing as files triggers image context
            dialogTitle: "Share your sticker",
          });
        } catch (fsErr) {
          console.error("Filesystem write failed", fsErr);
          // Fallback to Web Share if FS fails
          webShareFallback(blob, filename);
        }
      };
    } catch (e) {
      console.error("Native share failed", e);
      webShareFallback(blob, filename);
    }
  } else {
    // Normal Web Environment
    webShareFallback(blob, filename);
  }
}

async function webShareFallback(blob, filename) {
  if (
    navigator.canShare &&
    navigator.canShare({
      files: [new File([blob], filename, { type: "image/png" })],
    })
  ) {
    try {
      const file = new File([blob], filename, { type: "image/png" });
      await navigator.share({
        title: "Pixy Export",
        text: "Check out my pixel art!",
        files: [file],
      });
    } catch (err) {
      console.warn("Share failed or cancelled:", err);
      downloadFile(blob, filename);
    }
  } else {
    downloadFile(blob, filename);
  }
}

function downloadFile(blob, filename) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = URL.createObjectURL(blob);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

// --- SAVE / DRAFT SYSTEM ---
const saveDraftBtn = document.getElementById("saveDraftBtn");
// savedList is declared earlier at line 371
let isEditMode = false;

if (saveDraftBtn) {
  saveDraftBtn.addEventListener("click", saveDraft);
}

// Exit edit mode when clicking outside
document.addEventListener("click", (e) => {
  if (isEditMode && !e.target.closest(".saved-item")) {
    toggleEditMode(false);
  }
});

function toggleEditMode(active) {
  isEditMode = active;
  if (isEditMode) {
    savedList.classList.add("edit-mode");
    if (navigator.vibrate) navigator.vibrate(50);
  } else {
    savedList.classList.remove("edit-mode");
  }
}

function saveDraft() {
  const cells = document.querySelectorAll(".cell");
  if (cells.length === 0) return;
  const gridCount = Math.sqrt(cells.length);

  const cellData = [];
  cells.forEach((cell) => {
    cellData.push({
      color: cell.style.backgroundColor,
      percent: cell.dataset.percent || "0",
    });
  });

  // Generate Thumbnail
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 100;
  const ctx = canvas.getContext("2d");
  const cellSize = 100 / gridCount;

  cells.forEach((cell, i) => {
    const r = Math.floor(i / gridCount);
    const c = i % gridCount;
    const p = cell.dataset.percent || "0";
    if (p !== "0") {
      ctx.fillStyle = cell.style.backgroundColor;
      ctx.fillRect(c * cellSize, r * cellSize, cellSize + 1, cellSize + 1);
    }
  });

  const thumbnail = canvas.toDataURL();

  const save = {
    id: Date.now(),
    gridCount,
    data: cellData,
    thumbnail,
  };

  const saves = JSON.parse(localStorage.getItem("pixy_saves") || "[]");
  saves.unshift(save);
  // Limit saves to 20
  if (saves.length > 20) saves.pop();
  localStorage.setItem("pixy_saves", JSON.stringify(saves));

  renderSavedDrawings();

  // Visual Feedback
  const originalText = saveDraftBtn.textContent;
  saveDraftBtn.textContent = "Saved!";
  setTimeout(() => (saveDraftBtn.textContent = originalText), 1000);
}

function renderSavedDrawings() {
  let saves = [];
  try {
    saves = JSON.parse(localStorage.getItem("pixy_saves") || "[]");
  } catch (e) {
    console.warn("LocalStorage access failed", e);
    return; // Exit if we can't read saves
  }

  // 1. Sidebar (Desktop/Landscape)
  if (savedList) {
    savedList.innerHTML = "";
    populateList(savedList, saves);
  }

  // 2. Mobile Modal Grid
  if (mobileSavedList) {
    mobileSavedList.innerHTML = "";
    populateList(mobileSavedList, saves);
  }
}

function populateList(container, saves) {
  saves.forEach((save) => {
    const div = document.createElement("div");
    div.className = "saved-item";

    const del = document.createElement("div");
    del.className = "delete-save";
    del.innerHTML = "&times;";
    del.onclick = (e) => {
      e.stopPropagation();
      deleteSave(save.id);
    };

    const img = document.createElement("img");
    img.src = save.thumbnail;
    img.draggable = false;

    // Click: Load if normal
    div.onclick = () => {
      if (!isEditMode) {
        loadDraft(save);
        // If in modal, close it
        if (
          document
            .getElementById("savedProjectsModal")
            .classList.contains("active")
        ) {
          toggleSavedModal();
        }
      }
    };

    // Long Press for "Jiggle" / Edit Mode
    let pressTimer;
    const startPress = () => {
      pressTimer = setTimeout(() => {
        toggleEditMode(true);
      }, 600);
    };
    const cancelPress = () => clearTimeout(pressTimer);

    div.addEventListener("pointerdown", startPress);
    div.addEventListener("pointerup", cancelPress);
    div.addEventListener("pointerleave", cancelPress);

    div.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    div.appendChild(img);
    div.appendChild(del);
    container.appendChild(div);
  });
}

function deleteSave(id) {
  if (!confirm("Delete this saved drawing?")) return;
  let saves = JSON.parse(localStorage.getItem("pixy_saves") || "[]");
  saves = saves.filter((s) => s.id !== id);
  localStorage.setItem("pixy_saves", JSON.stringify(saves));

  // If no saves left, exit edit mode
  if (saves.length === 0) toggleEditMode(false);

  renderSavedDrawings();
}

function loadDraft(save) {
  if (
    document.querySelectorAll(".cell[data-percent]:not([data-percent='0'])")
      .length > 0 &&
    !confirm("Load saved drawing? Unsaved changes will be lost.")
  ) {
    return;
  }
  createGrid(save.gridCount);
  const cells = document.querySelectorAll(".cell");
  save.data.forEach((d, i) => {
    if (cells[i]) {
      cells[i].style.backgroundColor = d.color;
      cells[i].dataset.percent = d.percent;
    }
  });
}
