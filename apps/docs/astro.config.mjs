import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import starlightSidebarTopics from 'starlight-sidebar-topics'

export default defineConfig({
  site: 'https://docs.payloadpack.com',
  // Starlight's Steps and Tabs run satteri, whose native binary is found next to its own files. Bun keeps
  // satteri inside Starlight's folder, so a bundled copy would lose it: the build loads it from there.
  vite: { build: { rollupOptions: { external: [/[\\/]satteri[\\/]dist[\\/]/] } } },
  integrations: [
    starlight({
      title: '@payloadpack',
      description: 'Docs for the open-source @payloadpack plugins for Payload v4.',
      head: [
        {
          tag: 'meta',
          attrs: {
            property: 'og:image',
            content: 'https://raw.githubusercontent.com/payloadpack/plugins/main/.github/assets/social-preview.png'
          }
        }
      ],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/payloadpack/plugins' }],
      customCss: ['@fontsource-variable/inter', './src/styles/docs.css'],
      components: {
        Head: './src/components/Head.astro',
        PageTitle: './src/components/PageTitle.astro',
        Sidebar: './src/components/Sidebar.astro',
        SiteTitle: './src/components/SiteTitle.astro',
        ThemeSelect: './src/components/ThemeSelect.astro'
      },
      routeMiddleware: './src/routeData.ts',
      expressiveCode: {
        defaultProps: { frame: 'code' },
        themes: ['github-dark', 'github-light'],
        styleOverrides: {
          borderColor: 'var(--docs-border)',
          borderRadius: '0.75rem',
          codeBackground: 'var(--docs-code-bg)',
          codeFontSize: '0.8125rem',
          frames: {
            editorActiveTabBackground: 'var(--docs-card)',
            editorActiveTabIndicatorTopColor: 'transparent',
            editorActiveTabIndicatorBottomColor: 'transparent',
            editorTabBarBackground: 'var(--docs-card)',
            editorTabBarBorderBottomColor: 'var(--docs-border)',
            frameBoxShadowCssValue: 'var(--docs-shadow-card)',
            terminalBackground: 'var(--docs-code-bg)',
            terminalTitlebarBackground: 'var(--docs-card)',
            terminalTitlebarBorderBottomColor: 'var(--docs-border)'
          }
        }
      },
      plugins: [
        starlightSidebarTopics([
          {
            label: 'theme',
            link: '/theme/',
            items: [
              { slug: 'theme', attrs: { 'data-icon': 'book-open' } },
              { slug: 'theme/installation', attrs: { 'data-icon': 'download' } },
              { slug: 'theme/configuration', attrs: { 'data-icon': 'settings-2' } },
              {
                label: 'Guides',
                items: [
                  'theme/styles-and-palettes',
                  'theme/add-a-palette',
                  'theme/customize',
                  'theme/nav-icons',
                  'theme/translations'
                ]
              },
              { label: 'Fields', items: ['theme/fields/vertical-tabs', 'theme/fields/radio-cards', 'theme/fields/switch'] }
            ]
          },
          {
            label: 'path',
            link: '/path/',
            items: [
              { slug: 'path', attrs: { 'data-icon': 'book-open' } },
              { slug: 'path/installation', attrs: { 'data-icon': 'download' } },
              { slug: 'path/configuration', attrs: { 'data-icon': 'settings-2' } },
              { slug: 'path/speed', attrs: { 'data-icon': 'gauge' } },
              {
                label: 'How it works',
                items: ['path/paths', 'path/moves-and-deletes', 'path/drafts', 'path/languages', 'path/refusals', 'path/limits']
              },
              {
                label: 'API',
                items: [
                  'path/api/find-by-path',
                  'path/api/find-paths',
                  'path/api/on-paths-changed',
                  'path/api/backfill-paths',
                  'path/api/get-path-collection-slugs'
                ]
              }
            ]
          },
          {
            label: 'redirects',
            link: '/redirects/',
            items: [
              { slug: 'redirects', attrs: { 'data-icon': 'book-open' } },
              { slug: 'redirects/installation', attrs: { 'data-icon': 'download' } },
              { slug: 'redirects/configuration', attrs: { 'data-icon': 'settings-2' } },
              { slug: 'redirects/speed', attrs: { 'data-icon': 'gauge' } },
              { label: 'How it works', items: ['redirects/matching', 'redirects/moves'] }
            ]
          }
        ])
      ]
    })
  ]
})
