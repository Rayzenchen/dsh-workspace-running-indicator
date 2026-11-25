#!/usr/bin/env node
/**
 * Behaviour tests for the client half, run in jsdom.
 *
 * The plugin's facts come from Client services and its ring lands in the
 * Workspace browser's own DOM, so a plain syntax check cannot tell whether the
 * indicator appears, moves and disappears where it should. This harness loads
 * the real `client.js` into a jsdom page, feeds it fake Client services, builds
 * the sidebar rows the shipped browser renders, and asserts the resulting DOM.
 *
 * Usage: node tools/test-client.mjs
 */
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const CELL = '[data-dsh-wri]'
const LOADER_ID = '@local/dsh-workspace-running-indicator'

const results = []

/** Run one named case; a throw fails the case instead of the whole run. */
async function test(name, body) {
  try {
    await body()
    results.push({ name, ok: true })
    console.log(`ok    ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error })
    console.log(`FAIL  ${name}\n      ${error.message}`)
  }
}

/** Assert one fact. */
function expect(condition, message) {
  if (!condition) throw new Error(message)
}

/* ------------------------------------------------------------------ *
 * Fakes for the Client services the plugin reads
 * ------------------------------------------------------------------ */

/** Observable over a mutable value, without `this` games. */
function makeSource(initial) {
  const listeners = new Set()
  let value = initial
  return {
    source: {
      getSnapshot: () => value,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    set(next) {
      value = next
      for (const listener of listeners) listener()
    },
  }
}

/** Fake locale service: dictionaries per namespace, one active language. */
function createLocale(language = 'zh') {
  const dictionaries = new Map()
  const listeners = new Set()
  let current = language
  return {
    register(namespace, dicts) {
      dictionaries.set(namespace, dicts)
      return () => { dictionaries.delete(namespace) }
    },
    bind(namespace) {
      return (key) => {
        const dicts = dictionaries.get(namespace) ?? {}
        return dicts[current]?.[key] ?? dicts.en?.[key] ?? key
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setLanguage(next) {
      current = next
      for (const listener of listeners) listener()
    },
  }
}

/** Fake Cordis context: `effect` runs its body and keeps the disposer. */
function createContext({ statuses, sessions, workspaces, locale }) {
  const disposers = []
  const ctx = {
    effect(body) {
      const dispose = body()
      if (typeof dispose === 'function') disposers.push(dispose)
      return () => {}
    },
    get(name) {
      return name === 'locale' ? locale : undefined
    },
    uiSession: { sessionStatus: statuses.source },
    sessions: { list: sessions.source },
    workspaces: { list: workspaces.source },
  }
  return {
    ctx,
    dispose() {
      while (disposers.length > 0) disposers.pop()()
    },
  }
}

/* ------------------------------------------------------------------ *
 * A sidebar shaped like the shipped Workspace browser's markup
 * ------------------------------------------------------------------ */

/** One Workspace header row: folder cell, chevron cell, name cell, actions. */
function buildWorkspaceRow(document, { workspaceId, expanded, label }) {
  const row = document.createElement('div')
  row.className = 'JoiKIa_projectRow'
  row.setAttribute('role', 'treeitem')
  row.setAttribute('data-row-key', `workspace:${workspaceId}`)
  row.setAttribute('aria-expanded', String(expanded))
  const folder = document.createElement('span')
  folder.className = 'JoiKIa_slot JoiKIa_folder'
  folder.appendChild(document.createElement('svg'))
  const chevron = document.createElement('span')
  chevron.className = 'JoiKIa_slot JoiKIa_chevron'
  const text = document.createElement('span')
  text.className = 'JoiKIa_projectText'
  const title = document.createElement('span')
  title.className = 'JoiKIa_title'
  title.textContent = label
  text.appendChild(title)
  const actions = document.createElement('span')
  actions.className = 'JoiKIa_rowActions'
  row.append(folder, chevron, text, actions)
  return row
}

/** Mount the browsing region with the given rows. */
function mountSidebar(document, rows) {
  const region = document.createElement('div')
  region.setAttribute('data-slot', 'sidebar.workspaces')
  const listArea = document.createElement('div')
  listArea.setAttribute('data-sidebar-list-area', '')
  const tree = document.createElement('div')
  tree.setAttribute('role', 'tree')
  for (const row of rows) tree.appendChild(row)
  listArea.appendChild(tree)
  region.appendChild(listArea)
  document.body.appendChild(region)
  return { region, listArea, tree }
}

/* ------------------------------------------------------------------ *
 * Harness: one page, the real client.js, a mounted sidebar
 * ------------------------------------------------------------------ */

/**
 * Build one test page.
 * @param options.statuses - initial `uiSession.sessionStatus` map.
 * @param options.sessions - initial Session list snapshot.
 * @param options.workspaces - initial Workspace snapshot.
 * @param options.rows - sidebar rows to mount.
 * @param options.language - initial page language.
 */
function createPage({
  statuses = new Map(),
  sessions = { ids: [], byId: {}, phase: 'ready', projectionsBySession: {} },
  workspaces = { items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'ready', phase: 'ready' },
  rows = [],
  language = 'zh',
} = {}) {
  const dom = new JSDOM(`<!doctype html><html lang="${language}"><head></head><body></body></html>`, {
    /* `outside-only` gives `window.eval`, which is how the real client module
       is loaded into the page; it does not execute page scripts of its own. */
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  const { window } = dom
  const statusSource = makeSource(statuses)
  const sessionSource = makeSource(sessions)
  const workspaceSource = makeSource(workspaces)
  const locale = createLocale(language)

  let entry
  window.__ModuleLoader__ = { load: (loaded) => { entry = loaded } }
  window.eval(source)
  const plugin = entry.factory()
  const { ctx, dispose } = createContext({
    statuses: statusSource,
    sessions: sessionSource,
    workspaces: workspaceSource,
    locale,
  })
  plugin.apply(ctx)

  const { region, listArea } = mountSidebar(window.document, rows)
  /* The plugin reconciles on its own subscriptions and on DOM mutations; a
     first status notification after the rows exist drives the initial pass. */
  statusSource.set(statuses)

  return {
    window,
    document: window.document,
    region,
    listArea,
    locale,
    plugin,
    dispose,
    setStatuses(next) { statusSource.set(next) },
    setSessions(next) { sessionSource.set(next) },
    setWorkspaces(next) { workspaceSource.set(next) },
    /** Let queued animation frames and MutationObserver callbacks run. */
    async flush() {
      for (let pass = 0; pass < 3; pass++) {
        await new Promise(resolve => window.requestAnimationFrame(() => resolve()))
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    },
    cellOf(row) { return row.querySelector(`:scope > ${CELL}`) },
    labelOf(row) { return row.querySelector('.dsh-wri-label')?.textContent },
  }
}

/* ------------------------------------------------------------------ *
 * Cases
 * ------------------------------------------------------------------ */

const running = (ids) => new Map(ids.map(id => [id, { running: true, pendingInteraction: undefined, completionUnread: false }]))
const idle = (ids) => new Map(ids.map(id => [id, { running: false, pendingInteraction: undefined, completionUnread: false }]))
const listOf = (byId, projectionsBySession = {}) => ({
  ids: Object.keys(byId),
  byId,
  phase: 'ready',
  projectionsBySession,
})
const workspaceOf = (items, archivedSessionIds = []) => ({
  items,
  archivedSessionIds,
  pinnedSessionIds: [],
  state: 'ready',
  phase: 'ready',
})
const header = (workspaceId, expanded, label = workspaceId) => ({ workspaceId, expanded, label })

await test('ring appears on a folded Workspace whose Session runs', async () => {
  const row = buildWorkspaceRow(new JSDOM().window.document, header('w1', false, 'Alpha'))
  const page = createPage({
    rows: [row],
    statuses: running(['s1']),
    sessions: listOf({ s1: { id: 's1', running: true } }),
    workspaces: workspaceOf([{ workspaceId: 'w1', sessionIds: ['s1'] }]),
  })
  await page.flush()
  const cell = page.cellOf(row)
  expect(cell !== null, 'no ring cell was inserted')
  expect(cell.previousElementSibling?.className.includes('chevron'), 'the ring is not right of the leading cell')
  expect(cell.nextElementSibling?.className.includes('projectText'), 'the ring is not before the name cell')
  expect(cell.querySelector('svg')?.getAttribute('width') === '14', 'the ring is not the shipped 14px size')
  expect(page.labelOf(row) === '进行中', `unexpected status word: ${page.labelOf(row)}`)
})

await test('no ring while the Workspace is expanded', async () => {
  const row = buildWorkspaceRow(new JSDOM().window.document, header('w1', true, 'Alpha'))
  const page = createPage({
    rows: [row],
    statuses: running(['s1']),
    sessions: listOf({ s1: { id: 's1', running: true } }),
    workspaces: workspaceOf([{ workspaceId: 'w1', sessionIds: ['s1'] }]),
  })
  await page.flush()
  expect(page.cellOf(row) === null, 'a ring was drawn on an expanded Workspace')
})

await test('no ring while nothing runs', async () => {
  const row = buildWorkspaceRow(new JSDOM().window.document, header('w1', false, 'Alpha'))
  const page = createPage({
    rows: [row],
    statuses: idle(['s1']),
    sessions: listOf({ s1: { id: 's1', running: false } }),
    workspaces: workspaceOf([{ workspaceId: 'w1', sessionIds: ['s1'] }]),
  })
  await page.flush()
  expect(page.cellOf(row) === null, 'a ring was drawn for an idle Workspace')
})

await test('the ring leaves when the Session stops', async () => {
  const row = buildWorkspaceRow(new JSDOM().window.document, header('w1', false, 'Alpha'))
  const page = createPage({
    rows: [row],
    statuses: running(['s1']),
    sessions: listOf({ s1: { id: 's1', running: true } }),
    workspaces: workspaceOf([{ workspaceId: 'w1', sessionIds: ['s1'] }]),
  })
  await page.flush()
  expect(page.cellOf(row) !== null, 'the ring never appeared')
  page.setStatuses(idle(['s1']))
  page.setSessions(listOf({ s1: { id: 's1', running: false } }))
  await page.flush()
  expect(page.cellOf(row) === null, 'the ring stayed after the Session stopped')
})

await test('a running subagent alone also marks the folded Workspace', async () => {
  const row = buildWorkspaceRow(new JSDOM().window.document, header('w1', false, 'Alpha'))
  const page = createPage({
    rows: [row],
    statuses: new Map([
      ['parent', { running: false, pendingInteraction: undefined, completionUnread: false }],
      ['child', { running: true, pendingInteraction: undefined, completionUnread: false }],
    ]),
    sessions: listOf(
      { parent: { id: 'parent', running: false }, child: { id: 'child', running: true } },
      { parent: { values: { subagentCatalog: [{ id: 'child' }] } } },
    ),
    workspaces: workspaceOf([{ workspaceId: 'w1', sessionIds: ['parent'] }]),
  })
  await page.flush()
  expect(page.cellOf(row) !== null, 'the subagent-only state was not marked')
})

await test('an archived Session never marks its Workspace', async () => {
  const row = buildWorkspaceRow(new JSDOM().window.document, header('w1', false, 'Alpha'))
  const page = createPage({
    rows: [row],
    statuses: running(['s1']),
    sessions: listOf({ s1: { id: 's1', running: true } }),
    workspaces: workspaceOf([{ workspaceId: 'w1', sessionIds: ['s1'] }], ['s1']),
  })
  await page.flush()
  expect(page.cellOf(row) === null, 'an archived Session marked the Workspace')
})

await test('the Ungrouped bucket is never marked', async () => {
  const row = buildWorkspaceRow(new JSDOM().window.document, header('', false, 'Ungrouped'))
  const page = createPage({
    rows: [row],
    statuses: running(['s1']),
    sessions: listOf({ s1: { id: 's1', running: true } }),
    workspaces: workspaceOf([{ workspaceId: 'w1', sessionIds: ['s1'] }]),
  })
  await page.flush()
  expect(page.cellOf(row) === null, 'the Ungrouped row was marked')
})

await test('the status word follows a locale switch', async () => {
  const row = buildWorkspaceRow(new JSDOM().window.document, header('w1', false, 'Alpha'))
  const page = createPage({
    rows: [row],
    statuses: running(['s1']),
    sessions: listOf({ s1: { id: 's1', running: true } }),
    workspaces: workspaceOf([{ workspaceId: 'w1', sessionIds: ['s1'] }]),
  })
  await page.flush()
  expect(page.labelOf(row) === '进行中', `unexpected initial word: ${page.labelOf(row)}`)
  page.locale.setLanguage('en')
  await page.flush()
  expect(page.labelOf(row) === 'Running', `the word did not follow the locale: ${page.labelOf(row)}`)
})

await test('a re-rendered Workspace row gets its ring back', async () => {
  const document = new JSDOM().window.document
  const first = buildWorkspaceRow(document, header('w1', false, 'Alpha'))
  const page = createPage({
    rows: [first],
    statuses: running(['s1']),
    sessions: listOf({ s1: { id: 's1', running: true } }),
    workspaces: workspaceOf([{ workspaceId: 'w1', sessionIds: ['s1'] }]),
  })
  await page.flush()
  expect(page.cellOf(first) !== null, 'the ring never appeared')
  /* React replaces the row's children on a re-render: drop them all. */
  const replacement = buildWorkspaceRow(page.document, header('w1', false, 'Alpha'))
  first.replaceWith(replacement)
  await page.flush()
  expect(page.cellOf(replacement) !== null, 'a re-rendered row lost its ring')
})

await test('the list-area anchor works when the Slot anchor is gone', async () => {
  const document = new JSDOM().window.document
  const row = buildWorkspaceRow(document, header('w1', false, 'Alpha'))
  const page = createPage({
    rows: [row],
    statuses: idle(['s1']),
    sessions: listOf({ s1: { id: 's1', running: false } }),
    workspaces: workspaceOf([{ workspaceId: 'w1', sessionIds: ['s1'] }]),
  })
  await page.flush()
  page.region.removeAttribute('data-slot')
  page.setStatuses(running(['s1']))
  page.setSessions(listOf({ s1: { id: 's1', running: true } }))
  await page.flush()
  expect(page.cellOf(row) !== null, 'the fallback list-area anchor did not place the ring')
})

await test('unloading removes every inserted node and its stylesheet', async () => {
  const row = buildWorkspaceRow(new JSDOM().window.document, header('w1', false, 'Alpha'))
  const page = createPage({
    rows: [row],
    statuses: running(['s1']),
    sessions: listOf({ s1: { id: 's1', running: true } }),
    workspaces: workspaceOf([{ workspaceId: 'w1', sessionIds: ['s1'] }]),
  })
  await page.flush()
  expect(page.cellOf(row) !== null, 'the ring never appeared')
  page.dispose()
  await page.flush()
  expect(page.document.querySelector(CELL) === null, 'a ring survived unload')
  expect(page.document.querySelector('#dsh-wri-style') === null, 'the stylesheet survived unload')
})

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

const failed = results.filter(result => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} cases passed`)
if (failed.length > 0) process.exit(1)
