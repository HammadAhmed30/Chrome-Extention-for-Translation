// Site-specific DOM adapters. Each picks how to find the composer, send
// button, and incoming messages on a given host.

const DEFAULT_ENABLED_SITES = {
  "web.whatsapp.com": true
};

function getSiteKey(hostname) {
  return String(hostname || "")
    .replace(/^www\./, "")
    .toLowerCase();
}

function hostMatches(hostname, pattern) {
  const key = getSiteKey(hostname);
  return key === pattern || key.endsWith("." + pattern);
}

function extractText(node) {
  let out = "";
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.data;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      out += child.tagName === "IMG" ? child.getAttribute("alt") || "" : extractText(child);
    }
  }
  return out;
}

function visibleBottomComposer(candidates) {
  const visible = candidates.filter(
    (node) =>
      node.isConnected &&
      node.offsetParent !== null &&
      !node.closest("#wat-bar, #wat-panel, #wat-msg-btn")
  );
  if (!visible.length) return null;

  visible.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return rb.bottom - ra.bottom || rb.top - ra.top;
  });
  return visible[0];
}

function looksOutgoing(node) {
  let current = node;
  for (let depth = 0; depth < 10 && current; depth += 1) {
    if (
      current.classList?.contains("message-out") ||
      current.querySelector?.(".message-out")
    ) {
      return true;
    }

    const id =
      current.getAttribute?.("data-id") ||
      current.querySelector?.("[data-id]")?.getAttribute("data-id") ||
      "";
    if (id.startsWith("true_")) return true;

    const style = getComputedStyle(current);
    if (
      style.alignSelf === "flex-end" ||
      style.justifyContent === "flex-end" ||
      style.marginLeft === "auto" ||
      style.textAlign === "right"
    ) {
      return true;
    }

    current = current.parentElement;
  }
  return false;
}

function composerRoot(composer) {
  if (!composer) return null;
  return (
    composer.closest("footer") ||
    composer.closest("form") ||
    composer.closest('[role="textbox"]')?.parentElement?.parentElement ||
    composer.parentElement?.parentElement ||
    composer.parentElement
  );
}

