import { readFileSync } from 'node:fs'

export const TERMINAL_UI_COLORS = {
  oxblood: '#6a3026',
  bone: '#e9e3df',
  darkSpruce: '#1c1e1b',
  deepNavy: '#04162a',
  mossGreen: '#3e4739',
  mauveTaupe: '#907062',
  cloudPetal: '#fbf9f7',
  sageGrey: '#89897c',
  dustyBlue: '#8894a0',
  terracotta: '#a56148',
} as const

export type TerminalUiColorName = keyof typeof TERMINAL_UI_COLORS

function rgb(hex: string): [number, number, number] {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Invalid RGB hex: ${hex}`)
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

export function hexToFg(hex: string): string {
  const [r, g, b] = rgb(hex)
  return `\x1b[38;2;${r};${g};${b}m`
}

export function hexToBg(hex: string): string {
  const [r, g, b] = rgb(hex)
  return `\x1b[48;2;${r};${g};${b}m`
}

export function readThemeHex(
  sourcePath: string | undefined,
  names: readonly string[],
): string | undefined {
  if (!sourcePath) return undefined
  try {
    const parsed = JSON.parse(readFileSync(sourcePath, 'utf8')) as {
      vars?: Record<string, unknown>
    }
    for (const name of names) {
      const value = parsed.vars?.[name]
      if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) return value
    }
  } catch {
    return undefined
  }
  return undefined
}

export default function () {}
