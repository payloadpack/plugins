import { expect, it } from 'vitest'

import {
  buildQueryString,
  buildSearchParams,
  buildTrackingParameters,
  buildTrackingSearchParams,
  hasRegexQueryString
} from '../src/redirect/query-string.js'

const TRACKING = buildTrackingParameters()

it('never compares the default tracking parameters, nor the ones a site adds, in any case', () => {
  expect(TRACKING).toEqual(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'])
  expect(buildTrackingParameters(['Ref_Src', 'utm_source'])).toEqual([...TRACKING, 'ref_src'])

  const searchParams = new URLSearchParams(
    'id=1&utm_source=a&utm_medium=b&utm_campaign=c&utm_term=d&utm_content=e&gclid=f&fbclid=g&UTM_SOURCE=h&ref_src=i'
  )
  expect(buildQueryString(searchParams, TRACKING)).toBe('id=1&ref_src=i')
  expect(buildQueryString(searchParams, buildTrackingParameters(['ref_src']))).toBe('id=1')
})

it('compares a query string lowercased and sorted by name and then value, whatever order a visitor sent', () => {
  expect(buildQueryString(new URLSearchParams('B=2&a=Y&a=x'), TRACKING)).toBe('a=x&a=y&b=2')
  expect(buildQueryString(new URLSearchParams('utm_source=mail'), TRACKING)).toBe('')
})

it('takes a page’s searchParams with each value of a repeated parameter', () => {
  expect([...buildSearchParams({ empty: undefined, id: '1', tag: ['a', 'b'] })]).toEqual([
    ['id', '1'],
    ['tag', 'a'],
    ['tag', 'b']
  ])
  expect([...buildSearchParams(undefined)]).toEqual([])
})

it('keeps only the tracking parameters of a query string, as the visitor sent them', () => {
  expect(buildTrackingSearchParams(new URLSearchParams('id=1&UTM_Source=Mail'), TRACKING).toString()).toBe('UTM_Source=Mail')
})

it('finds a query string in a regex written with \\? or ?name=, and none in (?i), a? or a group', () => {
  const withQueryString = ['/news\\.aspx\\?id=(\\d+)', '/news.aspx?id=(\\d+)', '/search\\?(.*)']
  const withoutQueryString = [
    '(?i)/news/(.*)',
    '/colou?r',
    '/(?:en|sv)/blog/(.*)',
    '/(?P<year>\\d{4})',
    '/news/(\\d+)?',
    '/(?=x)a'
  ]

  expect(withQueryString.filter((regex) => !hasRegexQueryString(regex))).toEqual([])
  expect(withoutQueryString.filter(hasRegexQueryString)).toEqual([])
})
