// The sections of the site, /area-0 to /area-99, which the seeded redirects' paths sit in.
export const AREAS = 100

const VIEWED_PATH_COUNT = 500

/**
 * The page views the bench times: pages that exist, which no redirect covers, 2 or 3 segments deep in
 * the same sections as the seeded redirects, so each check reads real neighbours in the indexes.
 */
export const VIEWED_PATHS = Array.from({ length: VIEWED_PATH_COUNT }, (_, index) => {
  const page = `/area-${index % AREAS}/view-${index}`
  return index % 2 === 0 ? page : `${page}/detail`
})
