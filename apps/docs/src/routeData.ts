import { defineRouteMiddleware } from '@astrojs/starlight/route-data'

// Names the package in the browser title, as in "Installation | @payloadpack/theme".
export const onRequest = defineRouteMiddleware((context) => {
  const currentPackage = context.locals.starlightSidebarTopics.topics.find((topic) => topic.isCurrent)
  const { head, siteTitle } = context.locals.starlightRoute
  const title = head.find((entry) => entry.tag === 'title')
  if (currentPackage && title?.content?.endsWith(siteTitle)) title.content += `/${currentPackage.label}`
})
