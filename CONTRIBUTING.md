# Contributing

Thanks for taking a look. Cyphed is a small project maintained by one person, so issues and focused pull requests are the best way to help.

## Set up

```powershell
npm install
npm run dev          # the app, with hot reload
npm run ui:preview   # the interface only, in a browser, with sample data
```

You need Windows 10 or 11 and Node.js 22.5 or later. For real dictations, add a Deepgram and an Anthropic key in Settings (or `DEEPGRAM_API_KEY` / `ANTHROPIC_API_KEY`).

## Before opening a pull request

- `npm run check` passes (type check, build, tests).
- New logic comes with a test in `tests/`. Pure logic lives in `*-core.ts` files that import neither Electron nor the `@shared` alias, so `node --test` can load them.
- A new IPC channel is declared in `src/shared/ipc.ts`, exposed only in the preload of the window that needs it, and its handler in the main process checks the caller.
- Any text shown to the user goes through the translations in `src/shared/i18n/` (French and English).
- No secret in code, logs, tests or commits.
- UI changes: include a screenshot (`npm run ui:preview` makes this easy).

## Reporting a bug

Open an issue with what you did, what you expected, what happened, your Windows version and the speech engine you use. Never paste an API key or a dictation you would not want public.
