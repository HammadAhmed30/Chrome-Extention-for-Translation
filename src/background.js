// Service worker: owns settings defaults and talks to the Mistral API.
// The network call lives here (not in the content script) so it isn't subject
// to web.whatsapp.com's page CSP or cross-origin restrictions.

const DEFAULT_SETTINGS = {
  enabledSites: {
    "web.whatsapp.com": true
  },
  apiKey: "tiFVHMbDB2ZmRt0rCz2QX1GJKp5VI2NG",
  model: "mistral-small-latest",
  language: "German",
  outputMode: "both",
  level: "Native",
  tone: "Match my message",
  readingLanguage: "English",
  readingModel: "mistral-small-latest",
  theme: "sage"
};

const MISTRAL_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
const MAX_MESSAGE_CHARS = 4000;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_API_ATTEMPTS = 4;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeMessageText(text) {
  return String(text || "").trim().slice(0, MAX_MESSAGE_CHARS);
}

const LEVEL_HINTS = {
  Native: "",
  A1:
    "Write at CEFR level A1: only the most common everyday words, very short " +
    "sentences, simple present tense. Avoid idioms and subordinate clauses.",
  A2:
    "Write at CEFR level A2: simple everyday vocabulary, short sentences, basic " +
    "past and future. Avoid idioms and complex grammar.",
  B1:
    "Write at CEFR level B1: common everyday vocabulary and straightforward " +
    "sentences. Occasional simple connectors are fine; avoid rare words and idioms.",
  B2:
    "Write at CEFR level B2: a broader vocabulary, longer sentences and common " +
    "idioms are fine, but stay clear and unambiguous.",
  C1:
    "Write at CEFR level C1: rich, precise, idiomatic language with natural " +
    "sentence variety.",
  C2:
    "Write at CEFR level C2: fully proficient, nuanced and idiomatic, the way an " +
    "educated native speaker writes."
};

const TONE_HINTS = {
  "Match my message": "Match the formality of the original message.",
  Informal:
    "Use a casual, friendly tone. In languages that mark formality, use the " +
    "informal address (du, tu, jij, tú).",
  Formal:
    "Use a polite, formal tone. In languages that mark formality, use the formal " +
    "address (Sie, vous, u, usted)."
};

