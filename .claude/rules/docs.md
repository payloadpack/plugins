---
paths:
  - 'README.md'
  - 'packages/*/README.md'
  - 'apps/docs/**'
  - '.github/assets/**'
---

# README and docs

- The root `README.md` introduces the repository with one section per package: its badges, a one-line pitch, its picture, the install command and links to its docs, README and changelog. It links images by paths relative to the repository; a package's README uses absolute `raw.githubusercontent.com` URLs, because npm shows it outside the repository.
- The theme's README, `packages/theme/README.md`, is its npm page and a short pitch: what the theme brings, install, a config overview and screenshots, linking to the docs site. Everything else goes in the docs pages.
- The docs site in `apps/docs` (Astro Starlight, deployed to GitHub Pages on docs.payloadpack.com after each release) holds every package's docs, each under its own path such as `/theme/`, and is for people installing them. Each page answers what they want to know: what it looks like, how to install, how to set the default or limit what editors can pick, with the real config keys and values. Never document internals or write an editor's manual of the panel.
- Every code example matches the screenshot beside it: copy the demo field that rendered it.
- Use the payloadpack brand: the two-cards logo, drawn by `apps/docs/scripts/render-brand-assets.mjs`, and the emerald to cyan gradient in `apps/docs/src/styles/docs.css`. Never invent a logo or a brand color.
- Images come from scripts, never by hand: screenshots from `apps/theme-demo/tests/screenshots.ts`, the README GIFs from `apps/theme-demo/tests/panel-tour.ts`, the social preview from `apps/theme-demo/tests/social-preview.ts`, the logo and favicon from `render-brand-assets.mjs`.
- The social preview frames its own capture of the demo admin in `apps/theme-demo/tests/social-preview.html`, and renders only when someone runs it. The docs site uses it as its `og:image`; GitHub's copy is uploaded by hand under Settings → Social preview, because GitHub has no API for it, so re-upload it after every render. Its glow is light blue, `rgb(125 211 252)`, not the brand gradient.
- The theme's README marks its features with emojis, not drawn icons.
