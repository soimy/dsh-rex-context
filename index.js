/**
 * dsh-rex-context — port of Rex's SessionStart harness hook to dsh.
 *
 * Rex's CLI installs two things for every harness it knows (claude, codex,
 * opencode, pi): a skill and a SessionStart hook. The hook is just text —
 * `rex __internal session-start --agent <name>` prints a prompt block telling
 * the agent it runs inside a Rex terminal, which session/pane the inherited
 * REX_* ids point at, and how to drive Rex. dsh has no SessionStart hook, but
 * it has a system-prompt section registry, so this plugin registers that block
 * once per process (Rex ids are process-wide: one dsh-tui per pane).
 *
 * The block is fetched from the installed Rex binary at boot, not copied:
 * upgrading Rex changes what the agent is told, exactly like upgrading Rex
 * changes what the claude/codex hooks print. `__internal` is private API and
 * may move; if the call fails, the static fallback below keeps working.
 * `--feature-session-naming=false` keeps this integration from renaming the
 * user's shared Rex session — drop that flag for full claude/codex parity.
 *
 * Status reporting is deliberately absent: Rex gets idle/working/done/blocked/
 * error from the OSC 7501 Program Status Protocol that dsh-tui already emits
 * itself, so rewriting that through a hook would be a second, worse source.
 *
 * No env → no section: outside Rex this plugin is a no-op.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const name = 'rex-context'
export const inject = ['systemPrompt']

const SECTION = 'rex-terminal'
const ORDER = 70
/** Unknown to Rex → generic skill wording, no `/rex` or `$rex` prefix. */
const AGENT = 'dsh-tui'

/**
 * Current hook text from the installed Rex CLI (same command Rex's own hook
 * runs). Returns '' when the binary is missing, slow, or the command moved.
 */
function liveContext() {
  try {
    return execFileSync(
      'rex',
      [
        '__internal',
        'session-start',
        '--agent',
        AGENT,
        '--feature-session-naming=false',
        '--autostart=false',
      ],
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
  } catch {
    return ''
  }
}

/**
 * Render the Rex context block, or '' when not running inside Rex.
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function renderRexContext(env = process.env) {
  const session = env.REX_SESSION
  const block = env.REX_BLOCK
  if (!session && !block) return ''
  const server = env.REX_SERVER ?? ''
  return `You're running in a Rex terminal.

\`\`\`text
REX_SERVER=${server}
REX_SESSION=${session ?? ''}
REX_BLOCK=${block ?? ''}
\`\`\`

\`REX_SESSION\` identifies your session, and \`REX_BLOCK\` identifies your terminal pane. Both variables are set in your shell. Pass \`-s "$REX_SESSION"\` and \`-b "$REX_BLOCK"\` to select them in Rex commands. The user may be viewing a different session or pane.

These inherited IDs haven't been checked against the server. If a target can't be found, run \`rex whoami --json\` to check your current connection and location.

Use the \`rex\` command to create sessions, open tabs, split panes, run commands, and read terminal output. In the CLI, a tab is a window and a pane is a block. To run work on the user's other machines, use \`rex hosts\` and \`rex -S HOST\`.

The rex skill (/rex) provides instructions and examples for Rex tasks. If the skill isn't installed, run \`rex skill show\` to read the same guide.`
}

/**
 * Live text when Rex answers, static block otherwise; '' outside Rex.
 * @param {Record<string, string | undefined>} env
 * @param {() => string} run
 */
export function sectionText(env = process.env, run = liveContext) {
  if (!env.REX_SESSION && !env.REX_BLOCK) return ''
  return run() || renderRexContext(env)
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const text = sectionText(process.env)
  if (!text) return
  ctx.systemPrompt.section({ name: SECTION, order: ORDER, text })
}

/** Runnable self-check: `node index.js`. */
function demo() {
  assert.equal(renderRexContext({}), '', 'no Rex env → no static block')
  const fakeEnv = {
    REX_SERVER: 'unix:///tmp/rex.sock',
    REX_SESSION: 'session:1',
    REX_BLOCK: 'block:2',
  }
  const fallback = renderRexContext(fakeEnv)
  assert.match(fallback, /REX_SESSION=session:1/)
  assert.match(fallback, /REX_BLOCK=block:2/)
  assert.match(fallback, /rex whoami --json/)
  assert.match(fallback, /rex skill show/)

  assert.equal(sectionText({}, () => 'live'), '', 'outside Rex nothing is queried')
  assert.equal(sectionText(fakeEnv, () => 'LIVE'), 'LIVE', 'live text wins')
  assert.equal(sectionText(fakeEnv, () => ''), fallback, 'CLI failure falls back')

  // apply() reads process.env, so drive both branches under a saved env.
  const saved = {}
  for (const key of ['REX_SERVER', 'REX_SESSION', 'REX_BLOCK']) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  const sections = []
  const stub = { systemPrompt: { section: (s) => sections.push(s) } }
  try {
    apply(stub)
    assert.equal(sections.length, 0, 'no section when not in Rex')

    process.env.REX_SESSION = 'session:1'
    process.env.REX_BLOCK = 'block:2'
    apply(stub)
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  assert.equal(sections.length, 1, 'one section inside Rex')
  assert.deepEqual(
    { name: sections[0].name, order: sections[0].order },
    { name: 'rex-terminal', order: 70 },
  )
  assert.match(sections[0].text, /You're running in a Rex terminal\./)
  console.log('dsh-rex-context self-check ok')
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === entry) demo()
