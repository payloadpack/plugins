import type { Payload, PayloadRequest } from 'payload'

// The key paths are stored under without localization.
export const NO_LOCALE = ''

// What names a locale beside a path a site is given, which is nothing without localization.
export const inLocale = (locale: string) => (locale === NO_LOCALE ? {} : { locale })

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

/**
 * What a save holds of a field. Of a localized one it holds the value of the locale it is in, or a
 * value per locale when it is in every locale at once. Of one that isn't localized it holds the one
 * value, which is every locale's.
 */
export function getSaved(req: PayloadRequest, localized: boolean) {
  const perLocale = localized && req.locale === 'all'
  const savedLocales = localized && !perLocale ? [req.locale ?? NO_LOCALE] : getLocales(req.payload)
  return {
    // What the data holds of a value per locale.
    inData: <Value>(values: Record<string, Value>) => (perLocale ? values : values[savedLocales[0]!]),
    // A value of the data, in each locale the save holds it in.
    inLocales: (value: unknown): Record<string, unknown> =>
      perLocale ? { ...(value as object) } : Object.fromEntries(savedLocales.map((locale) => [locale, value])),
    savedLocales
  }
}
