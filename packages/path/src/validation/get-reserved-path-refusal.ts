import type { Payload } from 'payload'

import { ADMIN_ROUTE_REASON, API_ROUTE_REASON, reservedAnyDepthRefusal, reservedRootRefusal } from '../plugin/messages.js'
import { getPathConfig, type ReasonBySegment } from '../plugin/options.js'

// The routes are read from the running config, because the plugin gets the config before Payload fills
// in their defaults. A route at the root has no root segment.
function getPayloadRootSegments({ routes }: Payload['config']): ReasonBySegment {
  const reasons = [
    [routes.admin, ADMIN_ROUTE_REASON],
    [routes.api, API_ROUTE_REASON]
  ] as const
  return Object.fromEntries(
    reasons.flatMap(([route, reason]) => {
      const segment = route.split('/').find((routeSegment) => routeSegment !== '')
      return segment === undefined ? [] : [[segment, reason]]
    })
  )
}

export function getReservedPathRefusal(path: string, payload: Payload) {
  const { anyDepth, root = getPayloadRootSegments(payload.config) } = getPathConfig(payload).reservedSegments
  const segments = path.split('/').slice(1)
  const reservedSegment = segments.find((segment) => Object.hasOwn(anyDepth, segment))
  if (reservedSegment !== undefined) return reservedAnyDepthRefusal(reservedSegment, anyDepth[reservedSegment])
  // The segment at the root, which a base path's first segment is too.
  const [rootSegment = ''] = segments
  if (Object.hasOwn(root, rootSegment)) return reservedRootRefusal(rootSegment, root[rootSegment])
}
