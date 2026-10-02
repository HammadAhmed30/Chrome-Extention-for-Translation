// Shared defaults. Loaded by the popup; mirrored in background.js (service
// workers in MV3 can't share plain script tags with the popup without modules).
const DEFAULT_SETTINGS = {
  enabledSites: {
    "web.whatsapp.com": true
  },
  apiKey: "tiFVHMbDB2ZmRt0rCz2QX1GJKp5VI2NG",
  model: "mistral-small-latest",
  language: "German",
  outputMode: "both", // "both" | "translation" | "corrected"
  level: "Native", // CEFR level the message should be written at
  tone: "Match my message", // formality of the output
  readingLanguage: "English", // what received messages get translated into
  readingModel: "mistral-small-latest", // model used for received messages
  theme: "sage" // appearance theme — see themes.js / themes.css
};

// CEFR levels, easiest first. "Native" applies no restriction.
const LEVELS = [
  { value: "Native", label: "Native — no limit" },
  { value: "A1", label: "A1 — beginner" },
  { value: "A2", label: "A2 — elementary" },
  { value: "B1", label: "B1 — intermediate" },
  { value: "B2", label: "B2 — upper intermediate" },
  { value: "C1", label: "C1 — advanced" },
  { value: "C2", label: "C2 — proficient" }
];

const TONES = [
  { value: "Match my message", label: "Match my message" },
  { value: "Informal", label: "Informal — du / tu / jij" },
  { value: "Formal", label: "Formal — Sie / vous / u" }
];

// label is shown in the popup; value is the Mistral model id.
const MODELS = [
  { value: "mistral-small-latest", label: "Mistral Small — fast, cheap (default)" },
  { value: "mistral-medium-latest", label: "Mistral Medium — balanced" },
  { value: "mistral-large-latest", label: "Mistral Large — best quality" },
  { value: "ministral-8b-latest", label: "Ministral 8B — very fast" },
  { value: "ministral-3b-latest", label: "Ministral 3B — fastest, weakest" },
  { value: "open-mistral-nemo", label: "Open Mistral Nemo — open weights" }
];

const LANGUAGES = [
  "English",
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
