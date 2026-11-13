# Security

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting (Security tab, "Report a vulnerability"). You will get an answer within a week.

## How Cyphed protects your data

- **Keys** are read from `%APPDATA%\cyphed\secrets.json` (saved from Settings) or from environment variables. They stay in the main process; windows only learn whether a key is configured. No key is bundled in the app.
- **Windows** run with `contextIsolation`, `sandbox` and no Node integration. Each window has its own preload exposing only its calls, and every IPC handler checks the sender and its URL. Navigation, new windows and `<webview>` are blocked. Only the dictation badge may open the microphone.
- **Password fields** are never read: the UI Automation helper returns no text for them, nor for fields whose name suggests a card number, IBAN or code. Nothing from them reaches a model or the history.
- **Clipboard**: dictated text is excluded from the Windows clipboard history and cloud sync, and the previous clipboard text is restored after pasting.
- **Prompt injection**: the dictated text is passed to the model as data, and a local guard rejects outputs that answer, translate or change numbers and links.

## What leaves your machine

| Data | Destination |
|---|---|
| Dictation audio | The speech-to-text engine you chose: Deepgram (default), ElevenLabs or Mistral Voxtral |
| Dictated text, app category (not its name or window title), dictionary, writing profile, text around the cursor (up to 1,200 characters before and 400 after, can be turned off) | Anthropic (Claude Haiku), or the OpenAI-compatible provider chosen in Settings (HTTPS only; plain HTTP is allowed only for a model on this PC) |
| Dictated text only | Cerebras, as a fallback when the cleanup model is unavailable |
| Rare words read on screen (names, identifiers), filtered to never include tokens | The speech-to-text engine, as keywords |
| Selected text you transform or read | Anthropic, Mistral or ElevenLabs, only when you ask |
| Screen area for "Read" | Mistral (OCR or vision), never written to disk |
| Audio of dictations | Kept locally 7 days for "Retry", or never (Settings) |
| A version check, no personal data | GitHub, at startup and every 6 hours, to fetch updates from this repository's releases. Updates are not code-signed: they are trusted through HTTPS and the SHA-512 hash published with each release |

There is no telemetry. Local data (history database, settings, notes, keys) is not encrypted at rest.
