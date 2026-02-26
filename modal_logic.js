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

