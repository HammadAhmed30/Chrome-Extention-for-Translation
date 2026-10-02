// Settings UI. DEFAULT_SETTINGS and LANGUAGES come from config.js.

const fields = {
  siteEnabled: document.getElementById("siteEnabled"),
  language: document.getElementById("language"),
  readingLanguage: document.getElementById("readingLanguage"),
  outputMode: document.getElementById("outputMode"),
  level: document.getElementById("level"),
  tone: document.getElementById("tone"),
  model: document.getElementById("model"),
  readingModel: document.getElementById("readingModel"),
  apiKey: document.getElementById("apiKey")
};
const siteHostEl = document.getElementById("siteHost");
const siteEnabledLabelEl = document.getElementById("siteEnabledLabel");
const siteNoteEl = document.getElementById("siteNote");
const statusEl = document.getElementById("status");
const themeGridEl = document.getElementById("themeGrid");
const SETTING_KEYS = [
  "language",
  "readingLanguage",
  "outputMode",
  "level",
  "tone",
  "model",
  "readingModel",
  "theme"
];

let currentSiteKey = "";
let enabledSites = { ...DEFAULT_ENABLED_SITES };
let activeTheme = DEFAULT_THEME;

for (const select of [fields.language, fields.readingLanguage]) {
  for (const language of LANGUAGES) {
    const option = document.createElement("option");
    option.value = language;
    option.textContent = language;
    select.appendChild(option);
  }
}

function fillOptions(select, items) {
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  }
}

fillOptions(fields.model, MODELS);
fillOptions(fields.readingModel, MODELS);
fillOptions(fields.level, LEVELS);
fillOptions(fields.tone, TONES);

function showStatus(text) {
  statusEl.textContent = text;
  setTimeout(() => {
    if (statusEl.textContent === text) statusEl.textContent = "";
  }, 1600);
}

function setThemeSelection(themeId) {
  activeTheme = normalizeThemeId(themeId);
  applyThemeToRoot(document.documentElement, activeTheme);

  for (const button of themeGridEl.querySelectorAll(".theme-option")) {
    const selected = button.dataset.theme === activeTheme;
    button.setAttribute("aria-checked", selected ? "true" : "false");
  }
}

function saveTheme(themeId) {
  const nextTheme = normalizeThemeId(themeId);
  chrome.storage.sync.set({ theme: nextTheme }, () => {
    setThemeSelection(nextTheme);
    showStatus("Theme saved");
  });
}

function buildThemePicker() {
  themeGridEl.textContent = "";

  for (const theme of THEMES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-option";
    button.dataset.theme = theme.id;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", "false");
    button.setAttribute("aria-label", theme.label);

    const swatch = document.createElement("div");
    swatch.className = "theme-swatch";
    swatch.setAttribute("aria-hidden", "true");

    const accent = document.createElement("span");
    accent.style.background = theme.swatch[0];
    const bg = document.createElement("span");
    bg.style.background = theme.swatch[1];
    swatch.append(accent, bg);

    const name = document.createElement("span");
    name.className = "theme-name";
    name.textContent = theme.label;

    button.append(swatch, name);
    button.addEventListener("click", () => saveTheme(theme.id));
    themeGridEl.appendChild(button);
  }
}

function setSiteUi({ hostname, siteKey, enabled, supported }) {
  currentSiteKey = siteKey;
  siteHostEl.textContent = hostname || siteKey || "Unknown site";
  fields.siteEnabled.checked = enabled;
  fields.siteEnabled.disabled = !siteKey;

  if (!siteKey) {
    siteEnabledLabelEl.textContent = "Open a website tab first";
    siteNoteEl.textContent = "";
    return;
  }

  siteEnabledLabelEl.textContent = `Enable on ${siteKey}`;
  siteNoteEl.textContent = supported
    ? "Supported chat site — composer bar and message translation should work here."
    : "Generic mode — works on many chat boxes. Open a conversation after enabling.";
}

async function loadCurrentSite(storedEnabledSites) {
  enabledSites = { ...DEFAULT_ENABLED_SITES, ...storedEnabledSites };

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || "";
    if (!/^https?:\/\//.test(url)) {
      setSiteUi({ hostname: "Not a website", siteKey: "", enabled: false, supported: false });
      return;
    }

    const hostname = new URL(url).hostname;
    const siteKey = getSiteKey(hostname);
    const adapter = pickAdapter(hostname);
    const supported = adapter.id !== "generic";

    setSiteUi({
      hostname,
      siteKey,
      enabled: !!enabledSites[siteKey],
      supported
    });
  } catch (err) {
    setSiteUi({ hostname: "Could not read tab", siteKey: "", enabled: false, supported: false });
  }
}

function saveEnabledSites(nextEnabledSites) {
  enabledSites = nextEnabledSites;
  chrome.storage.sync.set({ enabledSites: nextEnabledSites }, () => showStatus("Saved"));
}

buildThemePicker();

chrome.storage.sync.get(DEFAULT_SETTINGS, async (stored) => {
  const settings = { ...DEFAULT_SETTINGS, ...stored };

  if (stored.enabled !== undefined && !stored.enabledSites) {
    settings.enabledSites = {
      ...DEFAULT_ENABLED_SITES,
      "web.whatsapp.com": stored.enabled
    };
    chrome.storage.sync.set({ enabledSites: settings.enabledSites });
  }

  for (const key of SETTING_KEYS) {
    if (key === "theme") continue;
    fields[key].value = settings[key];
  }
  fields.apiKey.value = settings.apiKey;
  setThemeSelection(settings.theme);

  await loadCurrentSite(settings.enabledSites);
});

fields.siteEnabled.addEventListener("change", () => {
  if (!currentSiteKey) return;

  const nextEnabledSites = { ...enabledSites, [currentSiteKey]: fields.siteEnabled.checked };
  saveEnabledSites(nextEnabledSites);
});

for (const key of SETTING_KEYS) {
  if (key === "theme") continue;
  fields[key].addEventListener("change", () => {
    chrome.storage.sync.set({ [key]: fields[key].value }, () => showStatus("Saved"));
  });
}

document.getElementById("save").addEventListener("click", () => {
  const payload = { apiKey: fields.apiKey.value.trim(), theme: activeTheme };
  for (const key of SETTING_KEYS) {
    if (key === "theme") continue;
    payload[key] = fields[key].value;
  }
  chrome.storage.sync.set(payload, () => showStatus("Saved"));
});
