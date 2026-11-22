# Contributing

This repository holds the open-source `@payloadpack` packages for Payload. Each one lives in its own folder, builds and tests on its own and releases on its own version, while they share one CI, one Payload version and the config at the root. The conventions for code, naming and docs live in `.claude/`, next to the design notes.

## Repository

| Path                   | What                                                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/theme`       | `@payloadpack/theme`, the admin theme                                                                                                                            |
| `apps/theme-demo`      | A Payload 4 app that runs the theme, with its e2e, visual and screenshot tests                                                                                   |
| `packages/path`        | `@payloadpack/path`, stored URL paths for pages and posts, with its tests and benchmark                                                                          |
| `apps/path-demo`       | A Payload 4 app that runs path, with its e2e tests                                                                                                               |
| `packages/redirects`   | `@payloadpack/redirects`, redirects editors manage, with its tests                                                                                               |
| `apps/redirects-demo`  | A Payload 4 app that runs redirects beside path, with its e2e tests                                                                                              |
| `apps/redirects-bench` | A Next.js and Payload 4 app that measures what checking for a redirect in a proxy adds to a page view, and compares a lookup with Payload's own redirects plugin |
| `apps/docs`            | The docs site for every package at [docs.payloadpack.com](https://docs.payloadpack.com), built with Astro Starlight                                              |
| `.claude`              | Conventions, naming and design notes                                                                                                                             |
| `.github/workflows`    | CI, releases, the docs deploy, screenshots and visual baselines                                                                                                  |

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
bun run dev:theme
```

Each dev command builds the packages its app imports, then starts the app:

| Command                      | What it starts                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `bun run dev:theme`          | The theme demo on http://localhost:3020/admin. It seeds itself on first start                                                    |
| `bun run dev:path`           | The path demo on http://localhost:3030/admin, on a fresh MongoDB replica set in memory that it seeds on each start, so no `.env` |
| `bun run dev:path:localized` | The path demo with English and Swedish                                                                                           |
| `bun run dev:redirects`      | The redirects demo on http://localhost:3040/admin, on a fresh MongoDB replica set in memory that it seeds on each start          |
| `bun run dev:docs`           | The docs site on http://localhost:4321                                                                                           |

Log in to any demo with `demo@payloadpack.com` / `demo`.

A demo imports its package's built `dist`, so rebuild the package after a change while the demo runs:

```sh
bun run build --filter=@payloadpack/theme
bun run build --filter=@payloadpack/path
bun run build --filter=@payloadpack/redirects
```

## Commands

Run these from the root. Turbo runs each task in every package and app that has it, after building what it depends on.

| Command                | What it does                                         |
| ---------------------- | ---------------------------------------------------- |
| `bun run build`        | Builds every package and app                         |
| `bun run test`         | Runs every package's tests                           |
| `bun run test:e2e`     | Runs the demos' end-to-end tests                     |
| `bun run typecheck`    | Type-checks every package and app                    |
| `bun run format`       | Formats the repository with Prettier                 |
| `bun run format:check` | Checks the formatting without changing anything      |
| `bun run generate`     | Regenerates the demos' import maps and Payload types |

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

## Test path

