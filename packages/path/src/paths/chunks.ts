/**
 * How many values a statement names in one list, and how many rows one read asks for. A branch can
 * hold any number of documents, so what grows with it is asked for a chunk at a time. SQLite binds
 * at most 32,766 values in one statement, the tightest limit of the three databases, and a chunk of
 * 1,000 stays far below it, at one more read for every thousand documents.
 */
export const CHUNK_SIZE = 1_000

export function inChunks<Value>(values: Value[]) {
  const chunks: Value[][] = []
  for (let start = 0; start < values.length; start += CHUNK_SIZE) chunks.push(values.slice(start, start + CHUNK_SIZE))
  return chunks
}
