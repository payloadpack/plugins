'use client'

import { Banner, Button, InfoIcon, toast, useConfig, useDocumentInfo, useLocale } from '@payloadcms/ui'
import { requests } from '@payloadcms/ui/shared'
import { formatAdminURL } from 'payload/shared'
import { useEffect, useState } from 'react'

import { STATUS_FIELD_NAME, type Status } from '../fields/status.js'
import { SUGGESTION_EDIT_BUTTON, SUGGESTION_NO_BUTTON, SUGGESTION_YES_BUTTON } from '../plugin/messages.js'
import type { SuggestionNotice } from '../plugin/suggestions-endpoint.js'

/** The Redirects collection's slug, and the path of its endpoint for the notices, below the API's route. */
export type SuggestionNoticesProps = { redirectsSlug: string; suggestionsPath: string }

type ErrorBody = { errors?: { message?: string }[] }

/**
 * Above the fields of a document a redirect can send visitors to, a notice for each suggestion to it.
 * Read again after every save, since the save that moves the document is what suggests one.
 */
export function SuggestionNotices({ redirectsSlug, suggestionsPath }: SuggestionNoticesProps) {
  // The edit view sets lastUpdateTime on every save.
  const { collectionSlug, id, lastUpdateTime } = useDocumentInfo()
  const {
    config: {
      routes: { admin, api },
      serverURL
    }
  } = useConfig()
  const locale = useLocale()?.code
  const [notices, setNotices] = useState<SuggestionNotice[]>([])
  const [isAnswering, setIsAnswering] = useState(false)

  useEffect(() => {
    if (id === undefined || !collectionSlug) return
    const controller = new AbortController()
    const url = formatAdminURL({
      apiRoute: api,
      path: `${suggestionsPath}/${encodeURIComponent(collectionSlug)}/${encodeURIComponent(id)}` as `/${string}`,
      serverURL
    })
    requests
      .get(url, { params: { locale }, signal: controller.signal })
      .then(async (response) => (response.ok ? ((await response.json()) as { notices: SuggestionNotice[] }).notices : []))
      .then(setNotices)
      .catch(() => undefined)
    return () => controller.abort()
  }, [api, collectionSlug, id, lastUpdateTime, locale, serverURL, suggestionsPath])

  // As the signed-in user, through the Redirects collection's own REST API, and only while the
  // redirect is still a suggestion, so a notice shown before someone else answered changes nothing.
  async function answer({ id: redirectId }: SuggestionNotice, yes: boolean) {
    setIsAnswering(true)
    try {
      const where = new URLSearchParams({
        'where[and][0][id][equals]': String(redirectId),
        [`where[and][1][${STATUS_FIELD_NAME}][equals]`]: 'suggested' satisfies Status
      })
      const response = await fetch(formatAdminURL({ apiRoute: api, path: `/${redirectsSlug}?${where}`, serverURL }), {
        body: yes ? JSON.stringify({ [STATUS_FIELD_NAME]: 'on' satisfies Status }) : undefined,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: yes ? 'PATCH' : 'DELETE'
      })
      if (!response.ok) {
        const { errors } = (await response.json().catch(() => ({}))) as ErrorBody
        toast.error(errors?.[0]?.message ?? response.statusText)
        return
      }
      setNotices((current) => current.filter((notice) => notice.id !== redirectId))
    } finally {
      setIsAnswering(false)
    }
  }

  if (notices.length === 0) return null
  return (
    // Spaced from the title below as Payload spaces one field from the next.
    <div style={{ display: 'grid', gap: 'var(--spacer-3)', marginBottom: 'var(--spacing-field)' }}>
      {notices.map((notice) => (
        // Named by its text, so its buttons are told apart from another notice's.
        <div aria-label={notice.text} key={notice.id} role="group">
          {/* Payload's banner is made for one line: it centres its icon on all it holds and sets its text
              bold. The notice centres the icon on its sentence, in regular text, with the buttons below. */}
          <Banner icon={null}>
            <div
              style={{
                alignItems: 'center',
                columnGap: 'var(--spacer-1)',
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                rowGap: 'var(--spacer-2)'
              }}>
              <InfoIcon />
              <p style={{ fontWeight: 'var(--text-body-medium-font-weight)', margin: 0 }}>{notice.text}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacer-2)', gridColumn: 2 }}>
                <Button buttonStyle="primary" disabled={isAnswering} margin={false} onClick={() => void answer(notice, true)}>
                  {SUGGESTION_YES_BUTTON}
                </Button>
                <Button
                  buttonStyle="secondary"
                  el="link"
                  margin={false}
                  to={formatAdminURL({
                    adminRoute: admin,
                    path: `/collections/${redirectsSlug}/${encodeURIComponent(notice.id)}`
                  })}>
                  {SUGGESTION_EDIT_BUTTON}
                </Button>
                <Button buttonStyle="secondary" disabled={isAnswering} margin={false} onClick={() => void answer(notice, false)}>
                  {SUGGESTION_NO_BUTTON}
                </Button>
              </div>
            </div>
          </Banner>
        </div>
      ))}
    </div>
  )
}