| Command                                   | What it checks                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run test --filter=@payloadpack/path` | Every feature on MongoDB, Postgres and SQLite, without and with localization, and the queries each save costs                                                       |
| `cd apps/path-demo && bun run test:e2e`   | Paths, moves and refusals in the admin, without localization and with English and Swedish plus a Swedish path of its own, on one fresh production build of the demo |

The package tests start their own databases: a MongoDB replica set, an embedded Postgres and SQLite files. The first run downloads the MongoDB binary; the Postgres binary comes with `bun install`. To run the tests on one database, or a few, set `PATH_TEST_DATABASES` to a comma list of `mongodb`, `postgres` and `sqlite`, such as `PATH_TEST_DATABASES=sqlite bun run test`; only those servers start. The e2e suite serves the demo on ports 3032 and 3033, so it runs beside a dev server on 3030.

`bun run generate` writes the path demo's Payload types with localization on, because `src/seed.ts` writes the Swedish version with `locale: 'sv'` and without localization Payload types `locale` as `null`, so the type-check fails. CI fails when the committed types or import map differ from what `generate` writes.

## Benchmark path

```sh
cd packages/path && bun run bench
```

It seeds 100,000 pages and posts on each database, without and with localization, with the posts in their own tree below `/blog`, then times a lookup, an autosave, a publish, a rename and a move of a page holding 1,000 pages, and compares path with nested docs and a slug-by-slug lookup. It takes about an hour, mostly seeding, and writes its numbers to `apps/docs/src/data/path-speed.json`, which the speed page reads, and to the table in path's README.

Only that full run writes. Any other run prints its tables and says why it wrote nothing: `BENCH_DOCUMENTS=4000` gives a quick run to check the script itself, `BENCH_COMPARISON=off` leaves the comparison out when you only want to know whether path got slower, and `PATH_TEST_DATABASES` picks the databases, as it does for the tests.

## Test redirects

| Command                                        | What it checks                                                                                                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run test --filter=@payloadpack/redirects` | The collection, the lookup, chains, the redirects a move suggests and their notices, on MongoDB, Postgres and SQLite, the queries each costs, and that a lookup reads only indexes             |
| `cd apps/redirects-demo && bun run test:e2e`   | The answers a visitor gets beside path, 308, 307 and 404, from the page route and the proxy, and the notice a moved page shows, with its yes and no, on one fresh production build of the demo |

The package tests start their own databases, as path's do, and run SQLite both with and without transactions. To run them on one database, or a few, set `REDIRECTS_TEST_DATABASES` to a comma list of `mongodb`, `postgres` and `sqlite`, such as `REDIRECTS_TEST_DATABASES=sqlite bun run test`; only those servers start. The e2e suite serves the demo on port 3042, so it runs beside a dev server on 3040.

## Benchmark redirects

```sh
cd apps/redirects-bench && bun run bench
```

It builds the app three times, with each proxy the installation docs give, for query strings and for redirects that win over pages, and without one, and starts MongoDB, Postgres and SQLite itself, with MongoDB and Postgres also behind a relay that adds 5 ms to each round trip. At 1,000, 10,000 and 100,000 redirects and as many regexes, and with 20 regexes without a fixed start as well, it sends 2,000 page views with a query string to the build with the proxy for query strings and to the one without, in turn, after 500 untimed ones. At 100,000 it also sends as many without a query string, to that build and, with the database at both distances, to the build for redirects that win over pages. It prints what each proxy adds and the round trips one check makes, takes about 10 minutes, and writes its numbers to `apps/docs/src/data/redirects-speed.json`, which the speed page reads, and to the tables in redirects' README.

Only that full run writes. `BENCH_DATABASES=sqlite` and `BENCH_COUNTS=1000` narrow a run to check the bench itself, which prints its tables and writes nothing.

```sh
cd apps/redirects-bench && bun run bench:compare
```

It times finding one redirect with `findRedirect` against the way Payload's example website finds one with Payload's own `@payloadcms/plugin-redirects`, on MongoDB, Postgres and SQLite at 1,000, 10,000 and 100,000 redirects: every redirect read and compared to the path, with the list read from the database and from a cache, which Next.js's own data cache holds only while its entry is under its 2 MB limit, each database on the same machine. It takes about 40 minutes and writes its numbers to `apps/docs/src/data/redirects-comparison.json`, which the introduction and the speed page read, and to the comparison table in redirects' README. The same narrowing applies, and a narrowed run writes nothing.

## Theme images

| Command                                        | What it makes                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `cd apps/theme-demo && bun run screenshots`    | The README and docs screenshots. The Screenshots workflow opens a pull request with them |
| `cd apps/theme-demo && bun run social-preview` | The social preview card. Upload it under the repository's Settings → Social preview      |
| `cd apps/theme-demo && bun run panel-tour`     | The README's panel tour GIFs. Needs [ffmpeg](https://ffmpeg.org)                         |
| `cd apps/docs && bun run brand`                | The logo and the docs favicon                                                            |

