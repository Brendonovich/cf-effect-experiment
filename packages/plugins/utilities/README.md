# Utilities

Seven schemas: Print, Concat Strings, Int To String, Branch, Format String,
Format Time, and Tick.

Print uses the configured Effect logger. Its Type property accepts `log` (the
default, logged at Info), `warn`, or `error`. Invalid severity values fail rather
than silently falling back. Existing Print graphs retain their message shape and
default severity; no duplicate Console Log schema is added.

Format String supports `{name}` placeholders, deduplicates repeated input pins,
and escapes braces with `{{` and `}}`. Invalid placeholders remain literal text.

## Format Time

The pure Format Time node accepts safe-integer milliseconds on `timeIn` and emits
a string on `timeOut`. The Format property (`string`) uses Day.js formatting
tokens; text in square brackets is literal.

- With Duration disabled (the default), milliseconds are an epoch timestamp.
  Formatting uses **UTC and English**, not the Electron host's local timezone or
  locale, so results are host-independent. An empty format uses Day.js's ISO-like
  default. Invalid timestamps outside the JavaScript date range fail.
- With Duration enabled, milliseconds are elapsed time and Day.js duration
  tokens apply. `HH:mm:ss.SSS` formats 3723456 as `01:02:03.456`;
  `DD [days] HH:mm:ss` formats 90061000 as `01 days 01:01:01`.
  Fields are duration components, not total hours, and negative durations retain
  Day.js component semantics. An empty format uses the duration plugin's default.
- Fractional, nonfinite, and unsafe-integer milliseconds fail in either mode.

Date/time and random sampling nodes live in Math, String, and List. Format Time
does not read the clock. The Day.js duration and UTC plugins are bundled dependencies.

Tick is an engine event at a configurable positive whole-second interval.
Utilities also retains its existing project-scoped engine settings and deployment.

Run tests with `pnpm --filter @macrograph/plugin-utilities run test --run`.
