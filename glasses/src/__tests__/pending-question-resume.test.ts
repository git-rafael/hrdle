// A picker closed without an answer is still a pending question.
//
// The next double-tap leaves the conversation. It must not turn that navigation
// gesture into "later / on PC", because doing so removes the relay item and
// leaves only the transcript's raw tool marker when the wearer returns.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GlassesController } from '../controller.ts'
import { screenText } from '../display.ts'
import type { GlassesPlatform } from '../controller.ts'
import type { GlassesRelayItem } from '../types.ts'

const realFetch = globalThis.fetch
let dismissRequests: string[]

beforeEach(() => {
  dismissRequests = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/dismiss')) dismissRequests.push(url)
    return new Response(JSON.stringify({ messages: [], hasMore: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

function platform(): GlassesPlatform {
  return {
    onDevice: false,
    render() {},
    renderHeader() {},
    requestExit() {},
    onForegroundRegained() {},
    async startMicCapture() { return true },
    async stopMicCapture() {},
    async transcribeAudio() { throw new Error('not used here') },
  } as unknown as GlassesPlatform
}

type Internals = {
  handle(action: 'tap' | 'doubleTap' | 'swipeUp' | 'swipeDown'): Promise<void>
  onRelayUpsert(item: GlassesRelayItem): void
}

const inner = (controller: GlassesController) => controller as unknown as Internals
const modeOf = (controller: GlassesController): string => controller.state.mode

function pendingQuestion(): GlassesRelayItem {
  return {
    id: 'pending-question',
    kind: 'waiting',
    source: 'auto',
    sessionId: 's1',
    paneId: '%0',
    text: 'Which delivery should we use?',
    context: 'The trial must stay reversible.',
    choices: ['Patch', 'Fork'],
    present: 'takeover',
    createdAt: 1,
  }
}

describe('a pending question after closing its picker', () => {
  test('can be reopened after leaving and returning to the session', async () => {
    const controller = new GlassesController(platform())
    controller.state.sessions = [
      { id: 's1', name: 'trial', state: 'working' },
    ] as GlassesController['state']['sessions']
    controller.state.mode = 'conversation'

    inner(controller).onRelayUpsert(pendingQuestion())
    await inner(controller).handle('tap')
    expect(modeOf(controller)).toBe('choice')

    await inner(controller).handle('doubleTap')
    expect(modeOf(controller)).toBe('conversation')
    expect(screenText(controller.state).footer).toContain('dbl:back')
    expect(screenText(controller.state).footer).not.toContain('dbl:later')

    await inner(controller).handle('doubleTap')
    expect(modeOf(controller)).toBe('session_list')
    expect(controller.state.relayWaiting.map((item) => item.id)).toEqual(['pending-question'])
    expect(dismissRequests).toEqual([])

    await inner(controller).handle('tap')
    expect(modeOf(controller)).toBe('conversation')
    await inner(controller).handle('tap')
    expect(modeOf(controller)).toBe('choice')
    expect(controller.state.choiceOptions).toEqual(['Patch', 'Fork'])
  })

  test('a residual foreground-resume double-tap cannot dismiss the restored card', async () => {
    const controller = new GlassesController(platform())
    controller.state.sessions = [
      { id: 's1', name: 'trial', state: 'working' },
    ] as GlassesController['state']['sessions']
    controller.state.mode = 'session_list'
    inner(controller).onRelayUpsert(pendingQuestion())
    expect(modeOf(controller)).toBe('overlay')

    const realNow = Date.now
    let now = 10_000
    Date.now = () => now
    try {
      controller.onForegroundExit()
      controller.swipeDown()
      await Promise.resolve()

      now += 2_000
      controller.doubleTap()
      await Promise.resolve()

      expect(modeOf(controller)).toBe('overlay')
      expect(controller.state.relayWaiting.map((item) => item.id)).toEqual(['pending-question'])
      expect(dismissRequests).toEqual([])

      now += 3_001
      controller.doubleTap()
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(dismissRequests).toHaveLength(1)
      expect(modeOf(controller)).toBe('session_list')

      inner(controller).onRelayUpsert({ ...pendingQuestion(), id: 'later-question' })
      now = 9_000
      controller.doubleTap()
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(dismissRequests).toHaveLength(2)
    } finally {
      Date.now = realNow
    }
  })
})
