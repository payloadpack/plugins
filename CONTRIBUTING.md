# Contributing

This repository holds the open-source `@payloadpack` packages for Payload. Each one lives in its own folder, builds and tests on its own and releases on its own version, while they share one CI, one Payload version and the config at the root. The conventions for code, naming and docs live in `.claude/`, next to the design notes.

## Repository

| Path                | What                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `packages/theme`    | `@payloadpack/theme`, the admin theme                                                                               |
| `apps/theme-demo`   | A Payload 4 app that runs the theme, with its e2e, visual and screenshot tests                                      |
| `apps/docs`         | The docs site for every package at [docs.payloadpack.com](https://docs.payloadpack.com), built with Astro Starlight |
| `.claude`           | Conventions, naming and design notes                                                                                |
| `.github/workflows` | CI, releases, the docs deploy, screenshots and visual baselines                                                     |

Every package and app reads the same config from the root:

| File                  | What it sets                                                 |
| --------------------- | ------------------------------------------------------------ |
| `tsconfig.base.json`  | The TypeScript options every package and demo extends        |
| `prettier.config.mjs` | Formatting, run over the whole repository                    |
| `package.json`        | The Bun version, in `packageManager`, used locally and in CI |
| `.nvmrc`              | The Node version CI runs on                                  |

## Develop

```sh
bun install
cp apps/theme-demo/.env.example apps/theme-demo/.env
bun run dev
```

The theme demo runs on http://localhost:3020/admin and seeds itself on first start. Log in with `demo@payloadpack.com` / `demo`.

The demo imports the built theme, so rebuild it after a change:

```sh
bun run build --filter=@payloadpack/theme
```

The docs site runs on http://localhost:4321:

```sh
bun run --cwd apps/docs dev
```

## Commands

Run these from the root. Turbo runs each task in every package and app that has it, after building what it depends on.

| Command                | What it does                                              |
| ---------------------- | --------------------------------------------------------- |
| `bun run build`        | Builds every package and app                              |
| `bun run test`         | Runs every package's unit tests                           |
| `bun run test:e2e`     | Runs the demos' end-to-end tests                          |
| `bun run typecheck`    | Type-checks every package and app                         |
| `bun run format`       | Formats the repository with Prettier                      |
| `bun run format:check` | Checks the formatting without changing anything           |
| `bun run dev`          | Starts the theme demo                                     |
| `bun run generate`     | Regenerates the theme demo's import map and Payload types |

Add `--filter` to run a task for one package or app. A leading `...` adds everything that depends on it, and a trailing `^...` runs only what it depends on:

```sh
bun run test --filter=@payloadpack/theme
bun run build --filter='...@payloadpack/theme'
bun run build --filter='@apps/theme-demo^...'
```

## Test the theme

| Command                                     | What it checks                                                                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run test --filter=@payloadpack/theme`  | The plugin config, how an editor's setup resolves against it, the provider's server render, and that every Payload token, class, icon and hard-coded size the theme depends on still exists in Payload |
| `cd apps/theme-demo && bun run test:e2e`    | The rendered sizes, colors and icons in a real browser, on a fresh production build of the demo                                                                                                        |
| `cd apps/theme-demo && bun run test:visual` | Every admin view and overlay, pixel for pixel, against the approved screenshots in `apps/theme-demo/tests/__visual__`                                                                                  |

Run all three after bumping Payload. A failing contract test names the token, class or hard-coded value that changed.

The approved screenshots are Linux images rendered in CI's Playwright container. `bun run test:visual` runs that same container in Docker as `linux/amd64`, so it needs Docker running and compares against exactly what CI does. The first run fills a few `payloadpack-visual-*` Docker volumes with Linux dependencies; later runs reuse them. It shares the e2e database with `test:e2e`, so run the two one after the other. To accept an intended visual change in a pull request, add the `update-visuals` label: CI renders the screenshots again, commits them to the branch, and the pull request shows each changed image.

## Theme images

| Command                                        | What it makes                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `cd apps/theme-demo && bun run screenshots`    | The README and docs screenshots. The Screenshots workflow opens a pull request with them |
| `cd apps/theme-demo && bun run social-preview` | The social preview card. Upload it under the repository's Settings → Social preview      |
| `cd apps/theme-demo && bun run panel-tour`     | The README's panel tour GIFs. Needs [ffmpeg](https://ffmpeg.org)                         |
| `cd apps/docs && bun run brand`                | The logo and the docs favicon                                                            |

## CI

On a pull request, CI builds, tests and type-checks the packages and apps the change touches, plus everything that depends on them (`--filter=...[origin/main]`). On `main` it runs everything. A change to `tsconfig.base.json` or `turbo.json` counts as touching every package.

The theme demo's e2e and visual suites run only when a change can alter what the demo runs: a file in the demo or in a package it builds from, a `package.json` change beyond metadata such as `version` or `homepage`, a lockfile change to their dependencies, or `tsconfig.base.json`. Docs, Markdown, unit tests and licenses never count, and a screenshot-only change runs the visual suite alone. `scripts/demo-tests.sh` makes that call. The Screenshots and React Doctor workflows start only for changes under `packages/theme` or `apps/theme-demo`, and then make the same call. The `validate` job is the check a pull request needs to merge.

## Release

Each package has its own version, changelog and tags. Merge pull requests with a [Conventional Commits](https://www.conventionalcommits.org) title. A commit counts toward a package when it changes a file in that package's folder, and only a `feat`, `fix`, `perf` or `revert` commit, or a breaking change, releases it. A `docs`, `test`, `refactor`, `ci` or `chore` commit changes nothing the package's users get, so it gets no changelog line and ships with the next release.

Release Please keeps one release pull request open with the next version of every package that has changes. Merging it tags each released package as `<name>-v<version>`, such as `theme-v0.3.5`, publishes it to npm with provenance and deploys the docs site to GitHub Pages. To deploy the docs by hand, run the Docs workflow from the Actions tab.

The theme's tags up to `v0.3.4` come from before the repository held more than one package. `theme-v0.3.4` marks the same commit as `v0.3.4`, so Release Please continues from there.

The release, screenshots and visual baseline workflows need the repository secret `PAYLOADPACK_RELEASE_BOT_TOKEN`. The release workflow publishes to npm through trusted publishing, so no npm token is stored.

## Docs

`apps/docs` is one docs site for every package, deployed to this repository's GitHub Pages on docs.payloadpack.com. Each package has its own path, such as `/theme/`, with its own sidebar, and the switcher in the top left moves between packages. A package's pages live in `apps/docs/src/content/docs/<name>/` and its sidebar is its topic in `apps/docs/astro.config.mjs`.

The theme's docs used to live on theme.payloadpack.com. A redirect rule in Cloudflare sends every path there to the same path under docs.payloadpack.com/theme.

## Adding a package

1. **Folder.** Create `packages/<name>` with `src`, `test`, a `README.md` and a `LICENSE`, and a `tsconfig.json` that extends `../../tsconfig.base.json`. If it needs a Payload app to run in, add `apps/<name>-demo` with `"@payloadpack/<name>": "workspace:*"` as a dependency. Give it a section in the root `README.md`, like the theme's.
2. **`package.json`.** Give it these fields, with the same Payload version the other packages use:

   ```json
   {
     "name": "@payloadpack/<name>",
     "version": "0.1.0",
     "homepage": "https://docs.payloadpack.com/<name>/",
     "bugs": { "url": "https://github.com/payloadpack/plugins/issues" },
     "repository": {
       "type": "git",
       "url": "git+https://github.com/payloadpack/plugins.git",
       "directory": "packages/<name>"
     },
     "scripts": {
       "build": "…",
       "test": "…",
       "typecheck": "…",
       "prepublishOnly": "bun run build"
     },
     "peerDependencies": { "payload": "<the range the other packages use>" },
     "devDependencies": { "payload": "<the version the other packages use>" },
     "publishConfig": { "access": "public", "provenance": true }
   }
   ```

   npm checks `repository.url` against the repository that publishes, so keep it exactly as above.

3. **Docs.** Put its pages in `apps/docs/src/content/docs/<name>/`, with an `index` page. Add a topic for it to the `starlightSidebarTopics` list in `apps/docs/astro.config.mjs`, with `label: '<name>'`, `link: '/<name>/'` and its sidebar under `items`, and a card for it on the landing page, `apps/docs/src/content/docs/index.mdx`.
4. **Release Please.** Add the package to both files, with the version from its `package.json`:

   ```jsonc
   // release-please-config.json, under "packages"
   "packages/<name>": { "package-name": "@payloadpack/<name>", "changelog-path": "CHANGELOG.md" }

   // .release-please-manifest.json
   "packages/<name>": "0.1.0"
   ```

   Then tag the commit that brings the package in as `<name>-v<version>`, such as `path-v0.1.0`. Release Please counts the next release from that tag.

5. **npm.** npm can't publish a package's first version through trusted publishing, so publish that version by hand from the tagged commit. Then add a trusted publisher on the package's Settings page on npmjs.com: GitHub Actions, organization `payloadpack`, repository `plugins`, workflow `release.yml`. A new trusted publisher expires unless a release uses it within 2 days.

A package never reaches into another package's internals. It imports another package by name, through the exports that package publishes, and never through a path into its folder.
