import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import extension from '../extensions/custom-dialog-status.ts'

type Handler = (event: any, ctx: any) => void

let written: string[]
let handlers: Map<string, Handler>
const realWrite = process.stdout.write
const realEnv = { ...process.env }

function load(env: Record<string, string>) {
  delete process.env.REX_BLOCK
  delete process.env.PI_PROGRAM_STATUS
  Object.assign(process.env, env)
  handlers = new Map()
  extension({ on: (name: string, handler: Handler) => handlers.set(name, handler), getSessionName: () => 'probe' } as any)
}

const emit = (name: string, event: any = {}, ctx: any = { mode: 'tui' }) => handlers.get(name)?.(event, ctx)

function reports(): string[] {
  return written.map((sequence) => {
    const pairs = Object.fromEntries(sequence.slice(7, -2).split(':').map((pair) => pair.split('=', 2)))
    const msg = pairs.msg ? ` ${Buffer.from(pairs.msg, 'base64').toString()}` : ''
    return `${pairs.state}${pairs.kind ? `/${pairs.kind}` : ''}${msg}`
  })
}

beforeEach(() => {
  written = []
  process.stdout.write = ((chunk: string) => written.push(chunk)) as any
})

afterEach(() => {
  process.stdout.write = realWrite
  process.env = { ...realEnv }
})

test('stays inert outside Rex or with program status turned off', () => {
  load({})
  assert.equal(handlers.size, 0)
  load({ REX_BLOCK: 'block:1', PI_PROGRAM_STATUS: '0' })
  assert.equal(handlers.size, 0)
})

test('a custom dialog in a run blocks it, then hands back working', () => {
  load({ REX_BLOCK: 'block:1' })
  emit('session_start')
  emit('agent_start')
  emit('ui_prompt_start', { kind: 'custom' })
  emit('ui_prompt_end', { kind: 'custom' })
  assert.deepEqual(reports(), ['blocked/question', 'working probe'])
})

test('a custom dialog outside a run hands back idle', () => {
  load({ REX_BLOCK: 'block:1' })
  emit('session_start')
  emit('agent_start')
  emit('agent_settled', { aborted: false })
  emit('ui_prompt_start', { kind: 'custom' })
  emit('ui_prompt_end', { kind: 'custom' })
  assert.deepEqual(reports(), ['blocked/question', 'idle'])
})

test('leaves dialogs pi reports itself and non-interactive modes alone', () => {
  load({ REX_BLOCK: 'block:1' })
  emit('session_start')
  emit('ui_prompt_start', { kind: 'confirm', title: 'Allow?' })
  emit('ui_prompt_end', { kind: 'confirm' })
  emit('session_start', {}, { mode: 'rpc' })
  emit('ui_prompt_start', { kind: 'custom' })
  emit('ui_prompt_end', { kind: 'custom' })
  assert.deepEqual(reports(), [])
})
