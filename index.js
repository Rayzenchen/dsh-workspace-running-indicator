/**
 * Host half of `@local/dsh-workspace-running-indicator` (1.0.0).
 *
 * The feature is a browser-surface decoration: the package's `./client` export
 * reads the Client Session/Workspace state and draws the indicator into the
 * sidebar. This Host row owns that Client half through its activation and
 * registers nothing on the Host side.
 */

/** Stable Cordis plugin name, matching the bundle patch row id. */
export const name = 'dsh-workspace-running-indicator'

/** Register nothing: the Host has no part in this decoration. */
export function apply() {}
