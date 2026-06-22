# ArksAI Expo App (React Native + expo-router)

A complete, runnable Expo app scaffold — already wired for **crash safety** and the
**ArksAI mobile design system**. Unpacked by the `create_expo_app` tool, which also drops
the mobile UI kit into `src/ui/`.

## Structure
- `app/_layout.tsx` — root layout: `AppErrorBoundary` → `SafeAreaProvider` → `ThemeProvider` →
  expo-router `Stack`. Set the brand accent here (`brandTheme('#…')`).
- `app/index.tsx` — sample home screen, composed from the kit. Replace with the real first screen.
- `src/ui/` — the mobile UI kit (tokens, components, ErrorBoundary). Build every screen from it.
- `app.json` — Expo config: `scheme`, Android `package` (`studio.arksai.app` — change per app),
  `newArchEnabled`. `web.output: "single"` so the Canvas web preview is a single page.

## Develop
```
npm install
npm run web        # in-Canvas web preview
npm start          # Expo Go on a phone (QR)
```

## Add screens (expo-router, file-based)
A file in `app/` is a route: `app/profile.tsx` → `/profile`. Use `<Link href="/profile">` or
`router.push('/profile')`. Group tabs with a `(tabs)/_layout.tsx`. Always compose from the kit
(`Screen`, `AppText`, `Button`, `Card`, `Field`, `EmptyState`, `Loading`) — never raw default RN.

## Backend
If the app needs accounts/data, install the backend kit (`add_app_backend`), publish it for a
live `<slug>.apps.arksai.studio` URL, and call it from a typed API client with the JWT from login.

## Android APK
Built on ArksAI infra: `expo prebuild --platform android` + Gradle `assembleRelease` on an
ephemeral build droplet (never EAS). The PWA/web build is the instant default; the native APK
is produced on request. iOS/Apple uses EAS separately (same codebase).

## Quality bar
Accent used sparingly (~5–10%); respect the safe area + 8pt grid; every data view ships
loading + empty + error states; tasteful motion only; legible body/secondary text.
