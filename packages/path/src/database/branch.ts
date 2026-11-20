import type { PayloadRequest } from 'payload'

import type { Id } from '../path/build-path-and-ancestors.js'
import { inChunks } from '../utils/in-chunks.js'
import { setPathAndAncestorsFieldsInMongodb } from './branch-mongodb.js'
import { lockBranchInPostgres, setPathAndAncestorsFieldsInSql } from './branch-sql.js'

export type RowKind = 'documents' | 'versions'

export type RowFields = { fields: Record<string, unknown>; id: Id }

const usesSql = (database: string) => database === 'postgres' || database === 'sqlite'

// On Postgres two saves in one branch can each hold a row the other waits for, so a move first holds
// its whole branch. Without a transaction a lock would end with its statement, so none is taken.
export async function lockBranch(collection: string, id: Id, req: PayloadRequest) {
  if (req.payload.db.name === 'postgres' && (await req.transactionID)) await lockBranchInPostgres(collection, id, req)
}

// Statements of the package's own, where everything else goes through Payload's database API: that
// API writes one row at a time, whole. These write a chunk of rows in a few statements and leave
// every other value of a row as it was, updatedAt too.
export async function setPathAndAncestorsFields(collection: string, kind: RowKind, rows: RowFields[], req: PayloadRequest) {
  const setFields = usesSql(req.payload.db.name) ? setPathAndAncestorsFieldsInSql : setPathAndAncestorsFieldsInMongodb
  for (const chunk of inChunks(rows)) await setFields(collection, kind, chunk, req)
}