function findSendNear(root, composer) {
  if (!root) return null;

  const selectors = [
    'button[aria-label*="Send" i]',
    'div[role="button"][aria-label*="Send" i]',
    'span[data-icon="send"]',
    'span[data-icon="wds-ic-send-filled"]',
    'button[data-tab="11"]',
    'button[type="submit"]'
  ];

  for (const selector of selectors) {
    const hit = root.querySelector(selector);
    if (!hit) continue;
    return hit.tagName === "BUTTON" ? hit : hit.closest("button, [role='button']") || hit;
  }

  const buttons = [...root.querySelectorAll("button, div[role='button']")].filter(
    (node) => node !== composer && !composer.contains(node)
  );
  if (!buttons.length) return null;

  for (const button of buttons) {
    const label = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`.toLowerCase();
    if (label.includes("send")) return button;
  }

  return buttons[buttons.length - 1];
}

const whatsappAdapter = {
  id: "whatsapp",
  hosts: ["web.whatsapp.com"],
  label: "WhatsApp Web",

  findFooter() {
    const footer = document.querySelector("#main footer") || document.querySelector("footer");
    return footer && footer.isConnected ? footer : null;
  },

  findComposer() {
    const footer = this.findFooter();
    if (!footer) return null;
    const candidates = footer.querySelectorAll('div[contenteditable="true"]');
    for (const node of candidates) {
      if (node.getAttribute("data-tab") === "10" || node.getAttribute("role") === "textbox") {
        return node;
      }
    }
    return candidates[0] || null;
  },

  findSendButton() {
    return findSendNear(this.findFooter(), this.findComposer());
  },

  bubbleText(bubble) {
    const spans = bubble.querySelectorAll("span.selectable-text, span.copyable-text");
    if (spans.length) {
      let text = "";
      for (const span of spans) text += (text ? "\n" : "") + extractText(span);
      return text.trim();
    }
    const copyable = bubble.querySelector("[data-pre-plain-text]");
    return copyable ? extractText(copyable).trim() : "";
  },

  findBubble(target) {
    if (!target || typeof target.closest !== "function") return null;

    const hit = target.closest(".message-in, .message-out, div[data-id], div[role='row']");
    if (!hit) return null;

    const bubble = hit.closest(".message-in") || hit;
    if (looksOutgoing(bubble)) return null;
    if (!this.bubbleText(bubble)) return null;
    return bubble;
  },

  bubbleAnchor(bubble) {
    return bubble.querySelector("[data-pre-plain-text]")?.parentElement || bubble;
  },

  logDiagnostics() {
    const counts = {
      "message-in": document.querySelectorAll(".message-in").length,
      "message-out": document.querySelectorAll(".message-out").length,
      "[data-id]": document.querySelectorAll("div[data-id]").length,
      "[role=row]": document.querySelectorAll("div[role='row']").length,
      "[data-pre-plain-text]": document.querySelectorAll("[data-pre-plain-text]").length,
      "span.selectable-text": document.querySelectorAll("span.selectable-text").length
    };
    console.log("[translate-composer] WhatsApp bubble selectors:", counts);
  }
};

const instagramAdapter = {
  id: "instagram",
  hosts: ["instagram.com"],
  label: "Instagram",

  findComposer() {
    const selectors = [
      'div[contenteditable="true"][role="textbox"][aria-label*="Message" i]',
      'div[contenteditable="true"][role="textbox"][aria-label*="Nachricht" i]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea[placeholder*="Message" i]',
      'textarea[aria-label*="Message" i]'
    ];

    for (const selector of selectors) {
      const hit = document.querySelector(selector);
      const composer = visibleBottomComposer(hit ? [hit] : []);
      if (composer) return composer;
    }

    return visibleBottomComposer([
      ...document.querySelectorAll(
        'div[contenteditable="true"][role="textbox"], textarea[placeholder], textarea[aria-label]'
      )
    ]);
  },

  findFooter() {
    return composerRoot(this.findComposer());
  },

  findSendButton() {
    return findSendNear(this.findFooter(), this.findComposer());
  },

  bubbleText(bubble) {
    const textNode = bubble.matches?.('div[dir="auto"], span[dir="auto"]')
      ? bubble
      : bubble.querySelector(':scope > div[dir="auto"], :scope > span[dir="auto"], div[dir="auto"], span[dir="auto"]');
    const text = textNode ? extractText(textNode).trim() : extractText(bubble).trim();
    return text.length > 4000 ? text.slice(0, 4000) : text;
  },

  isConversationText(textNode) {
    const composer = this.findComposer();
    const threadRoot = composer?.closest('[role="main"]');
    if (threadRoot) return threadRoot.contains(textNode);

    // Full-screen DM view: ignore the inbox list on the left.
    return !!textNode.closest('[role="main"], [role="presentation"]');
  },

  findBubble(target) {
    if (!target || typeof target.closest !== "function") return null;

    const textNode = target.closest('div[dir="auto"], span[dir="auto"]');
    if (!textNode || !textNode.textContent.trim()) return null;
    if (
      textNode.closest(
        '[contenteditable="true"], textarea, input, #wat-bar, #wat-panel, nav, header, [role="navigation"]'
      )
    ) {
      return null;
    }
    if (!this.isConversationText(textNode)) return null;

    const bubble = textNode;
    if (looksOutgoing(bubble)) return null;

    const text = this.bubbleText(bubble);
    if (!text || text.length < 2) return null;
    return bubble;
  },

  bubbleAnchor(bubble) {
    return bubble.matches?.('div[dir="auto"], span[dir="auto"]')
      ? bubble
      : bubble.querySelector('div[dir="auto"], span[dir="auto"]') || bubble;
  },

  logDiagnostics() {
    const counts = {
      composer: this.findComposer() ? 1 : 0,
      'div[dir="auto"]': document.querySelectorAll('div[dir="auto"]').length,
      'div[contenteditable="true"]': document.querySelectorAll('div[contenteditable="true"]').length
    };
    console.log("[translate-composer] Instagram selectors:", counts);
  }
};

const genericAdapter = {
  id: "generic",
  hosts: ["*"],
  label: "this site",

  findComposer() {
    return visibleBottomComposer([
      ...document.querySelectorAll(
        'div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-label], textarea:not([readonly])'
      )
    ]);
  },

  findFooter() {
    return composerRoot(this.findComposer());
  },

  findSendButton() {
    return findSendNear(this.findFooter(), this.findComposer());
  },

  bubbleText(bubble) {
    return extractText(bubble).trim();
  },

  findBubble(target) {
    if (!target || typeof target.closest !== "function") return null;

    const hit = target.closest(
      '[data-message-author-role="user"], [data-testid*="message"], .message-in, div[role="row"], p, span, div'
    );
    if (!hit || !hit.textContent.trim()) return null;
    if (hit.closest('[contenteditable="true"], textarea, input, #wat-bar, #wat-panel, nav, header, footer')) {
      return null;
    }

    const bubble = hit.closest('[data-testid*="message"], .message-in, div[role="row"]') || hit;
    if (looksOutgoing(bubble)) return null;
    const text = this.bubbleText(bubble);
    if (!text || text.length > 4000) return null;
    return bubble;
  },

  bubbleAnchor(bubble) {
    return bubble;
  },

  logDiagnostics() {
    console.log("[translate-composer] Generic adapter:", {
      composer: !!this.findComposer(),
      footer: !!this.findFooter(),
      send: !!this.findSendButton()
    });
  }
};

const SITE_ADAPTERS = [whatsappAdapter, instagramAdapter, genericAdapter];

function pickAdapter(hostname) {
  for (const adapter of SITE_ADAPTERS) {
    if (adapter.hosts.includes("*")) continue;
    if (adapter.hosts.some((pattern) => hostMatches(hostname, pattern))) return adapter;
  }
  return genericAdapter;
}
