// Theme metadata for the picker UI. Visual tokens live in themes.css.

const DEFAULT_THEME = "sage";

const THEMES = [
  { id: "sage", label: "Sage", swatch: ["#4aab96", "#f4f6f9"] },
  { id: "whatsapp", label: "WhatsApp", swatch: ["#00a884", "#f0f2f5"] },
  { id: "ocean", label: "Ocean", swatch: ["#2563eb", "#f0f6fc"] },
  { id: "lavender", label: "Lavender", swatch: ["#7c6bc4", "#f7f5fc"] },
  { id: "sunset", label: "Sunset", swatch: ["#e07a5f", "#fdf6f0"] },
  { id: "rose", label: "Rose", swatch: ["#db7093", "#fdf5f8"] },
  { id: "forest", label: "Forest", swatch: ["#2d6a4f", "#f2f7f4"] },
  { id: "midnight", label: "Midnight", swatch: ["#38bdf8", "#0c1220"] },
  { id: "charcoal", label: "Charcoal", swatch: ["#a3a3a3", "#121212"] },
  { id: "amethyst", label: "Amethyst", swatch: ["#a78bfa", "#140f1c"] }
];

function normalizeThemeId(themeId) {
  return THEMES.some((theme) => theme.id === themeId) ? themeId : DEFAULT_THEME;
}

function applyThemeToRoot(root, themeId) {
  if (!root) return;
  root.dataset.theme = normalizeThemeId(themeId);
}

function applyThemeToElements(elements, themeId) {
  const id = normalizeThemeId(themeId);
  for (const el of elements) {
    if (el) el.dataset.theme = id;
  }
}
