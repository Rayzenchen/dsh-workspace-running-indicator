/**
 * Client half of `@local/dsh-workspace-running-indicator` (1.0.0).
 *
 * What it does
 * ------------
 * A folded Workspace hides its Session rows, and with them the shipped
 * "ongoing" spinner that tells you a Session is still running. While a folded
 * Workspace holds work in progress, this half draws that same spinner in the
 * Workspace header row, right of the folder/chevron cell and before the
 * Workspace name. Expanding the group removes it again, so the indicator
 * appears only next to the running Session rows (the shipped behaviour).
 *
 * "Work in progress" is the same fact the Session row's own ring shows:
 * a Session whose latest known activity is running, or which still has a
 * running subagent. The status map is read from `uiSession.sessionStatus`
 * (the nested Cordis service the rows use) with the Session list snapshot as
 * the same pre-baseline fallback, `sessions.list` for the subagent catalogs,
 * and `workspaces.list` for Workspace membership and the archived set.
 *
 * Where the ring goes
 * -------------------
 * Nothing about the *facts* is read from the DOM. Only the placement uses the
 * Workspace browser's DOM: the sidebar declares no decoration seat for a
 * Workspace row, so this half anchors on the row the browser renders itself —
 * `data-row-key="workspace:<id>"`, the row's `aria-expanded` fold fact, and the
 * `projectText` cell that holds the name.
 *
 * Two documented seams are tried for the browsing region, in order: the Slot
 * outlet's `[data-slot="sidebar.workspaces"]` anchor, then the list area's
 * `[data-sidebar-list-area]` attribute. Both belong to the browser's own
 * markup, so a change in one does not blind the indicator while the other
 * still exists; if neither is present while Workspace rows are, one console
 * warning names the plugin as out of date instead of failing silently.
 *
 * Visual parity
 * -------------
 * No Harness Client package is imported. The spinner markup (SVG 14px, two
 * r=9.5 circles), its colour token (`--dsw-alias-label-tertiary`) and its
 * keyframes are copied from the shipped primitives' `StateDot` in the
 * `ongoing` state, so the Workspace row shows the very same ring the Session
 * row shows, including the animation phase of every other shipped spinner.
 * Like the Session row, the ring itself is decorative (`aria-hidden`) but the
 * cell carries a visually hidden localized status word, so the row's
 * accessible name reports that work is running. The word follows the shipped
 * `status.running` copy of all eight shipped locales and a locale switch.
 *
 * The DOM writes are owned by this half: the style element, the inserted cell,
 * the observer, the locale dictionary and the subscriptions are all created in
 * `ctx.effect` and removed when the plugin unloads. The inserted cell is
 * re-inserted whenever React replaces the row, and removed as soon as the group
 * is expanded or no work inside it is running.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-workspace-running-indicator',
  factory() {
    /**
     * Browsing-region seams, most specific first. Both are the Workspace
     * browser's own markup: the Slot outlet anchor, then the list area.
     */
    const REGION_SELECTORS = ['[data-slot="sidebar.workspaces"]', '[data-sidebar-list-area]']
    const ROW_SELECTOR = '[data-row-key^="workspace:"]'
    const ROW_KEY_PREFIX = 'workspace:'
    const ROW_VALUE_ATTRIBUTE = 'data-row-key'
    const FOLD_ATTRIBUTE = 'aria-expanded'
    const CELL_ATTRIBUTE = 'data-dsh-wri'
    const CELL_CLASS = 'dsh-wri-cell'
    const LABEL_CLASS = 'dsh-wri-label'
    const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
    const STYLE_ID = 'dsh-wri-style'
    const LOCALE_NAMESPACE = 'workspace-running-indicator'
    /** One warning per page when no documented region seam is left. */
    let seamWarned = false
    /** Shipped StateDot uses 14px for the `ongoing` ring (10px otherwise). */
    const SPINNER_SIZE = 14
    /** The cell mirrors the Session row's 16px leading slot (`Rows.module.css` `.slot`). */
    const CELL_WIDTH = 16
    const CELL_HEIGHT = 20

    /**
     * Status word per shipped locale, copied from the Workspace browser's
     * `status.running` copy so a screen reader hears exactly what a Session
     * row says. Keys are the language subtags DSH ships.
     */
    const DICTIONARIES = {
      zh: { running: '进行中' },
      en: { running: 'Running' },
      ja: { running: '実行中' },
      es: { running: 'corriendo' },
      fr: { running: 'Courir' },
      de: { running: 'Laufen' },
      ru: { running: 'Бег' },
      pt: { running: 'Correndo' },
    }

    const CSS = `
.dsh-wri-cell {
  flex: none;
  width: ${CELL_WIDTH}px;
  height: ${CELL_HEIGHT}px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-wri-spinner {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-wri-label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.dsh-wri-motion {
  transform-origin: center;
  animation: dsh-wri-spin 1.5s linear infinite;
}
.dsh-wri-track,
.dsh-wri-arc {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
.dsh-wri-track { opacity: 0.25; }
.dsh-wri-arc {
  stroke-dasharray: 12 150;
  animation: dsh-wri-dash 1.5s ease-in-out infinite;
}
@keyframes dsh-wri-spin { to { transform: rotate(360deg); } }
@keyframes dsh-wri-dash {
  0% { stroke-dasharray: 12 150; stroke-dashoffset: 0; }
  50% { stroke-dasharray: 24 150; stroke-dashoffset: -6; }
  to { stroke-dasharray: 12 150; stroke-dashoffset: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-wri-motion, .dsh-wri-arc { animation: none; }
  .dsh-wri-arc { stroke-dasharray: 18 150; stroke-dashoffset: -3; }
}
`

    /* ------------------------------------------------------------------ *
     * Localized status word
     * ------------------------------------------------------------------ */

    /** Language subtag of the page (`zh-CN` -> `zh`), lower-cased. */
    function pageLanguage() {
      const raw = document.documentElement.getAttribute('lang') || navigator.language || 'en'
      return raw.toLowerCase().split(/[-_]/)[0]
    }

    /**
     * The static fallback when the locale service is unavailable, chosen from
     * the page language exactly once per call. A language DSH does not ship
     * keeps English, like the shipped copy does.
     * @returns the status word for the active language.
     */
    function fallbackLabel() {
      return (DICTIONARIES[pageLanguage()] ?? DICTIONARIES.en).running
    }

    /**
     * Register this half's dictionaries with the Client locale service and
     * bind its translator; degrade to the page-language table when the service
     * is absent, so the decoration never depends on it.
     * @param ctx - Client Context.
     * @returns a function returning the current status word.
     */
    function labelTranslator(ctx) {
      const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
      if (locale === undefined || typeof locale.register !== 'function') return fallbackLabel
      ctx.effect(() => locale.register(LOCALE_NAMESPACE, DICTIONARIES), 'workspace-running-indicator: dictionaries')
      if (typeof locale.bind !== 'function') return fallbackLabel
      const bound = locale.bind(LOCALE_NAMESPACE)
      return () => {
        try {
          return bound('running')
        } catch {
          return fallbackLabel()
        }
      }
    }

    /* ------------------------------------------------------------------ *
     * Data: which Workspaces hold work in progress
     * ------------------------------------------------------------------ */

    /**
     * Read a Client observable snapshot without letting a transient service
     * fault (a page reloading its Remote) break the decoration.
     * @param read - snapshot reader.
     * @returns the snapshot, or undefined when it cannot be read.
     */
    function safeSnapshot(read) {
      try {
        return read()
      } catch (error) {
        console.warn('workspace-running-indicator: reading Client state failed:', error)
        return undefined
      }
    }

    /**
     * Whether one Session is running, using the Session rows' own rule: the
     * status snapshot first, then the list summary's `running` while a status
     * is not established yet.
     * @param statuses - current `uiSession.sessionStatus` snapshot, if readable.
     * @param list - current Session list snapshot, if readable.
     * @param sessionId - Session to inspect.
     * @returns true while that Session's own row would show the ring.
     */
    function sessionRunning(statuses, list, sessionId) {
      if (statuses !== undefined && statuses !== null && typeof statuses.get === 'function') {
        const status = statuses.get(sessionId)
        if (status !== undefined && status !== null && status.running !== undefined) return status.running === true
      }
      const summary = list === undefined || list === null || list.byId === undefined ? undefined : list.byId[sessionId]
      return summary !== undefined && summary !== null && summary.running === true
    }

    /**
     * Whether one Session still has a running direct child (a subagent). The
     * shipped row shows the same ring for that case, so the folded group must
     * not hide it.
     * @param list - current Session list snapshot, if readable.
     * @param statuses - current status snapshot, if readable.
     * @param sessionId - parent Session to inspect.
     * @returns true while a subagent of that Session is running.
     */
    function childRunning(statuses, list, sessionId) {
      const catalog = list === undefined || list === null || list.projectionsBySession === undefined
        ? undefined
        : list.projectionsBySession[sessionId]?.values?.subagentCatalog
      if (!Array.isArray(catalog)) return false
      return catalog.some((child) => child !== null
        && typeof child === 'object'
        && typeof child.id === 'string'
        && sessionRunning(statuses, list, child.id))
    }

    /**
     * Map Workspace ids that currently hold work in progress.
     *
     * Archived Sessions are excluded because they have no visible row in the
     * group: expanding the group must never show a hole where the indicator
     * was.
     * @param ctx - Client Context carrying `uiSession`, `sessions` and `workspaces`.
     * @returns Workspace id -> true for every Workspace that should show the ring.
     */
    function runningWorkspaces(ctx) {
      const result = new Map()
      const statuses = safeSnapshot(() => ctx.uiSession.sessionStatus.getSnapshot())
      const list = safeSnapshot(() => ctx.sessions.list.getSnapshot())
      const workspaces = safeSnapshot(() => ctx.workspaces.list.getSnapshot())
      if (workspaces === undefined || workspaces === null || !Array.isArray(workspaces.items)) return result
      const archived = new Set(Array.isArray(workspaces.archivedSessionIds) ? workspaces.archivedSessionIds.map(String) : [])
      for (const workspace of workspaces.items) {
        if (workspace === null || typeof workspace !== 'object') continue
        const workspaceId = workspace.workspaceId
        if (typeof workspaceId !== 'string' || workspaceId === '') continue
        const sessionIds = workspace.sessionIds
        if (!Array.isArray(sessionIds)) continue
        const active = sessionIds.some((sessionId) => {
          const key = String(sessionId)
          if (archived.has(key)) return false
          return sessionRunning(statuses, list, key) || childRunning(statuses, list, key)
        })
        if (active) result.set(workspaceId, true)
      }
      return result
    }

    /* ------------------------------------------------------------------ *
     * The shipped spinner
     * ------------------------------------------------------------------ */

    /**
     * Keep this ring in phase with every other shipped spinner: they all reset
     * their CSS animations to timeline zero (the primitives' `StateDot` ref
     * does the same), so a newly inserted ring does not start mid-cycle.
     * @param element - the spinner's root element.
     */
    function syncAnimations(element) {
      if (element === null || element === undefined) return
      let animations
      try {
        animations = typeof element.getAnimations === 'function'
          ? element.getAnimations({ subtree: true })
          : []
      } catch {
        animations = []
      }
      for (const animation of animations) {
        try {
          animation.startTime = 0
        } catch {
          /* a not-yet-ready animation is synchronized by its animationstart instead */
        }
      }
    }

    /**
     * Build one spinner: the shipped `StateDot` `ongoing` markup, the shipped
     * geometry and the shipped order of track then arc, plus the visually
     * hidden status word the shipped row pairs with it.
     * @param label - localized status word for the accessible name.
     * @returns the 16px cell holding the 14px ring.
     */
    function buildCell(label) {
      const cell = document.createElement('span')
      cell.className = CELL_CLASS
      cell.setAttribute(CELL_ATTRIBUTE, '')
      const svg = document.createElementNS(SVG_NAMESPACE, 'svg')
      svg.setAttribute('class', 'dsh-wri-spinner')
      svg.setAttribute('data-state', 'ongoing')
      svg.setAttribute('width', String(SPINNER_SIZE))
      svg.setAttribute('height', String(SPINNER_SIZE))
      svg.setAttribute('viewBox', '0 0 24 24')
      svg.setAttribute('aria-hidden', 'true')
      const motion = document.createElementNS(SVG_NAMESPACE, 'g')
      motion.setAttribute('class', 'dsh-wri-motion')
      for (const className of ['dsh-wri-track', 'dsh-wri-arc']) {
        const circle = document.createElementNS(SVG_NAMESPACE, 'circle')
        circle.setAttribute('class', className)
        circle.setAttribute('cx', '12')
        circle.setAttribute('cy', '12')
        circle.setAttribute('r', '9.5')
        motion.appendChild(circle)
      }
      svg.appendChild(motion)
      svg.addEventListener('animationstart', () => { syncAnimations(svg) })
      cell.appendChild(svg)
      const statusWord = document.createElement('span')
      statusWord.className = LABEL_CLASS
      statusWord.textContent = label
      cell.appendChild(statusWord)
      return cell
    }

    /* ------------------------------------------------------------------ *
     * Placement: the Workspace header row
     * ------------------------------------------------------------------ */

    /**
     * Find the cell that holds the Workspace name: the row's `projectText`
     * span (identified by its shipped class suffix, then structurally as the
     * direct span child that contains the title span), never the action strip.
     * @param row - the Workspace header row.
     * @returns the name cell, or null when the row is not the expected shape.
     */
    function nameCellOf(row) {
      const children = Array.from(row.children)
      for (const child of children) {
        if (child.tagName !== 'SPAN') continue
        if (typeof child.className === 'string' && child.className.includes('projectText')) return child
      }
      for (const child of children) {
        if (child.tagName !== 'SPAN' || child.hasAttribute('data-slot')) continue
        for (const nested of child.children) {
          if (nested.tagName === 'SPAN' && !nested.hasAttribute('data-slot')) return child
        }
      }
      return null
    }

    /**
     * The cell this half already owns inside one row.
     * @param row - the Workspace header row.
     * @returns the registered spinner cell, or null.
     */
    function ownCellOf(row) {
      for (const child of row.children) {
        if (child.hasAttribute(CELL_ATTRIBUTE)) return child
      }
      return null
    }

    /**
     * Insert the spinner before the Workspace name, i.e. immediately right of
     * the row's leading folder/chevron cell. React does not own this node: it
     * is re-inserted whenever a re-render drops it, and removed on reconcile.
     * Rows hidden by a collapsed category keep their cell, so expanding that
     * category needs no extra pass here.
     * @param row - the Workspace header row.
     * @param label - localized status word for the accessible name.
     * @returns the inserted cell.
     */
    function insertCell(row, label) {
      const cell = buildCell(label)
      const nameCell = nameCellOf(row)
      if (nameCell !== null) row.insertBefore(cell, nameCell)
      else if (row.children.length > 1) row.insertBefore(cell, row.children[1])
      else row.appendChild(cell)
      syncAnimations(cell.firstElementChild)
      return cell
    }

    /**
     * Resolve the browsing region through the documented seams, most specific
     * first, and keep using the same element while it stays connected.
     * @param previous - the region used by the previous pass, if any.
     * @returns the region element, or null while the sidebar renders none.
     */
    function resolveRegion(previous) {
      if (previous !== null && previous.isConnected) return previous
      for (const selector of REGION_SELECTORS) {
        const found = document.querySelector(selector)
        if (found !== null) return found
      }
      return null
    }

    /**
     * Reconcile every rendered Workspace row against the current facts: a
     * folded row whose Workspace holds work in progress shows the spinner,
     * every other row does not.
     * @param region - the sidebar browsing region, or null while unmounted.
     * @param runningByWorkspace - Workspace ids to mark.
     * @param label - localized status word for newly inserted cells.
     */
    function reconcile(region, runningByWorkspace, label) {
      if (region === null || !region.isConnected) {
        // Workspace rows exist but neither documented region seam does:
        // report the broken seam once instead of silently never showing the spinner.
        if (!seamWarned && document.querySelector('[data-sidebar-list-area], [data-row-key^="workspace:"]') !== null) {
          seamWarned = true
          console.warn('[workspace-running-indicator] the sidebar browsing region seam is gone; the running indicator is disabled until this plugin is updated for this DSH version')
        }
        for (const stale of document.querySelectorAll(`[${CELL_ATTRIBUTE}]`)) stale.remove()
        return
      }
      for (const row of region.querySelectorAll(ROW_SELECTOR)) {
        const key = row.getAttribute(ROW_VALUE_ATTRIBUTE)
        if (key === null) continue
        const workspaceId = key.slice(ROW_KEY_PREFIX.length)
        /* The Ungrouped bucket is not a Workspace and has no backing row to mark. */
        if (workspaceId === '') continue
        const folded = row.getAttribute(FOLD_ATTRIBUTE) === 'false'
        const wanted = folded && runningByWorkspace.has(workspaceId)
        const own = ownCellOf(row)
        if (wanted) {
          if (own === null) insertCell(row, label)
        } else if (own !== null) {
          own.remove()
        }
      }
    }

    /* ------------------------------------------------------------------ *
     * Plugin
     * ------------------------------------------------------------------ */

    return {
      // `uiSession.sessionStatus` is a nested Cordis service of its own (DSH
      // 0.2.3+): reading `ctx.uiSession.sessionStatus` resolves the full dotted
      // name, so both the parent and the member must be declared. A client that
      // only injects `uiSession` is rejected by Cordis with
      // `cannot get property "uiSession.sessionStatus" without inject`.
      inject: ['workspaces', 'sessions', 'uiSession', 'uiSession.sessionStatus'],
      apply(ctx) {
        /* Shipped theme tokens only; one style element owned by this fiber. */
        ctx.effect(() => {
          const style = document.createElement('style')
          style.id = STYLE_ID
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'workspace-running-indicator: styles')

        const label = labelTranslator(ctx)
        const statuses = ctx.uiSession.sessionStatus
        const sessions = ctx.sessions.list
        const workspaces = ctx.workspaces.list
        let runningByWorkspace = new Map()
        let region = null
        let frame = 0

        function draw() {
          frame = 0
          region = resolveRegion(region)
          reconcile(region, runningByWorkspace, label())
        }

        function schedule() {
          if (frame !== 0) return
          frame = requestAnimationFrame(draw)
        }

        /** Rewrite the hidden status word of the cells already on screen (locale switch). */
        function relabel() {
          if (region === null) return
          const word = label()
          for (const cell of region.querySelectorAll(`[${CELL_ATTRIBUTE}]`)) {
            const statusWord = cell.lastElementChild
            if (statusWord !== null && statusWord.classList.contains(LABEL_CLASS)) statusWord.textContent = word
          }
        }

        function refresh() {
          runningByWorkspace = runningWorkspaces(ctx)
          schedule()
        }

        refresh()

        ctx.effect(() => statuses.subscribe(refresh), 'workspace-running-indicator: Session status')
        ctx.effect(() => sessions.subscribe(refresh), 'workspace-running-indicator: Session list')
        ctx.effect(() => workspaces.subscribe(refresh), 'workspace-running-indicator: Workspace list')

        /* The status word is part of the row's accessible name: follow a locale switch. */
        const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
        if (locale !== undefined && typeof locale.subscribe === 'function') {
          ctx.effect(() => locale.subscribe(relabel), 'workspace-running-indicator: locale')
        }

        /* React owns the rows: every insert, fold and name change is a DOM
           mutation. Only mutations inside the browsing region matter, so a
           streaming Chat elsewhere in the frame schedules nothing. */
        ctx.effect(() => {
          const observer = new MutationObserver((records) => {
            const previous = region
            const target = resolveRegion(region)
            if (target === null) return
            /* The browsing region itself appeared, was replaced, or came back
               after a sidebar collapse: every row in it is new to this half. */
            if (target !== previous) {
              schedule()
              return
            }
            for (const record of records) {
              if (record.target === target || target.contains(record.target)) {
                schedule()
                return
              }
            }
            if (!target.isConnected) schedule()
          })
          observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [FOLD_ATTRIBUTE],
          })
          return () => { observer.disconnect() }
        }, 'workspace-running-indicator: sidebar DOM')

        ctx.effect(() => () => {
          if (frame !== 0) {
            cancelAnimationFrame(frame)
            frame = 0
          }
          for (const stale of document.querySelectorAll(`[${CELL_ATTRIBUTE}]`)) stale.remove()
        }, 'workspace-running-indicator: teardown')
      },
    }
  },
})
