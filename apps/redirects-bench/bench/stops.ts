type HeldStop = {
  // What stops it at once, for an exit before the stop ran, such as after Ctrl-C.
  atExit?: () => void
  stop: () => Promise<unknown>
}

const pendingStops = new Set<HeldStop>()

/** Holds how to stop what was just started, and gives back a stop that runs once. */
export function holdStop(stop: () => Promise<unknown>, atExit?: () => void) {
  const heldStop = { atExit, stop }
  pendingStops.add(heldStop)
  return async () => {
    if (!pendingStops.delete(heldStop)) return
    await stop()
  }
}

// embedded-postgres stops its own server on these signals and then exits, maybe before these stops end,
// so what is still running then is stopped at exit.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    for (const heldStop of [...pendingStops].reverse()) {
      await heldStop.stop().catch(() => undefined)
      pendingStops.delete(heldStop)
    }
    process.exit(130)
  })
}
process.once('exit', () => {
  for (const { atExit } of [...pendingStops].reverse()) atExit?.()
})
