import type { Slugify } from 'payload/shared'

// Latin letters that carry no accent to take off.
const LATIN_LETTERS: Record<string, string> = { æ: 'ae', ð: 'd', đ: 'd', ł: 'l', ø: 'o', œ: 'oe', ß: 'ss', þ: 'th' }

/**
 * The slugify of a site that gives none. Payload's own keeps a to z only. This one also takes the
 * accent off a Latin letter, so över becomes over, and keeps the letters of other scripts, so
 * новости stays новости.
 */
export const defaultSlugify: Slugify = ({ valueToSlugify }) =>
  typeof valueToSlugify === 'string'
    ? valueToSlugify
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
        .normalize('NFC')
        .replace(/[æðđłøœßþ]/g, (letter) => LATIN_LETTERS[letter]!)
        .replace(/ /g, '-')
        .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '')
    : undefined
