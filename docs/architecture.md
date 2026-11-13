# Architecture

One Electron main process, three windows (dictation badge, hub, screen capture), one IPC contract, one sandboxed preload per window, and a small native Windows helper that reads the focused text field.

```
Hub / Badge / Capture (renderer) ──own preload──► main ──stdin/stdout──► uia-helper.exe
                                        ▲
                                 src/shared/ipc.ts
                                 src/shared/types.ts
```

If a call is not declared in `src/shared/` and exposed by the preload of that window, the window cannot make it.

## Processes

| Process | Role |
|---|---|
| main | Lifecycle, shortcuts (keyboard and mouse), speech to text, cleanup, command mode, Win32 paste, SQLite, tray, windows, OCR, vision, text to speech |
| `uia-helper.exe` | Reads the focused text field with UI Automation: text before and after the cursor, selection, editable, password. No network, no disk writes |
| `pocket-serve.py` | Offline voice for "Read" (Pocket TTS by Kyutai), only when running from source (`npm run build:voice` or `CYPHED_VOICE_DIR`), not in the installer; started on first use, stopped after 10 idle minutes |
| renderer `bar` | Microphone (raw PCM), the dictation badge and its menus |
| renderer `hub` | Dictations, Stats, Dictionary, Expansions, Style, Rewrites, Notes, Read aloud, Settings |
| renderer `capture` | Screen area picker, created on demand |

## Folders

```
src/main/
  index.ts            startup only
  hotkeys.ts          dictation, rewrites, re-paste, undo, command mode, mouse buttons
  tray.ts, windows.ts, ipc-gate.ts, secrets.ts
  ipc/                one file per group of channels
  providers/          Deepgram, ElevenLabs, Voxtral, Anthropic, Cerebras, OCR, vision, TTS, prompts
  services/           dictation state machine, UI Automation client, context, output guard,
                      personalization, insights, notes, paste/copy/undo (Win32), mouse hook
  db/                 SQLite history
src/preload/          bar.ts, hub.ts, capture.ts
src/renderer/         hub/ (shell, views, CSS), bar/, capture/
src/shared/           types, IPC channels, translations, pure helpers
native/               uia-helper (C#), pocket voice server
scripts/              check, native and voice builds, UI preview
tests/                node --test, pure logic and the dictation state machine
```

Pure logic lives in `*-core.ts` files that import neither Electron nor the `@shared` alias, so the Node test runner can load them directly.

## Dictation flow

1. Shortcut pressed (keyboard or mouse button). In hold mode a controller follows the key.
2. The main process notes the foreground window. A blocked app shows a message and stops there.
3. While the microphone starts, the UI Automation helper reads the field (text before, after, selection). It never blocks: at most 300 ms of waiting at the end.
4. The badge streams raw PCM (no browser noise suppression, which hurts recognition), buffered until the speech engine is ready.
5. On stop, the audio goes to Deepgram (whole file by default), or ElevenLabs Scribe or Mistral Voxtral.
6. If text is selected, a tiny classifier call decides whether the dictation is an instruction for the selection or text to insert.
7. Cleanup: one Claude Haiku pass with the app's tone, the dictionary, the detected language, the text around the cursor, the last sentences written in that window, and the writing profile. Without an Anthropic key: Cerebras, otherwise the raw transcript.
8. Output guard (local): rejects a translation, an answer instead of a cleanup, a changed number or link, an empty or oversized output. Rejected means raw transcript, with the reason saved.
9. Dictionary and expansions, then spacing joined with the existing text.
10. Paste with Ctrl+V. If focus does not come back, the text stays in the clipboard and the badge says so.
11. The field is read again to confirm the text arrived. For 45 s, manual corrections in the field become dictionary suggestions.
12. The dictation is saved to SQLite with a trace of each step.

## Windows

| Window | Behavior |
|---|---|
| Badge | 340×230 transparent, bottom of the screen, never takes focus, always on top, ignores the mouse except on the badge |
| Hub | 1240×840, closing hides it to the tray |
| Capture | One overlay per screen, on demand |

## Local data

Under `%APPDATA%\cyphed`: `cyphed.db` (history), `settings.json`, `personalization.json` (dictionary, expansions, tones, rewrites, blocked apps), `scratchpad.json` (notes), `secrets.json` (keys, main process only), `audio/` (dictation audio kept 7 days for retry), `metrics.jsonl` (latencies, no user text).
