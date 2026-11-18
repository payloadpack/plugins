import type { Payload } from 'payload'

// The key paths are stored under without localization.
export const NO_LOCALE = ''

export function getLocales(payload: Payload) {
  return payload.config.localization ? payload.config.localization.localeCodes : [NO_LOCALE]
}

/**
 * The locales a value in this locale is taken from, in order: its own, the one Payload falls back
 * to, then every other one. A path is made from the first slug among them, so a locale without a
 * slug of its own gets a path too.
 */
export function getFallbackLocales(payload: Payload, locale: string) {
  const { localization } = payload.config
  if (!localization) {
    return [NO_LOCALE]
  }
  const configured = localization.locales.find(({ code }) => code === locale)?.fallbackLocale
  const fallbacks = configured ? [configured].flat() : localization.fallback === false ? [] : [localization.defaultLocale]
  return [...new Set([locale, ...fallbacks, ...localization.localeCodes])]
}

// A stored value in one locale: a localized one holds every locale's, and one that isn't is the
// value itself, the same in every locale.
export const valueInLocale = (stored: unknown, locale: string, localized: boolean) =>
  localized ? (stored as Record<string, unknown> | null | undefined)?.[locale] : stored

// What a Payload where names a field's value in one locale by, which is the field alone when it isn't localized.
export const fieldKey = (fieldName: string, locale: string, localized: boolean) =>
  localized ? `${fieldName}.${locale}` : fieldName
