import { VIEWED_PATHS } from '../../viewed-paths.ts'

type Props = { params: Promise<{ segments?: string[] }> }

// Only the paths the bench views exist, each built once at build time without reading the database,
// so a page view costs the same on every database and the proxy's check is all that differs.
export const dynamicParams = false

export function generateStaticParams() {
  return VIEWED_PATHS.map((path) => ({ segments: path.split('/').slice(1) }))
}

export default async function ViewedPage({ params }: Props) {
  const { segments = [] } = await params
  return <h1>/{segments.join('/')}</h1>
}
