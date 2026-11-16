<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/icons/logo-light.svg">
    <img width="64" height="64" alt="" src=".github/assets/icons/logo-dark.svg">
  </picture>
</p>

<h1 align="center">@payloadpack plugins</h1>

<p align="center">Open-source plugins for <a href="https://payloadcms.com">Payload</a> v4.<br>Each one installs on its own from npm.</p>

<p align="center">
  <a href="https://github.com/payloadpack/plugins/actions/workflows/ci.yml"><img alt="Build status" src="https://github.com/payloadpack/plugins/actions/workflows/ci.yml/badge.svg?branch=main"></a>
</p>

## [@payloadpack/theme](packages/theme)

<a href="https://www.npmjs.com/package/@payloadpack/theme"><img alt="npm version" src="https://img.shields.io/npm/v/@payloadpack/theme"></a>
<a href="https://payloadcms.com"><img alt="Payload version" src="https://img.shields.io/npm/dependency-version/@payloadpack/theme/peer/payload"></a>

A custom admin UI theme with three styles and four palettes, in light and dark. Each editor picks their own look from the Appearance panel.

<a href="https://docs.payloadpack.com/theme/">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/panel-tour-light.gif">
    <img alt="The Appearance panel switching between the Warm, Soft and Neutral palettes and the Studio, Payload and Enhanced styles" src=".github/assets/panel-tour-dark.gif">
  </picture>
</a>

```sh
bun add @payloadpack/theme
```

<a href="https://docs.payloadpack.com/theme/"><b>Documentation</b></a> · <a href="packages/theme#readme">README</a> · <a href="packages/theme/CHANGELOG.md">Changelog</a>

## Contributing

Each plugin lives in `packages/<name>` and releases on its own version. [CONTRIBUTING.md](CONTRIBUTING.md) covers the layout, the commands and how to add a plugin.

## License

Each plugin has its own license in its folder. The theme's is the [PolyForm Perimeter License 1.0.1](packages/theme/LICENSE).
