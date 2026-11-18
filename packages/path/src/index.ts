export type {
  BranchChange,
  ChangedPath,
  PathCollection,
  PathPluginOptions,
  PathsChange,
  ReservedSegments
} from './plugin/options.js'
export { pathPlugin } from './plugin/plugin.js'
export { backfillPaths, type BackfillReport } from './api/backfill-paths.js'
export { findByPath, type FoundByPath } from './api/find-by-path.js'
