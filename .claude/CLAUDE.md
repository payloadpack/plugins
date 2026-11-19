# payloadpack/plugins

- Each published `@payloadpack` package lives in `packages/<name>` and releases on its own version. A package imports another only by its package name, through its published exports.
- A package's demo, `apps/<name>-demo`, imports the package's `dist`, so run `bun run build --filter=@payloadpack/<name>` after every change to the package.
- `apps/docs` is the docs site for every package, each under its own path, and `packages/<name>/README.md` is a package's npm README. The root `README.md` introduces the repository with a section per package.
- Run `bun run format:check`, `bun run test` and `bun run typecheck` from the root, and `bun run test:e2e` in the demo of each package the change reaches, before calling a change done. A package's own rules in `rules/<name>/` add any further checks.
- Names in code, docs and UI follow the package's glossary, `rules/<name>/naming.md`: use its terms and never its _Avoid_ words. When a change settles a new term, add it there.
- Commits and PR titles follow Conventional Commits. Never add AI attribution.
