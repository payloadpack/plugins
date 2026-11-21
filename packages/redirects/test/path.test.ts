import { expect, it } from 'vitest'

import { buildComparedPath, cleanFromPath, buildSitePath } from '../src/redirect/path.js'
import { buildTrackingParameters } from '../src/redirect/query-string.js'

const TRACKING = buildTrackingParameters(['ref_src'])
const cleanPath = (value: string) => cleanFromPath(value, TRACKING)

it('cleans what an editor typed into the decoded, lowercased path the site looks up', () => {
  const values = {
    'https://example.com/old-page/#top': '/old-page',
    'https://example.com': '/',
    'old-page': '/old-page',
    '//old-page': '/old-page',
    '///old-page/': '/old-page',
    '/old-page/': '/old-page',
    '  /old-page  ': '/old-page',
    '\\\\old-page': '/old-page',
    '/\\old-page': '/old-page',
    '\\/old-page': '/old-page',
    '/q%26a': '/q&a',
    '/caf%C3%A9': '/café',
    '/%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82': '/привет',
    '/a b': '/a b',
    '/': '/',
    '/About-Us': '/about-us',
    '/ÖPPETTIDER': '/öppettider'
  }

  expect(Object.keys(values).map(cleanPath)).toEqual(Object.values(values))
})

it('keeps a query string as a redirect compares it: lowercased, decoded, sorted, without tracking parameters', () => {
  const values = {
    'https://example.com/News.aspx?ID=123#top': '/news.aspx?id=123',
    '/news.aspx?b=2&a=1': '/news.aspx?a=1&b=2',
    '/list?tag=b&tag=a': '/list?tag=a&tag=b',
    '/search?q=caf%C3%A9': '/search?q=café',
    '/search?q=a+b': '/search?q=a b',
    '/search?flag': '/search?flag=',
    '/news.aspx?id=1&utm_source=mail&GCLID=x&ref_src=feed': '/news.aspx?id=1',
    '/news.aspx?utm_campaign=spring': '/news.aspx',
    '/old-page?': '/old-page'
  }

  expect(Object.keys(values).map(cleanPath)).toEqual(Object.values(values))
})

// An editor's save sends the stored from back, so it must clean to itself.
it('cleans a cleaned from to itself, also where a parameter holds a character that splits a query string, or whitespace or a slash ends up at an edge', () => {
  const typedFroms = [
    '/search?q=a%2Bb',
    '/search?q=a%26b%3Dc',
    '/search?q=100%25',
    '/search?q=%23tag',
    '/list?tag=b&tag=a&TAG=c',
    '/q?a%3Db=1',
    'https://example.com/broken-link%20',
    '/search?q=summer+',
    'https://example.com//old-page',
    '/%2Fold-start',
    '/old-end%2F',
    '/old%2F..%2Fpage'
  ]

  for (const typedFrom of typedFroms) {
    const cleanedFrom = cleanPath(typedFrom)!
    expect(cleanPath(cleanedFrom)).toBe(cleanedFrom)
  }
  expect(typedFroms.map(cleanPath)).toEqual([
    '/search?q=a%2Bb',
    '/search?q=a%26b%3Dc',
    '/search?q=100%25',
    '/search?q=%23tag',
    '/list?tag=a&tag=b&tag=c',
    '/q?a%3Db=1',
    '/broken-link%20',
    '/search?q=summer%20',
    '/old-page',
    '/old-start',
    '/old-end',
    '/page'
  ])
})

it('finds no path in a value that holds none on this site', () => {
  const values = ['//', '///', '\\\\', '/%2F', 'https://', 'http://', 'mailto:someone@example.com', 'old:page']

  expect(values.map(cleanPath)).toEqual(values.map(() => null))
})

it('keeps a % that starts no escape, encoded as the site compares it', () => {
  expect(cleanPath('/100%-cotton')).toBe('/100%25-cotton')
  expect(cleanPath('/100%25-cotton')).toBe('/100%25-cotton')
})

// Decoded, each would read back as something else on the next save: /q?a as /q and a query string.
it('keeps encoded what a URL reads as something else than a path, so a cleaned from cleans to itself', () => {
  const values = {
    '/FAQ%3Fold': '/faq%3Fold',
    '/a%23b': '/a%23b',
    '/a%5Cb': '/a%5Cb',
    '/tab%09here': '/tab%09here',
    '/a%2541': '/a%2541',
    '/Caf%C3%A9%3F': '/café%3F'
  }

  expect(Object.keys(values).map(cleanPath)).toEqual(Object.values(values))
  for (const cleanedFrom of Object.values(values)) expect(cleanPath(cleanedFrom)).toBe(cleanedFrom)
  expect(buildComparedPath('/FAQ?old#top')).toBe('/faq%3Fold%23top')
})

it('decodes a destination on this site into the path the site looks up, and gives null for any other', () => {
  expect(buildSitePath('/%D0%BC%D0%B8%D1%80/team?ref=1#top')).toBe('/мир/team')
  expect(buildSitePath('/q%26a')).toBe('/q&a')
  expect(buildSitePath('https://shop.example/cart')).toBeNull()
  expect(buildSitePath('/a%2Fb')).toBeNull()
  expect(buildSitePath('/%E0%A4%A')).toBeNull()
})