## CI

On a pull request, CI builds, tests and type-checks the packages and apps the change touches, plus everything that depends on them (`--filter=...[origin/main]`). On `main` it runs everything. A change to `tsconfig.base.json` or `turbo.json` counts as touching every package.

| Job              | What it runs                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build-and-test` | The formatting check, a check that the Playwright image the workflows use matches `@playwright/test` in the demos, then the build, the tests and the type-check |
| `theme-e2e`      | The theme demo's e2e suite, in four shards                                                                                                                      |
| `theme-visual`   | The theme demo's visual suite, in six shards                                                                                                                    |
| `path-e2e`       | The path demo's e2e suite, without and with localization, and a check that its generated types and import map are current                                       |
| `redirects-e2e`  | The redirects demo's e2e suite, and a check that its generated types and import map are current                                                                 |
| `validate`       | Fails when any job above failed. It is the check a pull request needs to merge                                                                                  |

A demo's suites run only when a change can alter what the demo runs: a file in the demo or in a package it builds from, a `package.json` change beyond metadata such as `version` or `homepage`, a lockfile change to their dependencies, or `tsconfig.base.json`. Docs, Markdown, unit tests, a package's `bench` folder and licenses never count, and a screenshot-only change runs the visual suite alone. `scripts/demo-tests.sh` makes that call for one demo and prints it under the demo's name, such as `theme_demo_e2e` and `theme_demo_visual`. The Screenshots and React Doctor workflows start only for changes under `packages/theme` or `apps/theme-demo`, and then make the same call.

The jobs install Node, Bun and the dependencies through one local action, `.github/actions/setup`. The Docs workflow deploys the docs site on every push to `main` that changes `apps/docs` or `.github/assets`, and after each release.

### Query report

On a pull request that changes `packages/path` or `packages/redirects`, the Query report workflow comments with what each important operation costs on the pull request's base and on the pull request: its query count, which is exact, and its median time, on MongoDB, Postgres and SQLite, measured in turns on the same runner. It marks a row ⚠️ when the pull request adds a query or is slower by more than 5 ms and 25%, and never fails the build. To run a package's report against `origin/main`, or the commit in `QUERY_REPORT_BASE`:

```sh
cd packages/redirects && QUERY_REPORT_OUTPUT="$TMPDIR/redirects.json" bunx vitest run --config test/query-report.config.ts
cd ../.. && bun scripts/query-report/report.ts "$TMPDIR/redirects.json"
```

## Release

Each package has its own version, changelog and tags. Merge pull requests with a [Conventional Commits](https://www.conventionalcommits.org) title. A commit counts toward a package when it changes a file in that package's folder, outside the folders it lists under `exclude-paths` in `release-please-config.json`: those that never ship to npm, such as its `test` folder. The README and `package.json` ship with the package, so a change to them releases it too.

Release Please keeps one release pull request open for each package that has changes, titled with the package and its next version, such as `chore(main): release theme 0.3.7`. Merging it tags the package as `<name>-v<version>`, such as `theme-v0.3.7`, publishes it to npm with provenance and deploys the docs site to GitHub Pages. To deploy the docs by hand, run the Docs workflow from the Actions tab. The Release workflow runs by hand from there too, on `main`, to run Release Please again without a push.

The theme's tags up to `v0.3.4` come from before the repository held more than one package. `theme-v0.3.4` marks the same commit as `v0.3.4`, so Release Please continues from there.

The release, screenshots and visual baseline workflows need the repository secret `PAYLOADPACK_RELEASE_BOT_TOKEN`. The release workflow publishes to npm through trusted publishing, so no npm token is stored.

## Docs

`apps/docs` is one docs site for every package, deployed to this repository's GitHub Pages on docs.payloadpack.com. Each package has its own path, such as `/theme/`, with its own sidebar, and the switcher in the top left moves between packages. A package's pages live in `apps/docs/src/content/docs/<name>/` and its sidebar is its topic in `apps/docs/astro.config.mjs`.

The theme's docs used to live on theme.payloadpack.com. A redirect rule in Cloudflare sends every path there to the same path under docs.payloadpack.com/theme.

## Adding a package

1. **Folder.** Create `packages/<name>` with `src`, `test`, a `README.md` and a `LICENSE`, and a `tsconfig.json` that extends `../../tsconfig.base.json`. If it needs a Payload app to run in, add `apps/<name>-demo` with `"@payloadpack/<name>": "workspace:*"` as a dependency and the `@playwright/test` version the other demos use.
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
     "publishConfig": { "access": "public" }
   }
   ```

   npm checks `repository.url` against the repository that publishes, so keep it exactly as above. Leave `provenance` out of `publishConfig`: trusted publishing attaches provenance by itself, and with it set, the first version's publish from a laptop fails.

