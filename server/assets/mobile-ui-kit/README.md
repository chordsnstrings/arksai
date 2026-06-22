# ArksAI Mobile UI Kit (React Native / Expo)

The mobile counterpart of the web `ui-kit/`. **Every generated Android app composes its
screens from this kit** — minimal, modern, typography‑first — never the default RN look.
Installed into an app's `src/ui/` by the `add_mobile_ui_kit` tool (Phase 1).

## What's here
- `tokens.ts` — colors (light + dark + `brandTheme(accent)`), 8pt `space`, modular `type`
  scale, `radius`, `shadow`, `motion`. One source of truth.
- `components.tsx` — `ThemeProvider`/`useTheme`, `Screen` (safe-area scaffold), `AppText`,
  `Button` (primary/ghost, pressed/disabled/loading), `Card`, `Field`, `EmptyState`, `Loading`.
- `ErrorBoundary.tsx` — `AppErrorBoundary`, mounted at the app root (crash safety).

## Rules for generated apps (the quality bar)
1. Wrap the root in `<AppErrorBoundary>` then `<ThemeProvider theme={brandTheme(accent)}>`.
2. Build every screen from `Screen` + the components; **never** raw `<View>/<Text>` styled ad‑hoc.
3. Use the **accent sparingly** (primary actions/emphasis ~5–10%); neutrals everywhere else.
4. Every list/data view ships **loading + empty + error** states (`Loading`, `EmptyState`).
5. Respect the **safe area** (the kit's `Screen` does) and the **8pt grid** (`space`).
6. Legibility is non‑negotiable — body/secondary text must read clearly (tokens enforce this).
7. Tasteful motion only (`motion` durations); no gratuitous animation.

## Dependencies an app needs
`react-native-safe-area-context` (Expo includes it). Navigation via `expo-router` or
`@react-navigation/native`. Device features via Expo modules (camera, location, etc.) —
added per the app's capabilities.

## Backend pairing
The auto‑generated Fastify backend is held to the matching bar: typed routes, input
validation, a consistent error envelope, auth middleware, migrations — clean and minimal,
so the whole product (client + API) feels of one piece.
