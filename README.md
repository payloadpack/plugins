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

## [@payloadpack/path](packages/path)

<a href="https://www.npmjs.com/package/@payloadpack/path"><img alt="npm version" src="https://img.shields.io/npm/v/@payloadpack/path"></a>
<a href="https://payloadcms.com"><img alt="Payload version" src="https://img.shields.io/npm/dependency-version/@payloadpack/path/peer/payload"></a>

Stored URL paths for pages and posts. Editors pick a parent and a slug, a document takes its whole branch along when it moves, and your site finds the document at a path in one indexed query, in any language.

```sh
bun add @payloadpack/path
```

<a href="https://docs.payloadpack.com/path/"><b>Documentation</b></a> · <a href="packages/path#readme">README</a> · <a href="packages/path/CHANGELOG.md">Changelog</a>

## [@payloadpack/redirects](packages/redirects)

<a href="https://www.npmjs.com/package/@payloadpack/redirects"><img alt="npm version" src="https://img.shields.io/npm/v/@payloadpack/redirects"></a>
<a href="https://payloadcms.com"><img alt="Payload version" src="https://img.shields.io/npm/dependency-version/@payloadpack/redirects/peer/payload"></a>

Redirects editors manage, from an exact path or a regex, to a page or a URL. Your site finds them through database indexes at the same cost for 100,000 as for 1,000, and with `@payloadpack/path` every move of a page suggests a redirect from its old path, which an editor turns on with a yes.

```sh
bun add @payloadpack/redirects
```

<a href="https://docs.payloadpack.com/redirects/"><b>Documentation</b></a> · <a href="packages/redirects#readme">README</a> · <a href="packages/redirects/CHANGELOG.md">Changelog</a>

## Contributing

Each plugin lives in `packages/<name>` and releases on its own version. [CONTRIBUTING.md](CONTRIBUTING.md) covers the layout, the commands and how to add a plugin.

## License

Each plugin has its own license, in the `LICENSE` file in its folder.