3. **Docs.** Put its pages in `apps/docs/src/content/docs/<name>/`, with an `index` page. Add a topic for it to the `starlightSidebarTopics` list in `apps/docs/astro.config.mjs`, with `label: '<name>'`, `link: '/<name>/'` and its sidebar under `items`, and a card for it on the landing page, `apps/docs/src/content/docs/index.mdx`.
4. **CI.** For a demo, add a line to the `changes` job in `.github/workflows/ci.yml` that runs `scripts/demo-tests.sh @apps/<name>-demo`, expose its `<name>_demo_e2e` key as a job output, and add a `<name>-e2e` job like `path-e2e` that runs unless that output is `false`. Add the job to `validate.needs`, or its failure won't block a merge.
5. **Conventions.** Add `.claude/rules/<name>/naming.md` with the package's terms and `.claude/rules/<name>/package.md` with its own rules, each with `paths:` frontmatter for `packages/<name>/**`, `apps/<name>-demo/**` and `apps/docs/src/content/docs/<name>/**`. Add a `dev:<name>` script to the root `package.json`, `turbo dev --filter=@apps/<name>-demo`, and an entry that runs it to `.claude/launch.json`.
6. **Overviews.** Add the package and its demo to this file's Repository table, its dev command to the Develop table and a section on testing it, and give it a section in the root `README.md`, like the theme's.
7. **First release.** npm can't publish a package's first version through trusted publishing, so that version is published by hand, and Release Please learns about the package only after it:
   1. Merge the pull request that brings the package in without adding it to `release-please-config.json` or `.release-please-manifest.json`. The docs deploy on that merge, because it changes `apps/docs`.
   2. Tag the merge commit with a GitHub release: `gh release create <name>-v0.1.0 --target <merge commit sha> --title '<name>: v0.1.0' --notes 'First release.'`
   3. Publish that version by hand from the tag: check out `<name>-v0.1.0`, run `bun install --frozen-lockfile`, then `npm publish` in `packages/<name>`.
   4. In a second pull request, add the package to both Release Please files, with the version from its `package.json` and the folders that never ship to npm:

      ```jsonc
      // release-please-config.json, under "packages"
      "packages/<name>": {
        "package-name": "@payloadpack/<name>",
        "changelog-path": "CHANGELOG.md",
        "exclude-paths": ["packages/<name>/test"]
      }

      // .release-please-manifest.json
      "packages/<name>": "0.1.0"
      ```

      On its merge, Release Please finds the `<name>-v0.1.0` release and counts the next version from the commits after it.

   5. When Release Please has the package's first release pull request ready to merge, add a trusted publisher on the package's Settings page on npmjs.com: GitHub Actions, organization `payloadpack`, repository `plugins`, workflow `release.yml`, with `npm publish` allowed. Without that, a new trusted publisher can only stage a publish, and the workflow's `npm publish` is refused. Add it no earlier: a new trusted publisher expires unless a release uses it within 2 days.

   Keep this order. Release Please runs on every push to `main`, so a package that is in its files before the tag exists gets a release pull request at once: with no release to count from, Release Please treats the manifest's `0.1.0` as released and proposes the next version from every commit in the package's folder, before `0.1.0` is on npm.

A package never reaches into another package's internals. It imports another package by name, through the exports that package publishes, and never through a path into its folder.
