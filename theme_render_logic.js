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
