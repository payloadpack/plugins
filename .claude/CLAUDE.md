# payloadpack/plugins

- Each published `@payloadpack` package lives in `packages/<name>` and releases on its own version. A package imports another only by its package name, through its published exports.
- `packages/theme` is the theme. `apps/theme-demo` imports its `dist`, so run `bun run build --filter=@payloadpack/theme` after every change.
- `apps/docs` is the docs site for every package, each under its own path, and `packages/theme/README.md` is the theme's npm README. The root `README.md` introduces the repository with a section per package.
- Run `bun run test` and `bun run typecheck` from the root, and `bun run test:e2e` in `apps/theme-demo`, before calling a change done. `bun run test:visual` in `apps/theme-demo` (after e2e: they share the e2e database) runs CI's Playwright container in Docker and compares against the committed Linux images, so a local pass means CI's visual job passes.
- The visual baselines in `apps/theme-demo/tests/__visual__` are Linux images from CI. Accept an intended visual change with the `update-visuals` pull request label, never by committing images by hand.
- Names in code, docs and UI follow `rules/naming.md`: use its terms and never its _Avoid_ words. When a change settles a new term, add it there.
- Commits and PR titles follow Conventional Commits. Never add AI attribution.
