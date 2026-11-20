const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Smooth height + opacity animation for content <details> elements.
 * Wraps sibling nodes after <summary> automatically so plain Markdown <details> works unchanged.
 */
function enhanceDetails() {
  const detailsList = document.querySelectorAll<HTMLDetailsElement>('.sl-markdown-content details')

  for (const details of detailsList) {
    if (details.dataset.docsDetails === 'ready') continue
    if (details.closest('mobile-starlight-toc, starlight-menu-button')) continue

    const summary = details.querySelector<HTMLElement>(':scope > summary')
    if (!summary) continue

    details.dataset.docsDetails = 'ready'

    // Wrap everything after <summary> into an animatable body container.
    const body = document.createElement('div')
    body.className = 'docs-details-body'
    const inner = document.createElement('div')
    inner.className = 'docs-details-inner'

    const contentNodes: ChildNode[] = []
    let node = summary.nextSibling
    while (node) {
      contentNodes.push(node)
      node = node.nextSibling
    }
    for (const child of contentNodes) inner.appendChild(child)
    body.appendChild(inner)
    details.appendChild(body)

    let animation: Animation | null = null
    let isClosing = false
    let isExpanding = false

    const finish = (open: boolean) => {
      details.open = open
      animation = null
      isClosing = false
      isExpanding = false
      body.style.height = ''
      body.style.overflow = ''
    }

    const open = () => {
      isExpanding = true
      isClosing = false
      if (animation) animation.cancel()

      const startHeight = details.open ? body.offsetHeight : 0
      details.open = true
      const endHeight = inner.getBoundingClientRect().height
      body.style.overflow = 'hidden'

      animation = body.animate(
        [
          { height: `${startHeight}px`, opacity: startHeight > 0 ? 1 : 0 },
          { height: `${endHeight}px`, opacity: 1 }
        ],
        { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      )
      animation.onfinish = () => finish(true)
      animation.oncancel = () => {
        isExpanding = false
      }
    }

    const close = () => {
      isClosing = true
      isExpanding = false
      if (animation) animation.cancel()

      const startHeight = body.offsetHeight
      body.style.overflow = 'hidden'

      animation = body.animate(
        [
          { height: `${startHeight}px`, opacity: 1 },
          { height: '0px', opacity: 0 }
        ],
        { duration: 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      )
      animation.onfinish = () => finish(false)
      animation.oncancel = () => {
        isClosing = false
      }
    }

    summary.addEventListener('click', (event) => {
      if (prefersReducedMotion()) return
      event.preventDefault()
      if (isClosing || !details.open) open()
      else if (isExpanding || details.open) close()
    })
  }
}

/**
 * Sliding solid package-accent indicator on the desktop right-hand Table of Contents rail.
 */
function enhanceTocRail() {
  const toc = document.querySelector<HTMLElement>('starlight-toc')
  const list = toc?.querySelector<HTMLUListElement>('nav > ul')
  if (!toc || !list || list.dataset.docsTocRail === 'ready') return

  list.dataset.docsTocRail = 'ready'

  const indicator = document.createElement('span')
  indicator.className = 'docs-toc-indicator'
  indicator.setAttribute('aria-hidden', 'true')
  list.appendChild(indicator)

  let hasMovedOnce = false

  const sync = () => {
    const active = list.querySelector<HTMLAnchorElement>('a[aria-current="true"]')
    if (!active || active.getAttribute('href') === '#_top' || active.offsetHeight === 0) {
      indicator.style.opacity = '0'
      return
    }

    const listRect = list.getBoundingClientRect()
    const linkRect = active.getBoundingClientRect()
    const top = linkRect.top - listRect.top + 4
    const height = Math.max(16, linkRect.height - 8)

    if (!hasMovedOnce) {
      indicator.style.transition = 'none'
      indicator.style.transform = `translateY(${top}px)`
      indicator.style.height = `${height}px`
      indicator.style.opacity = '1'
      // Force layout before re-enabling transitions so initial placement never slides in from 0.
      void indicator.offsetHeight
      indicator.style.transition = ''
      hasMovedOnce = true
      return
    }

    indicator.style.opacity = '1'
    indicator.style.transform = `translateY(${top}px)`
    indicator.style.height = `${height}px`
  }

  const observer = new MutationObserver(sync)
  observer.observe(list, { attributes: true, attributeFilter: ['aria-current'], subtree: true })
  window.addEventListener('resize', sync, { passive: true })
  requestAnimationFrame(sync)
}

/**
 * Sliding active pill indicator for Starlight <Tabs>.
 */
function enhanceTabs() {
  const tabGroups = document.querySelectorAll<HTMLElement>('starlight-tabs')

  for (const group of tabGroups) {
    const tablist = group.querySelector<HTMLUListElement>('[role="tablist"]')
    if (!tablist || tablist.dataset.docsTabs === 'ready') continue

    tablist.dataset.docsTabs = 'ready'

    const indicator = document.createElement('span')
    indicator.className = 'docs-tab-indicator'
    indicator.setAttribute('aria-hidden', 'true')
    tablist.prepend(indicator)

    let hasPlaced = false

    const sync = () => {
      const active = tablist.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      if (!active || active.offsetWidth === 0) {
        indicator.style.opacity = '0'
        return
      }

      const tablistRect = tablist.getBoundingClientRect()
      const activeRect = active.getBoundingClientRect()
      const left = activeRect.left - tablistRect.left + tablist.scrollLeft
      const width = activeRect.width

      if (!hasPlaced) {
        indicator.style.transition = 'none'
        indicator.style.transform = `translateX(${left}px)`
        indicator.style.width = `${width}px`
        indicator.style.opacity = '1'
        void indicator.offsetWidth
        indicator.style.transition = ''
        hasPlaced = true
        return
      }

      indicator.style.opacity = '1'
      indicator.style.transform = `translateX(${left}px)`
      indicator.style.width = `${width}px`
    }

    const observer = new MutationObserver(sync)
    observer.observe(tablist, { attributes: true, attributeFilter: ['aria-selected'], subtree: true })
    window.addEventListener('resize', sync, { passive: true })
    requestAnimationFrame(sync)
  }
}

/**
 * Click-to-copy confirmation pill on Starlight heading anchor links.
 */
function enhanceHeadingAnchors() {
  const anchors = document.querySelectorAll<HTMLAnchorElement>('.sl-markdown-content .sl-anchor-link')
  const timers = new WeakMap<HTMLAnchorElement, number>()

  for (const anchor of anchors) {
    if (anchor.dataset.docsAnchor === 'ready') continue
    anchor.dataset.docsAnchor = 'ready'

    anchor.addEventListener('click', () => {
      const href = anchor.getAttribute('href')
      if (!href) return
      const url = new URL(href, window.location.href).href
      void navigator.clipboard?.writeText(url).catch(() => {})

      anchor.dataset.copied = 'true'
      const prev = timers.get(anchor)
      if (prev) window.clearTimeout(prev)
      timers.set(
        anchor,
        window.setTimeout(() => {
          delete anchor.dataset.copied
        }, 1400)
      )
    })
  }
}

function initDocsPolish() {
  enhanceDetails()
  enhanceTocRail()
  enhanceTabs()
  enhanceHeadingAnchors()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDocsPolish, { once: true })
} else {
  initDocsPolish()
}
