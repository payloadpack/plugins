import { expect, it } from 'vitest'

import { REGEX_TOO_LARGE_REFUSAL } from '../src/plugin/messages.js'
import { getFixedStart, getRegexRefusal, matchRegex } from '../src/redirect/regex.js'
import { measureFastestRun } from './support/timing.js'

it("refuses only a regex RE2 can't run, or one too large to try on every unknown path", () => {
  const unreadable = ['/(a)\\1', '/(?=a)b', '/(?!a)b', '/(?<=a)b', '/(?<!a)b', '/(oops']
  const acceptedRegexes = [
    '/news/(.*)',
    '^/news/(.*)$',
    '/(a+)+',
    '^/(a+)+$',
    '/(?:a?){26}b',
    '/(?:en|sv)/blog/(.*)',
    '(?i)/news/(.*)'
  ]

  expect(unreadable.map((regex) => getRegexRefusal(regex)?.startsWith("This isn't a regex the site can read ("))).toEqual(
    unreadable.map(() => true)
  )
  expect(getRegexRefusal('/(?:a?){1000}b')).toBe(REGEX_TOO_LARGE_REFUSAL)
  expect(acceptedRegexes.filter((regex) => getRegexRefusal(regex) !== null)).toEqual([])
})

it('accepts a regex that lists 100 old slugs', () => {
  const slugs = Array.from({ length: 100 }, (_, index) => `old-slug-${index}`)
  expect(getRegexRefusal(`/news/(?:${slugs.join('|')})`)).toBeNull()
})

// re2Input.prefix is not part of re2js's documented API, so an upgrade that changes it fails here.
it('builds the fixed start of a regex, or / for one without', () => {
  const fixedStarts = {
    '/news/(.*)': '/news',
    '^/news/2024/(.*)$': '/news/2024',
    '/news/2024/(.*)': '/news/2024',
    '/café/(.*)': '/café',
    '/old\\.html': '/',
    '/news-(\\d+)': '/',
    '/news/(.*)|/blog/(.*)': '/',
    '/(?:en|sv)/blog/(.*)': '/',
    '(?:en|sv)': '/',
    '(?i)/news/(.*)': '/',
    '/(\\d{4})/report-(.*)': '/',
    '(.*)/news': '/',
    '/(oops': '/'
  }

  expect(Object.keys(fixedStarts).map(getFixedStart)).toEqual(Object.values(fixedStarts))
})

it('matches the whole path and gives the parts its groups captured', () => {
  expect(matchRegex('/news/(.*)', '/news/spring')).toEqual(['/news/spring', 'spring'])
  expect(matchRegex('/news', '/news/spring')).toBeNull()
  expect(matchRegex('news/(.*)', '/news/spring')).toBeNull()
  expect(matchRegex('/news/(.*)|/blog/(.*)', '/blog/a')?.slice(0, 3)).toEqual(['/blog/a', undefined, 'a'])
})

it('matches a regex written with ^ and $ the same as without', () => {
  expect(matchRegex('^/news/(.*)$', '/news/spring')?.[1]).toBe('spring')
  expect(matchRegex('^/news/(.*)$', '/x/news/spring')).toBeNull()
})

// Bun's own engine gives up on this path after about half a second and reports no match.
it('finds the match a backtracking engine gives up on', () => {
  const path = `/${'a'.repeat(28)}!`
  expect(matchRegex('/(?:(a+)+x|a+!)', path)?.[0]).toBe(path)
})

it('answers a hostile regex in under a millisecond, with no match', async () => {
  const path = `/${'a'.repeat(30)}!`

  expect(matchRegex('^/(a+)+$', path)).toBeNull()
  expect(await measureFastestRun(() => matchRegex('^/(a+)+$', path))).toBeLessThan(1)
})

it('matches nothing with a stored regex RE2 cannot compile, also one that would compile inside the anchors', () => {
  expect(matchRegex('/(oops', '/(oops')).toBeNull()
  expect(matchRegex('/a)|(.*', '/anything')).toBeNull()
})
