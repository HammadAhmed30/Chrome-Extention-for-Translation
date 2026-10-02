// Adds a composer bar over the site's message box on enabled websites.
// Enter in that bar -> Mistral corrects the English and translates it ->
// the combined message is pushed into the site's own box and sent.

(() => {
  "use strict";

  const BAR_ID = "wat-bar";
  const LANGUAGES = [
    "German",
    "Spanish",
    "French",
    "Italian",
    "Portuguese",
    "Dutch",
    "Polish",
    "Swedish",
    "Turkish",
    "Arabic",
    "Urdu",
    "Hindi",
    "Russian",
    "Chinese (Simplified)",
    "Japanese",
    "Korean",
    "Indonesian"
  ];

  const siteKey = getSiteKey(location.hostname);
  const adapter = pickAdapter(location.hostname);

  let settings = {
    enabledSites: { ...DEFAULT_ENABLED_SITES },
    language: "German",
    outputMode: "both",
    level: "Native",
    tone: "Match my message",
    readingLanguage: "English",
    theme: DEFAULT_THEME
  };
  let siteEnabled = false;
  let active = false;
  let busy = false;
  let collapsed = false;
  let els = null;
  let trackedFooter = null;
  let footerResizeObserver = null;
  let syncTimer = null;
  let mutationObserver = null;
  let reposition = null;

  let hoveredBubble = null;
  let activeReadBubble = null;
  let panelBubble = null;
  let readEls = null;
  let hideReadButtonTimer = null;
  const READ_BTN_W = 28;
  const READ_BTN_H = 24;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isEnabledForSite(enabledSites) {
    return !!(enabledSites && enabledSites[siteKey]);
  }

  function applyThemeToUi() {
    applyThemeToElements(
      [els?.bar, els?.pill, readEls?.button, readEls?.panel],
      settings.theme
    );
  }

  async function loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
      if (response?.ok) settings = { ...settings, ...response.settings };
    } catch (err) {
      /* keep defaults */
    }
    siteEnabled = isEnabledForSite(settings.enabledSites);
    if (els) els.select.value = settings.language;
    applyThemeToUi();
  }

  /* ------------------------------------------------------------- Site DOM */

  function findFooter() {
    return adapter.findFooter();
  }

  function findComposer() {
    return adapter.findComposer();
  }

  function findSendButton() {
    return adapter.findSendButton();
  }

  function insertText(composer, text) {
    composer.focus();

    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      const notPrevented = composer.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
      );
      if (!notPrevented) return true;
    } catch (err) {
      /* fall through to execCommand */
    }

    return document.execCommand("insertText", false, text);
  }

  function clearComposer(composer) {
    composer.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
  }

  function pressEnter(composer) {
    for (const type of ["keydown", "keypress", "keyup"]) {
      composer.dispatchEvent(
        new KeyboardEvent(type, {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        })
      );
    }
  }

  async function sendToSite(text) {
    const composer = findComposer();
    if (!composer) {
      throw new Error("Could not find the message box. Open a chat first.");
    }

    clearComposer(composer);
    if (!insertText(composer, text)) {
      throw new Error("Could not write into the message box.");
    }

    await wait(150);

    const button = findSendButton();
    if (button) {
      button.click();
    } else {
      pressEnter(composer);
    }

    await wait(150);
    const after = findComposer();
    if (after && after.textContent.trim()) {
      pressEnter(after);
    }
  }

  /* ------------------------------------------------------------ Formatting */

  function formatMessage(result) {
    const corrected = (result.corrected || "").trim();
    const translation = (result.translation || "").trim();

    if (settings.outputMode === "corrected") return corrected || translation;
    if (settings.outputMode === "translation" || !corrected) {
      return translation || corrected;
    }
    if (!translation) return corrected;

    return `${corrected}\n\nTranslation (${settings.language}):\n\n${translation}`;
  }

  /* ------------------------------------------------------------------- Bar */

  function setStatus(text, kind) {
    if (!els) return;
    els.status.textContent = text || "";
    els.status.className = "wat-status" + (kind ? ` wat-status--${kind}` : "");
  }

  function autoGrow(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 110)}px`;
    position();
  }

  function setBusy(state) {
    busy = state;
    if (!els) return;
    els.bar.classList.toggle("wat-bar--busy", state);
    els.send.disabled = state;
    els.input.readOnly = state;
  }

  async function submit() {
    if (!els || busy) return;

    const text = els.input.value.trim();
    if (!text) return;

    setBusy(true);
    setStatus(
      settings.outputMode === "corrected"
        ? "Correcting the English…"
        : `Correcting and translating to ${settings.language}…`,
      "working"
    );

    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: "TRANSLATE",
        text,
        language: settings.language
      });
    } catch (err) {
      setBusy(false);
      setStatus("Extension was reloaded — refresh this tab to reconnect.", "error");
      return;
    }

    if (!response || !response.ok) {
      setBusy(false);
      setStatus(response?.error || "Translation failed.", "error");
      return;
    }

    try {
      await sendToSite(formatMessage(response));
      els.input.value = "";
      autoGrow(els.input);
      setStatus("Sent.", "ok");
      setTimeout(() => setStatus(""), 1500);
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      setBusy(false);
      els.input.focus();
    }
  }

  function buildBar() {
    const bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.className = "wat-bar";

    const row = document.createElement("div");
    row.className = "wat-row";

    const badge = document.createElement("span");
    badge.className = "wat-badge";
    badge.textContent = "TR";
    badge.title = "Translate composer — Enter sends the corrected + translated message";

    const input = document.createElement("textarea");
    input.className = "wat-input";
    input.rows = 1;
    input.placeholder = "Type in English — Enter sends corrected English + translation";
    input.spellcheck = true;

    const select = document.createElement("select");
    select.className = "wat-select";
    select.title = "Target language";
    for (const language of LANGUAGES) {
      const option = document.createElement("option");
      option.value = language;
      option.textContent = language;
      select.appendChild(option);
    }

    const send = document.createElement("button");
    send.className = "wat-send";
    send.type = "button";
    send.textContent = "Translate & send";

    const hide = document.createElement("button");
    hide.className = "wat-hide";
    hide.type = "button";
    hide.textContent = "×";
    hide.title = "Hide — use the site's own message box";

    const status = document.createElement("div");
    status.className = "wat-status";

    row.append(badge, input, select, send, hide);
    bar.append(row, status);

    const pill = document.createElement("button");
    pill.id = "wat-pill";
    pill.className = "wat-pill";
    pill.type = "button";
    pill.textContent = "TR";
    pill.title = "Show the translate composer";
    pill.style.display = "none";

    for (const type of ["keydown", "keyup", "keypress", "beforeinput", "input", "paste"]) {
      bar.addEventListener(type, (event) => event.stopPropagation());
    }

    input.addEventListener("input", () => autoGrow(input));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submit();
      } else if (event.key === "Escape") {
        input.value = "";
        autoGrow(input);
        setStatus("");
      }
    });

    send.addEventListener("click", submit);
    hide.addEventListener("click", () => setCollapsed(true));
    pill.addEventListener("click", () => {
      setCollapsed(false);
      els.input.focus();
    });

    select.addEventListener("change", () => {
      settings.language = select.value;
      chrome.storage.sync.set({ language: select.value });
      setStatus(`Target language: ${select.value}`, "ok");
      setTimeout(() => setStatus(""), 1500);
      input.focus();
    });

    els = { bar, input, select, send, hide, status, pill };
    select.value = settings.language;
    applyThemeToUi();
    return bar;
  }

  function setCollapsed(state) {
    collapsed = state;
    if (!els) return;
    els.bar.style.display = state ? "none" : "";
    els.pill.style.display = state ? "" : "none";
    position();
  }

  /* -------------------------------------------------------------- Position */

  function hideAll() {
    if (!els) return;
    els.bar.style.display = "none";
    els.pill.style.display = "none";
  }

  function position() {
    if (!els || !siteEnabled) return;

    const footer = findFooter();
    if (!footer) {
      hideAll();
      return;
    }

    const rect = footer.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      hideAll();
      return;
    }

    const left = Math.round(rect.left);
    const width = Math.round(rect.width);
    const bottom = Math.round(Math.max(0, window.innerHeight - rect.bottom));

    if (collapsed) {
      els.bar.style.display = "none";
      els.pill.style.display = "";
      els.pill.style.left = `${left + width - 52}px`;
      els.pill.style.bottom = `${bottom + Math.round(rect.height) + 6}px`;
      return;
    }

    els.pill.style.display = "none";

    const bar = els.bar;
    bar.style.display = "";
    bar.style.left = `${left}px`;
    bar.style.width = `${width}px`;
    bar.style.bottom = `${bottom}px`;
    bar.style.minHeight = `${Math.round(rect.height)}px`;
  }

  function trackFooter() {
    const footer = findFooter();
    if (footer === trackedFooter) return;

    trackedFooter = footer;
    footerResizeObserver?.disconnect();
    if (footer && typeof ResizeObserver !== "undefined") {
      footerResizeObserver = new ResizeObserver(position);
      footerResizeObserver.observe(footer);
    }
  }

  function sync() {
    if (!siteEnabled) {
      teardownUi();
      return;
    }

    mountReadUI();

    const bar = els?.bar || buildBar();
    if (!bar.isConnected) {
      document.body.appendChild(bar);
      autoGrow(els.input);
    }
    if (!els.pill.isConnected) {
      document.body.appendChild(els.pill);
    }

    trackFooter();
    position();
  }

  /* -------------------------------------------- Translating what you receive */

  function bubbleText(bubble) {
    return adapter.bubbleText(bubble);
  }

  function findBubble(target) {
    return adapter.findBubble(target);
  }

  function bubbleAnchor(bubble) {
    return adapter.bubbleAnchor(bubble);
  }

  function buildReadUI() {
    const button = document.createElement("button");
    button.id = "wat-msg-btn";
    button.className = "wat-msg-btn";
    button.type = "button";
    button.textContent = "文A";
    button.title = "Translate this message";
    button.style.display = "none";

    const panel = document.createElement("div");
    panel.id = "wat-panel";
    panel.className = "wat-panel";
    panel.style.display = "none";

    const head = document.createElement("div");
    head.className = "wat-panel-head";

    const title = document.createElement("span");
    title.className = "wat-panel-title";

    const close = document.createElement("button");
    close.className = "wat-panel-close";
    close.type = "button";
    close.textContent = "×";
    close.title = "Close";

    const body = document.createElement("div");
    body.className = "wat-panel-body";

    head.append(title, close);
    panel.append(head, body);

    for (const type of ["keydown", "keyup", "keypress", "click", "mousedown"]) {
      panel.addEventListener(type, (event) => event.stopPropagation());
    }

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      translateBubble(activeReadBubble || hoveredBubble);
    });
    button.addEventListener("mouseenter", () => clearHideReadButtonTimer());
    button.addEventListener("mouseleave", (event) => {
      if (readEls?.panel.contains(event.relatedTarget)) return;
      scheduleHideReadButton();
    });
    close.addEventListener("click", closePanel);

    readEls = { button, panel, title, body };
    applyThemeToUi();
    return readEls;
  }

  function clearHideReadButtonTimer() {
    if (!hideReadButtonTimer) return;
    clearTimeout(hideReadButtonTimer);
    hideReadButtonTimer = null;
  }

  function scheduleHideReadButton() {
    if (panelBubble) return;
    clearHideReadButtonTimer();
    hideReadButtonTimer = setTimeout(() => {
      hideReadButtonTimer = null;
      activeReadBubble = null;
      hoveredBubble = null;
      positionReadButton();
    }, 220);
  }

  function setActiveReadBubble(bubble) {
    clearHideReadButtonTimer();
    hoveredBubble = bubble;
    activeReadBubble = bubble;
    positionReadButton();
  }

  function closePanel() {
    panelBubble = null;
    if (readEls) readEls.panel.style.display = "none";
  }

  function showPanel(titleText, bodyText, kind) {
    if (!readEls) return;
    readEls.title.textContent = titleText;
    readEls.body.textContent = bodyText;
    readEls.body.className = "wat-panel-body" + (kind ? ` wat-panel-body--${kind}` : "");
    readEls.panel.style.display = "";
    positionPanel();
  }

  async function translateBubble(bubble) {
    if (!bubble || !bubble.isConnected) return;

    const text = bubbleText(bubble);
    if (!text) {
      panelBubble = bubble;
      showPanel("Nothing to translate", "This message has no text in it.", "error");
      return;
    }

    panelBubble = bubble;
    showPanel("Translating…", text.slice(0, 200), "working");

    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: "TRANSLATE_INCOMING", text });
    } catch (err) {
      showPanel("Error", "Extension was reloaded — refresh this tab to reconnect.", "error");
      return;
    }

    if (!response || !response.ok) {
      showPanel("Error", response?.error || "Translation failed.", "error");
      return;
    }

    const detected = response.detected ? `${response.detected} → ${settings.readingLanguage}` : "Translation";
    showPanel(detected, response.translation);
  }

  function positionReadButton() {
    if (!readEls) return;
    const button = readEls.button;
    const bubble = activeReadBubble || hoveredBubble;

    if (!bubble || !bubble.isConnected) {
      button.style.display = "none";
      return;
    }

    if (panelBubble && panelBubble === bubble) {
      button.style.display = "none";
      return;
    }

    const rect = bubbleAnchor(bubble).getBoundingClientRect();
    if (rect.height === 0 || rect.bottom < 0 || rect.top > window.innerHeight) {
      button.style.display = "none";
      return;
    }

    // Overlay sits inside the bubble bounds so the cursor never has to leave
    // the message to reach the button. Still lives in document.body only.
    const left = Math.round(
      Math.min(
        Math.max(rect.left + 4, rect.right - READ_BTN_W - 4),
        window.innerWidth - READ_BTN_W - 4
      )
    );
    const top = Math.round(
      Math.min(Math.max(rect.top + 2, 4), window.innerHeight - READ_BTN_H - 4)
    );

    button.style.display = "";
    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
  }

  function positionPanel() {
    if (!readEls || !panelBubble) return;
    const panel = readEls.panel;
    if (panel.style.display === "none") return;

    if (!panelBubble.isConnected) {
      closePanel();
      return;
    }

    const rect = panelBubble.getBoundingClientRect();
    const width = Math.min(380, Math.max(260, rect.width));
    panel.style.width = `${Math.round(width)}px`;

    const height = panel.offsetHeight || 90;
    const below = rect.bottom + 6;
    const top = below + height > window.innerHeight - 80 ? Math.max(8, rect.top - height - 6) : below;

    panel.style.left = `${Math.round(Math.min(rect.left, window.innerWidth - width - 12))}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  function onPointerMove(event) {
    if (!readEls) return;
    if (readEls.panel.contains(event.target)) return;
    if (event.target === readEls.button || readEls.button.contains(event.target)) {
      clearHideReadButtonTimer();
      return;
    }

    const bubble = findBubble(event.target);
    if (bubble) {
      if (bubble !== activeReadBubble) setActiveReadBubble(bubble);
      return;
    }

    scheduleHideReadButton();
  }

  function mountReadUI() {
    const { button, panel } = readEls || buildReadUI();
    if (!button.isConnected) document.body.appendChild(button);
    if (!panel.isConnected) document.body.appendChild(panel);
  }

  function teardownUi() {
    els?.bar.remove();
    els?.pill.remove();
    readEls?.button.remove();
    readEls?.panel.remove();
    els = null;
    readEls = null;
    hoveredBubble = null;
    activeReadBubble = null;
    panelBubble = null;
    clearHideReadButtonTimer();
    trackedFooter = null;
    footerResizeObserver?.disconnect();
    footerResizeObserver = null;
  }

  function scheduleSync() {
    if (!siteEnabled || syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      try {
        sync();
      } catch (err) {
        console.warn("[translate-composer] sync failed", err);
      }
    }, 250);
  }

  function start() {
    if (active) return;
    active = true;

    sync();

    mutationObserver = new MutationObserver(scheduleSync);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    reposition = () => {
      position();
      positionReadButton();
      positionPanel();
    };

    window.addEventListener("resize", reposition, { passive: true });
    window.addEventListener("scroll", reposition, { passive: true, capture: true });
    document.addEventListener("mouseover", onPointerMove, { passive: true, capture: true });
    document.addEventListener("keydown", onEscapeClose);

    setTimeout(() => adapter.logDiagnostics?.(), 4000);
  }

  function stop() {
    if (!active) return;
    active = false;

    mutationObserver?.disconnect();
    mutationObserver = null;

    if (reposition) {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("mouseover", onPointerMove, true);
      document.removeEventListener("keydown", onEscapeClose);
      reposition = null;
    }

    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }

    teardownUi();
  }

  function onEscapeClose(event) {
    if (event.key === "Escape") closePanel();
  }

  async function applySiteState() {
    await loadSettings();
    if (siteEnabled) start();
    else stop();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;

    for (const [key, change] of Object.entries(changes)) {
      settings[key] = change.newValue;
    }

    if (changes.enabledSites) {
      siteEnabled = isEnabledForSite(settings.enabledSites);
      applySiteState();
      return;
    }

    if (els) els.select.value = settings.language;
    if (changes.theme) applyThemeToUi();
    if (siteEnabled) sync();
  });

  applySiteState();
})();
