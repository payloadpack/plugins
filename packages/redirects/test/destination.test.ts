import { expect, it } from 'vitest'

import { buildDestination, isUrlTarget } from '../src/redirect/destination.js'

// Group 0 is the whole match, which no target names in these tests.
const captured = (...captures: string[]) => ({ captures: ['', ...captures] })

it('writes a target as a Location header carries it', () => {
  expect([
    buildDestination('/new/$1', captured('team/söder')),
    buildDestination('/new/$1/$2', captured('a', 'b')),
    buildDestination('/kontakt-ö?ref=$1#form', captured('x')),
    buildDestination('https://shop.example$1', captured('/cart')),
    buildDestination('/new-page', { pathBelow: '/team/söder' }),
    buildDestination('/', { pathBelow: '/team' }),
    buildDestination('https://shop.example', { pathBelow: '/cart/42' }),
    buildDestination('https://shop.example/?ref=1', { pathBelow: '/cart' }),
    buildDestination('https://shop.example/', {})
  ]).toEqual([
    '/new/team/s%C3%B6der',
    '/new/a/b',
    '/kontakt-%C3%B6?ref=x#form',
    'https://shop.example/cart',
    '/new-page/team/s%C3%B6der',
    '/team',
    'https://shop.example/cart/42',
    'https://shop.example/cart?ref=1',
    'https://shop.example/'
  ])
})

it('keeps a captured ? or # in the path, and no line break reaches the header', () => {
  expect(buildDestination('/new/$1', captured('a b?c#d'))).toBe('/new/a%20b%3Fc%23d')
  expect(buildDestination('/new/$1', captured('a\r\nLocation: https://other.example'))).toBe(
    '/new/a%0D%0ALocation%3A%20https%3A//other.example'
  )
  expect(buildDestination('/new', { pathBelow: '/a\r\nb' })).toBe('/new/a%0D%0Ab')
})

it('sends nobody where what a visitor fills in would take the target to another site', () => {
  expect([
    // //other.example after the first slash.
    buildDestination('/$1', captured('/other.example')),
    // A .. that resolves to //other.example.
    buildDestination('/new/$1', captured('..//other.example')),
    buildDestination('/', { pathBelow: '//other.example' }),
    // .other.example after the host.
    buildDestination('https://shop.example$1', captured('.other.example/cart')),
    buildDestination('https://$1', captured('other.example'))
  ]).toEqual([null, null, null, null, null])
})

it('sends nobody where a visitor fills in a backslash or a tab, which a browser can read as a slash', () => {
  expect([
    buildDestination('/$1', captured('\\other.example')),
    buildDestination('/$1', captured('\t/other.example')),
    buildDestination('https://shop.example$1', captured('\\cart')),
    buildDestination('/new', { pathBelow: '/\\other.example' }),
    buildDestination('/new', { pathBelow: '/\t/other.example' })
  ]).toEqual([null, null, null, null, null])
  // A group the target doesn't name fills in nothing.
  expect(buildDestination('/new', captured('\\other.example'))).toBe('/new')
})

it('never takes a target that starts with a slash to another site', () => {
  expect(buildDestination('//other.example', {})).toBeNull()
  expect(buildDestination('/\\other.example', {})).toBeNull()
})

it("keeps a visitor's parameters after the target's own, and the target's value of a parameter both have", () => {
  const searchParams = new URLSearchParams('utm_source=mail&ref=visitor&q=a b')
  expect([
    buildDestination('/kontakt-ö?ref=old#form', { searchParams }),
    buildDestination('https://shop.example', { pathBelow: '/cart', searchParams }),
    buildDestination('/new/$1', { ...captured('x'), searchParams }),
    buildDestination('/new', { searchParams: new URLSearchParams() })
  ]).toEqual([
    '/kontakt-%C3%B6?ref=old&utm_source=mail&q=a+b#form',
    'https://shop.example/cart?utm_source=mail&ref=visitor&q=a+b',
    '/new/x?utm_source=mail&ref=visitor&q=a+b',
    '/new'
  ])
})

it('takes a path on this site or a whole http(s) URL as a URL target', () => {
  const accepted = [
    '/contact',
    '/new/$1',
    '/kontakt-ö?ref=1#form',
    'https://example.com',
    'http://example.com/a',
    'https://shop.example$1'
  ]
  const refused = [
    'contact',
    '//other.example',
    '/\\other.example',
    '/\t/other.example',
    'https://',
    'ftp://example.com',
    'mailto:a@example.com'
  ]

  expect(accepted.filter((target) => !isUrlTarget(target))).toEqual([])
  expect(refused.filter((target) => isUrlTarget(target))).toEqual([])
})