/** Level and tone lines, dropped entirely when they'd say nothing. */
function styleRules(level, tone) {
  const rules = [LEVEL_HINTS[level] ?? "", TONE_HINTS[tone] ?? ""].filter(Boolean);
  return rules.length ? `\nStyle:\n${rules.map((rule) => `- ${rule}`).join("\n")}\n` : "";
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

chrome.runtime.onInstalled.addListener(async () => {
  // Seed storage so the popup shows real values on first open.
  const current = await chrome.storage.sync.get(null);
  const seeded = { ...DEFAULT_SETTINGS, ...current };

  if (current.enabled !== undefined && !current.enabledSites) {
    seeded.enabledSites = {
      ...DEFAULT_SETTINGS.enabledSites,
      "web.whatsapp.com": current.enabled
    };
  }

  await chrome.storage.sync.set(seeded);
});

function buildPrompt(text, language, { level, tone, correctedOnly }) {
  const preserve =
    "Do not add greetings, explanations or extra sentences. Leave names, " +
    "@mentions, numbers, emojis, URLs and code exactly as they are.";
  const style = styleRules(level, tone);

  const task = correctedOnly
    ? '"corrected": rewrite the message in correct, natural English, keeping the ' +
      "original meaning.\n" +
      preserve +
      "\n" +
      style +
      'Reply with JSON only, in the form {"corrected": "..."}. No markdown.'
    : "Do two things:\n" +
      '1. "corrected": rewrite the message in correct, natural English, keeping the ' +
      "original meaning.\n" +
      '2. "translation": translate the corrected English into ' +
      language +
      ", using the wording a native speaker would actually send in a chat.\n" +
      preserve +
      "\n" +
      style +
      'Reply with JSON only, in the form {"corrected": "...", "translation": "..."}. ' +
      "No markdown, no commentary.";

  return [
    {
      role: "system",
      content:
        "You are a chat writing assistant. You receive a short chat message " +
        "written in rough or misspelled English.\n" +
        task
    },
    {
      role: "user",
      content: `Target language: ${language}\nMessage: ${text}`
    }
  ];
}

function buildIncomingPrompt(text, language) {
  return [
    {
      role: "system",
      content:
        "You translate incoming chat messages for the reader.\n" +
        '1. "detected": name the language the message is written in, in English ' +
        '(e.g. "German"). If it is already in ' +
        language +
        ", say so.\n" +
        '2. "translation": translate the message into ' +
        language +
        ", naturally, keeping the tone. If it is already in " +
        language +
        ", repeat it unchanged. Leave names, numbers, emojis and URLs as they are. " +
        "Do not explain or comment.\n" +
        'Reply with JSON only, in the form {"detected": "...", "translation": "..."}. ' +
        "No markdown."
    },
    {
      role: "user",
      content: `Translate into ${language}:\n${text}`
    }
  ];
}

function parseContent(raw) {
  // The model is asked for pure JSON, but strip fences defensively.
  const cleaned = String(raw || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") return parsed;
  } catch (err) {
    // fall through
  }
  return null;
}

const field = (parsed, key) => String(parsed?.[key] ?? "").trim();

function mistralError(status, detail) {
  if (status === 401) {
    return "Mistral rejected the API key (401). Check the key in the extension popup.";
  }
  if (status === 429) {
    return "Mistral is rate-limiting requests (429). Wait a few seconds and try again.";
  }
  if (status === 503 || status === 502 || status === 504) {
    return (
      "Mistral is temporarily unavailable. This is on their side, not Instagram — " +
      "wait a few seconds and try again."
    );
  }
  return `Mistral error ${status}. ${detail}`;
}

async function callMistral({ messages, apiKey, model }) {
  if (!apiKey) {
    return { ok: false, error: "No Mistral API key set. Open the extension popup and add one." };
  }

  const body = JSON.stringify({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages
  });

  for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetch(MISTRAL_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body
      });
    } catch (err) {
      if (attempt < MAX_API_ATTEMPTS) {
        await wait(500 * attempt);
        continue;
      }
      return { ok: false, error: `Network error: ${err.message}` };
    }

    if (response.ok) {
      let data;
      try {
        data = await response.json();
      } catch (err) {
        return { ok: false, error: "Could not read the Mistral response." };
      }

      const parsed = parseContent(data?.choices?.[0]?.message?.content);
      if (!parsed) return { ok: false, error: "Unexpected response from Mistral." };

      return { ok: true, parsed };
    }

    let detail = "";
    try {
      detail = (await response.text()).slice(0, 300);
    } catch (err) {
      /* ignore */
    }

    if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_API_ATTEMPTS) {
      await wait(500 * 2 ** (attempt - 1));
      continue;
    }

    return { ok: false, error: mistralError(response.status, detail) };
  }

  return { ok: false, error: "Mistral is temporarily unavailable. Try again in a moment." };
}

/** Outgoing: fix the English, then translate it. */
async function translateOutgoing({ text, language, apiKey, model, level, tone, outputMode }) {
  // "Corrected English only" needs no translation, so don't pay for one.
  const correctedOnly = outputMode === "corrected";

  const result = await callMistral({
    messages: buildPrompt(text, language, { level, tone, correctedOnly }),
    apiKey,
    model
  });
  if (!result.ok) return result;

  const corrected = field(result.parsed, "corrected");
  const translation = correctedOnly ? "" : field(result.parsed, "translation");
  if (!corrected && !translation) {
    return { ok: false, error: "Unexpected response from Mistral." };
  }

  return { ok: true, corrected: corrected || text, translation };
}

/** Incoming: identify the language and translate it for the reader. */
async function translateIncoming({ text, language, apiKey, model }) {
  const result = await callMistral({
    messages: buildIncomingPrompt(text, language),
    apiKey,
    model
  });
  if (!result.ok) return result;

  const translation = field(result.parsed, "translation");
  if (!translation) return { ok: false, error: "Unexpected response from Mistral." };

  return { ok: true, detected: field(result.parsed, "detected"), translation };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_SETTINGS") {
    getSettings().then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }

  if (message?.type === "TRANSLATE" || message?.type === "TRANSLATE_INCOMING") {
    const incoming = message.type === "TRANSLATE_INCOMING";
    getSettings()
      .then((settings) => {
        const args = {
          text: normalizeMessageText(message.text),
          language:
            message.language || (incoming ? settings.readingLanguage : settings.language),
          apiKey: settings.apiKey,
          model: incoming ? settings.readingModel || settings.model : settings.model,
          // Level and tone shape what you send; a received message is
          // translated faithfully instead.
          level: settings.level,
          tone: settings.tone,
          outputMode: settings.outputMode
        };
        return incoming ? translateIncoming(args) : translateOutgoing(args);
      })
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err?.message || "Unknown error" }));
    return true;
  }

  return false;
});
