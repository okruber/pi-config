import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { hexToFg, IMETO_COLORS, readThemeHex } from './imeto-style.ts'

export type TranscriptTransformContext = {
  messageType: 'user' | 'assistant' | 'assistant-thinking'
  isStreaming: boolean
  availableWidth: number
  themeSourcePath?: string
}

const ANSI_BOLD = '\x1b[1m'
const ANSI_BOLD_OFF = '\x1b[22m'
const ANSI_ITALIC_OFF = '\x1b[23m'
const ANSI_FG_OFF = '\x1b[39m'

function quoteMarkdown(markdown: string): string {
  return markdown.split('\n').map((line) => `> ${line}`).join('\n')
}

function themeHex(sourcePath: string | undefined, name: 'oxblood' | 'deepNavy'): string {
  return readThemeHex(sourcePath, [name]) ?? IMETO_COLORS[name]
}

function userLabel(sourcePath: string | undefined): string {
  return `${ANSI_ITALIC_OFF}${hexToFg(themeHex(sourcePath, 'oxblood'))}${ANSI_BOLD}YOU${ANSI_BOLD_OFF}${ANSI_FG_OFF}`
}

function userBody(markdown: string, sourcePath: string | undefined): string {
  const prefix = `${ANSI_ITALIC_OFF}${hexToFg(themeHex(sourcePath, 'deepNavy'))}`
  return markdown.split('\n').map((line) => `> ${prefix}${line}${ANSI_FG_OFF}`).join('\n')
}

export function transformTranscriptMarkdown(
  markdown: string,
  context: TranscriptTransformContext,
): string {
  if (context.messageType === 'assistant') return markdown
  if (context.messageType === 'assistant-thinking') return quoteMarkdown(markdown)
  return `> ${userLabel(context.themeSourcePath)}\n>\n${userBody(markdown, context.themeSourcePath)}`
}

export default function (pi: ExtensionAPI) {
  let getThemeSourcePath = (): string | undefined => undefined

  pi.registerMarkdownTransformer((markdown, context) => transformTranscriptMarkdown(markdown, {
    ...context,
    themeSourcePath: getThemeSourcePath(),
  }))

  pi.on('session_start', (_event, ctx) => {
    getThemeSourcePath = () => undefined
    if (ctx.mode !== 'tui') return
    getThemeSourcePath = () => ctx.ui.theme.sourcePath
  })

  pi.on('session_shutdown', () => {
    getThemeSourcePath = () => undefined
  })
}
