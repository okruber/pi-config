import { readFileSync } from 'node:fs'

export const OSSEO_COLORS = {
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
  signalRed: '#B7333D',
  signalOrange: '#B85E14',
  signalYellow: '#8A6D00',
  signalGreen: '#0B8C50',
  signalBlue: '#2072B2',
  toolPendingBg: '#f0e3d6',
  toolSuccessBg: '#ccd6c7',
  toolErrorBg: '#eed6d3',
  frameLine: '#3e4739',
  framePendingLine: '#B85E14',
  framePendingFill: '#f6ece6',
  frameErrorLine: '#B7333D',
  frameErrorFill: '#f3e0dc',
} as const

export type OsseoColorName = keyof typeof OSSEO_COLORS

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

// Render calls hit this cache on every frame; only a new sourcePath pays a
// file read, so theme JSON is parsed once per session, not per render.
const themeVarsCache = new Map<string, Map<string, string>>()

function loadThemeVars(sourcePath: string): Map<string, string> {
  const cached = themeVarsCache.get(sourcePath)
  if (cached) return cached
  let vars = new Map<string, string>()
  try {
    const parsed = JSON.parse(readFileSync(sourcePath, 'utf8')) as {
      vars?: Record<string, unknown>
    }
    for (const [name, value] of Object.entries(parsed.vars ?? {})) {
      if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
        vars.set(name, value)
      }
    }
  } catch {
    vars = new Map()
  }
  themeVarsCache.set(sourcePath, vars)
  return vars
}

export function resolveThemeVar(sourcePath: string | undefined, name: OsseoColorName): string {
  if (!sourcePath) return OSSEO_COLORS[name]
  return loadThemeVars(sourcePath).get(name) ?? OSSEO_COLORS[name]
}

export default function () {}
