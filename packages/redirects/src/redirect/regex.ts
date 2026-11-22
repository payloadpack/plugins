import { RE2JS } from 're2js'

import { REGEX_TOO_LARGE_REFUSAL, unreadableRegexRefusal } from '../plugin/messages.js'

// Each instruction is a step the engine may take for every character of a path, and regexes run on
// every path no document holds. Real regexes, one listing 100 old slugs included, compile to under
// 60, while a repeat such as (?:a?){1000} compiles to about 2,000 and takes 13 ms on a long path.
const MOST_REGEX_INSTRUCTIONS = 1_000

/**
 * Why a regex can't be saved, or null when it can: RE2 can't run it, such as a look-ahead, a
 * look-behind or a back-reference, or it is too large to try on every path no document holds.
 */
export function buildRegexRefusal(regex: string) {
  try {
    if (RE2JS.compile(regex).programSize() <= MOST_REGEX_INSTRUCTIONS) return null
  } catch (error) {
    return unreadableRegexRefusal((error as Error).message)
  }
  return REGEX_TOO_LARGE_REFUSAL
}

/**
 * The fixed start of a regex, the path every path it matches lies at or below: the text RE2 works out
 * every match begins with, cut at its last slash, so /news for /news/(.*), and / for a regex that
 * starts with a choice or a group. A lookup finds the regexes that could match a path by this, through
 * an index, so it tries only those.
 */
export function buildFixedStart(regex: string) {
  let literalStart: string
  try {
    // re2Input.prefix is not part of re2js's documented API, which a test pins.
    literalStart = RE2JS.compile(regex.replace(/^\^/, '')).re2Input.prefix
  } catch {
    // Payload runs the field's hook before it reports the field's refusal, so the save still fails.
    return '/'
  }
  return literalStart.slice(0, literalStart.lastIndexOf('/')) || '/'
}

/**
 * The parts of the path a regex's groups captured, by group number, or null when it doesn't
 * match. A regex is matched against the whole path, on RE2, whose time grows only with the path, so
 * no regex backtracks or gives up on a match.
 *
 * A stored regex RE2 can't compile matches nothing, so one written to the database without the
 * field's check never fails the lookup of every path.
 */
export function matchRegex(regex: string, path: string): (string | undefined)[] | null {
  let compiledRegex: RE2JS
  try {
    compiledRegex = RE2JS.compile(regex)
  } catch {
    return null
  }
  // matches() takes only a match of the whole path, so the engine never starts again at every character.
  const matcher = compiledRegex.matcher(path)
  if (!matcher.matches()) return null
  return Array.from({ length: compiledRegex.groupCount() + 1 }, (_, group) => matcher.group(group) ?? undefined)
}
