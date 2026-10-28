import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { formatProgramStatus, type ProgramStatus } from '@earendil-works/pi-tui'

// Pi reports select, confirm, input, and editor dialogs as blocked, but not ui.custom dialogs such as ask_user_question.
export default function (pi: ExtensionAPI) {
  if (!process.env.REX_BLOCK || process.env.PI_PROGRAM_STATUS === '0') return

  let interactive = false
  let running = false
  let blocking = false

  const report = (status: ProgramStatus) => {
    process.stdout.write(formatProgramStatus({ ...status, app: 'pi' }))
  }

  pi.on('session_start', (_event, ctx) => {
    interactive = ctx.mode === 'tui'
  })

  pi.on('agent_start', () => {
    running = true
  })

  pi.on('agent_settled', () => {
    running = false
  })

  pi.on('ui_prompt_start', ({ kind }) => {
    if (!interactive || kind !== 'custom') return
    blocking = true
    report({ state: 'blocked', kind: 'question' })
  })

  pi.on('ui_prompt_end', () => {
    if (!blocking) return
    blocking = false
    report(running ? { state: 'working', message: pi.getSessionName() } : { state: 'idle' })
  })
}
