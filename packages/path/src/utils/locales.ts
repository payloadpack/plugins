import type { Payload, PayloadRequest } from 'payload'

export const NO_LOCALE = ''

export const inLocale = (locale: string) => (locale === NO_LOCALE ? {} : { locale })

export function getLocales(payload: Payload) {
  return payload.config.localization ? payload.config.localization.localeCodes : [NO_LOCALE]
}

export function getFallbackLocales(payload: Payload, locale: string) {
  const { localization } = payload.config
  if (!localization) {
    return [NO_LOCALE]
  }
  const configured = localization.locales.find(({ code }) => code === locale)?.fallbackLocale
  const fallbacks = configured ? [configured].flat() : localization.fallback === false ? [] : [localization.defaultLocale]
  // Every other locale comes last, so a locale without a slug of its own gets a path too.
  return [...new Set([locale, ...fallbacks, ...localization.localeCodes])]
}

export const valueInLocale = (stored: unknown, locale: string, localized: boolean) =>
  localized ? (stored as Record<string, unknown> | null | undefined)?.[locale] : stored

export const fieldKey = (fieldName: string, locale: string, localized: boolean) =>
  localized ? `${fieldName}.${locale}` : fieldName

// What a save holds of a field: of a localized one the value of the locale it is in, or a value per
// locale in a save of every locale at once, and of one that isn't localized the one value.
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
