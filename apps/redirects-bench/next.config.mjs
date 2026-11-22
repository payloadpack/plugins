import { withPayload } from '@payloadcms/next/withPayload'

// The bench builds this app three times, each into its own folder in .next, and starts each build with
// the same BENCH_BUILD so `next start` finds it. Next finds the proxy by the page extensions, so they
// pick each build's proxy while the pages, all .tsx, stay the same: Next's own take src/proxy.ts, .tsx
// and .win-over-documents.ts take src/proxy.win-over-documents.ts, and .tsx alone takes none.
const PAGE_EXTENSIONS = {
  baseline: ['tsx'],
  'query-string-proxy': undefined,
  'win-over-documents-proxy': ['tsx', 'win-over-documents.ts']
}

// Next's own commands, such as `next typegen`, run without BENCH_BUILD.
const build = process.env.BENCH_BUILD ?? 'query-string-proxy'

if (!Object.hasOwn(PAGE_EXTENSIONS, build)) {
  throw new Error(`BENCH_BUILD is ${build}, so give one of ${Object.keys(PAGE_EXTENSIONS).join(', ')}.`)
}

export default withPayload({
  distDir: `.next/${build}`,
  pageExtensions: PAGE_EXTENSIONS[build]
})
