# WhatsApp Translate Composer

A Chrome extension that adds its own message box to WhatsApp Web. You type rough
English, press **Enter**, and instead of sending straight away it asks Mistral AI
to (1) fix the English and (2) translate it into your chosen language — then sends
the combined message.

**Input**

```
My nme is Hammad
```

**What actually gets sent**

```
My name is Hammad

Translation (German):

Ich heiße Hammad
```

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder (`whatsapp-translator`)
4. Open <https://web.whatsapp.com> and reload the tab

The **TR** bar appears in place of WhatsApp's own message box.

## Use

- Type in the **TR** bar → **Enter** sends the corrected + translated message
- **Shift+Enter** = new line, **Esc** = clear
- Change the target language from the dropdown in the bar (it saves itself)
- **×** hides the bar and uncovers WhatsApp's own box; the small green **TR**
  pill above the footer brings it back

### Translating messages you receive

Hover any message someone sent you — a small green **文A** button appears at its
top-right corner. Click it and the translation opens in a panel under the bubble
(**×** or **Esc** closes it). The panel header shows the detected language, e.g.
`GERMAN → ENGLISH`. Set the target under "Messages you receive →" in the popup.

The button isn't injected into the bubbles themselves. WhatsApp virtualises the
message list — it recycles those DOM nodes as you scroll — so injected children
get orphaned or duplicated, and it's the same React subtree that breaks if you
splice into it. A single shared button follows whatever message you point at.

Bubble detection is `findBubble()` in [src/content.js](src/content.js), and it
doesn't rely on one selector, because WhatsApp keeps renaming its classes. It
matches `.message-in`, then falls back to `div[data-id]` / `div[role="row"]`,
and works out the direction from `data-id` — which is
`"<fromMe>_<chat>_<msg>"`, so a received message starts with `false_`.

If the button ever stops appearing, open the console on WhatsApp Web: the
extension logs `[wa-translate] bubble selectors found: {…}` a few seconds after
load, showing which selectors still match anything.

## Settings

Click the extension icon in the toolbar:

| Setting | Notes |
| --- | --- |
**Messages you send**

| Setting | Notes |
| --- | --- |
| Translate into | 18 languages, German by default |
| Model | Six Mistral models, Small by default |
| Language level | `Native` (no limit) or CEFR `A1`–`C2` |
| Tone | Match my message / Informal (du, tu) / Formal (Sie, vous) |
| What gets sent | Corrected English + translation, translation only, or corrected English only |

**Messages you receive (文A button)**

| Setting | Notes |
| --- | --- |
| Translate into | English by default |
| Model | Chosen independently of the sending model |

Plus **Show the composer bar** (hides the bar without uninstalling) and the
**Mistral API key**.

Model options: `mistral-small-latest` (fast, cheap), `mistral-medium-latest`,
`mistral-large-latest` (best), `ministral-8b-latest`, `ministral-3b-latest`,
`open-mistral-nemo`. The two tasks are very different in difficulty — reading a
foreign message is easy, rewriting *and* translating is harder — so they get
separate model settings.

**Level and tone apply to what you send, not to what you receive.** They shape
how *you* come across, whereas a message someone sent you should be translated
faithfully rather than rewritten to a level. Both feed the prompt through
`styleRules()` in [src/background.js](src/background.js), and both drop out of
the prompt entirely at `Native` / `Match my message`.

Picking **Corrected English only** skips the translation in the prompt rather
than discarding it afterwards, so it's cheaper and faster than the other modes.

Reload the WhatsApp Web tab after changing the key or model.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest — content script on `web.whatsapp.com`, host access to `api.mistral.ai` |
| `src/content.js` | Builds the composer bar, injects the result into WhatsApp and sends it |
| `src/content.css` | Bar styling, follows WhatsApp's light/dark theme |
| `src/background.js` | Service worker: settings defaults + the Mistral API call |
| `src/popup.html/.css/.js` | Settings UI |
| `src/config.js` | Shared defaults and language list |

## Why the bar is an overlay

WhatsApp Web is a React app that re-renders the chat column constantly. A foreign
node inserted *inside* that subtree breaks React's reconciliation and can freeze
or blank the real message box. So the bar is appended to `document.body` as a
`position: fixed` overlay and pinned to the footer's bounding rect — it never
touches WhatsApp's own DOM. The same reasoning applies to the MutationObserver,
which is debounced by 250 ms so typing in WhatsApp doesn't trigger layout work on
every keystroke.

It's laid *over* the footer rather than above it, so it takes no height from the
message list — sitting above it pushed the newest messages out of view. It's
anchored by its bottom edge, so a multi-line draft grows upward.

## How it sends

WhatsApp Web's message box is a rich-text editor, so text can't just be assigned
to it. The extension focuses the box, clears it, dispatches a synthetic paste
event with the final text, then clicks the send button (falling back to a
synthetic Enter key if the button isn't found). If WhatsApp changes its DOM, the
selectors to check are `findComposer()` and `findSendButton()` in
[src/content.js](src/content.js).

The API call runs in the service worker rather than the content script so it
isn't blocked by WhatsApp's page CSP.

## Note on the API key

The key is stored in `chrome.storage.sync` and is also hardcoded as the default
in `src/config.js` and `src/background.js`. Anyone who can read this folder or
open the extension's storage can read the key — that's unavoidable for a
client-side extension. If it ever leaks, rotate it in the Mistral console and
paste the new one into the popup.
