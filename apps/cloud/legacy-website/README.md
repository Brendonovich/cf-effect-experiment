# Legacy Website

`public/` is a prebuilt copy of the original MacroGraph website (`apps/web` in
[Brendonovich/macrograph](https://github.com/Brendonovich/macrograph)): the landing page,
account pages, login and device approval pages, the original playground, and the
`/new-playground` editor. `WebsiteWorker` serves it as static assets at
`www.macrograph.app`.

The original app was a SolidStart server app on Vercel. `legacy-web.patch` turns it into a
static SPA: its server functions become `fetch` calls to `/api/website/*`, and its `/api/*`
and `/auth/*` routes are removed. `src/website/WebsiteRoutes.ts` reimplements all of those
routes in the Worker against the same account tables.

Do not edit `public/` by hand. To rebuild it, change `legacy-web.patch` if needed and run:

```sh
./build.sh
```

The script clones the original repository at the pinned commit, applies the patch, builds with
the original toolchain (pnpm 10 through Corepack), and replaces `public/`. Set
`MACROGRAPH_LEGACY_REPO` to a local clone to avoid fetching from GitHub. The build is
reproducible; an unchanged patch produces identical output.

To edit the patch, apply it to a checkout of the pinned commit, make changes, and regenerate it
with `git diff HEAD -- . ':!pnpm-lock.yaml' ':!packages/icons/auto-imports.d.ts'`.
