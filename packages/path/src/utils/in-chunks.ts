// SQLite binds at most 32,766 values in one statement, the tightest limit of the three databases. A
// chunk of 1,000 stays far below it, at one more read and one more round of writes for every
// thousand documents.
export const CHUNK_SIZE = 1_000

export function inChunks<Value>(values: Value[]) {
  const chunks: Value[][] = []
  for (let start = 0; start < values.length; start += CHUNK_SIZE) chunks.push(values.slice(start, start + CHUNK_SIZE))
  return chunks
}
