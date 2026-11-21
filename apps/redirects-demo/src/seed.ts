import type { Payload, RequiredDataFromCollectionSlug } from 'payload'

export const DEMO_USER = { email: 'demo@payloadpack.com', password: 'demo' }

// Seeds an empty database, so every run starts from the same place.
export async function seed(payload: Payload) {
  const { totalDocs } = await payload.count({ collection: 'users', overrideAccess: true })
  if (totalDocs > 0) return
  await payload.create({ collection: 'users', data: DEMO_USER, overrideAccess: true })

  const publishPage = (data: { parent?: string; slug: string; title: string }) =>
    payload.create({ collection: 'pages', data: { _status: 'published', ...data }, overrideAccess: true })
  const createRedirect = (data: RequiredDataFromCollectionSlug<'redirects'>) =>
    payload.create({ collection: 'redirects', data, overrideAccess: true })
  await publishPage({ slug: 'home', title: 'Home' })
  const contact = await publishPage({ slug: 'contact', title: 'Contact' })
  // The company page moves from /about-us to /company with the team page below it, which suggests a
  // redirect from /about-us and every path below it, left for an editor to say yes or no to.
  const company = await publishPage({ slug: 'about-us', title: 'Company' })
  await publishPage({ parent: company.id, slug: 'team', title: 'Team' })
  await payload.update({
    collection: 'pages',
    data: { _status: 'published', slug: 'company' },
    id: company.id,
    overrideAccess: true
  })
  const openingHours = await payload.create({
    collection: 'news',
    data: { _status: 'published', slug: 'opening-hours', title: 'Opening hours' },
    overrideAccess: true
  })

  // The redirects an editor adds. /Opening-Times is typed in mixed case, which any case of it
  // answers.
  const toContact = { document: { relationTo: 'pages', value: contact.id }, type: 'document' } as const
  const toOpeningHours = { document: { relationTo: 'news', value: openingHours.id }, type: 'document' } as const
  await createRedirect({ from: '/kontakt', match: 'exact', status: 'on', to: toContact, type: 'permanent' })
  await createRedirect({
    from: '/campaign',
    match: 'exact',
    status: 'on',
    to: { type: 'url', url: 'https://example.com/campaign' },
    type: 'temporary'
  })
  await createRedirect({
    from: '/blog/(\\d{4})/(\\d{2})/(.*)',
    match: 'regex',
    status: 'on',
    to: { type: 'url', url: '/news/$3' },
    type: 'permanent'
  })
  await createRedirect({ from: '/Opening-Times', match: 'exact', status: 'on', to: toOpeningHours, type: 'permanent' })
  await createRedirect({ from: '/news.aspx?id=1', match: 'exact', status: 'on', to: toOpeningHours, type: 'permanent' })
}
