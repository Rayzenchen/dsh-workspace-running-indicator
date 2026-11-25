#!/usr/bin/env node
/**
 * Release checks for `@local/dsh-workspace-running-indicator`.
 *
 * The plugin decorates a sidebar DOM seam and copies the shipped spinner's
 * markup, so a release must prove three things that a syntax check cannot:
 * the manifest ships every file its page and metadata name, the version is one
 * number everywhere it appears, and the constants that mirror the shipped
 * primitives are still the shipped ones. No dependencies: it runs in CI and in
 * a plain checkout.
 *
 * Usage: node tools/verify.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const failures = []
const notes = []

/** Record one failed assertion with enough context to fix it. */
function fail(message) {
  failures.push(message)
}

/** Record one passing assertion. */
function ok(message) {
  notes.push(message)
}

/** Read a package-relative file as UTF-8. */
function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

/** Read and parse a package-relative JSON file. */
function readJson(relativePath) {
  try {
    return JSON.parse(read(relativePath))
  } catch (error) {
    fail(`${relativePath}: not valid JSON (${error.message})`)
    return undefined
  }
}

/** Existence and size of a package-relative path. */
function statOf(relativePath) {
  try {
    return statSync(join(root, relativePath))
  } catch {
    fail(`${relativePath}: missing`)
    return undefined
  }
}

/** Expand the one glob shape this package uses (`dir/*.ext`). */
function expand(pattern) {
  const slash = pattern.lastIndexOf('/')
  if (slash < 0 || !pattern.slice(slash + 1).startsWith('*')) return [pattern]
  const directory = pattern.slice(0, slash)
  const suffix = pattern.slice(slash + 1).replace('*', '')
  try {
    return readdirSync(join(root, directory))
      .filter(name => name.endsWith(suffix))
      .map(name => `${directory}/${name}`)
  } catch {
    fail(`${pattern}: directory missing`)
    return []
  }
}

/* ------------------------------------------------------------------ *
 * 1. Manifest
 * ------------------------------------------------------------------ */

const pkg = readJson('package.json')
if (pkg !== undefined) {
  if (pkg.name !== '@local/dsh-workspace-running-indicator') fail(`package.json: unexpected name ${pkg.name}`)
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version ?? '')) fail(`package.json: version ${pkg.version} is not x.y.z`)
  if (pkg.license !== 'MIT') fail('package.json: license must be MIT')
  if (pkg.private !== true) fail('package.json: private must stay true (a local bundle)')

  const exportsMap = pkg.exports ?? {}
  for (const key of ['.', './client', './package.json', './locale/*.json', './icon']) {
    if (!(key in exportsMap)) fail(`package.json: exports is missing ${key}`)
  }
  const files = new Set(pkg.files ?? [])
  for (const entry of ['index.js', 'client.js', 'cordis.patch.yml', 'locale/*.json', 'docs', 'icon.svg', 'README.md', 'README.en.md', 'LICENSE', 'tools/*.mjs']) {
    if (!files.has(entry)) fail(`package.json: files is missing ${entry}`)
  }
  if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') fail('package.json: dsh.bundle.patch must be ./cordis.patch.yml')
  if (pkg.dsh?.client?.platform !== 'web') fail('package.json: dsh.client.platform must be web')
  const clientInject = pkg.dsh?.client?.inject ?? []
  for (const dependency of [
    '@deepseek-ai/dsh-client-ui-workspace',
    '@deepseek-ai/dsh-client-ui-session',
    '@deepseek-ai/dsh-client-ui-session-status',
    '@deepseek-ai/dsh-api-workspace-controller',
  ]) {
    if (!clientInject.includes(dependency)) fail(`package.json: dsh.client.inject is missing ${dependency}`)
  }
  /* Every shipped path must exist: the plugin page and the bundle read them. */
  for (const entry of (pkg.files ?? []).flatMap(expand)) statOf(entry)
  ok(`manifest: ${pkg.name}@${pkg.version}`)
}

/* ------------------------------------------------------------------ *
 * 2. One version number everywhere
 * ------------------------------------------------------------------ */

const version = pkg?.version
if (version !== undefined) {
  const clientSource = read('client.js')
  if (!clientSource.includes(`(${version})`)) fail(`client.js: header does not name version ${version}`)
  const readme = read('README.md')
  const changelog = [...readme.matchAll(/^### (\d+\.\d+\.\d+)/gm)].map(match => match[1])
  if (changelog[0] !== version) fail(`README.md: newest changelog entry is ${changelog[0] ?? 'missing'}, expected ${version}`)
  const readmeEn = read('README.en.md')
  if (!readmeEn.includes(version)) fail(`README.en.md: does not name version ${version}`)
  const indexSource = read('index.js')
  if (!indexSource.includes(`(${version})`)) fail(`index.js: header does not name version ${version}`)
  ok(`version: ${version} in manifest, client.js, index.js and both READMEs`)
}

/* ------------------------------------------------------------------ *
 * 3. Display metadata and the detail document
 * ------------------------------------------------------------------ */

const locales = expand('locale/*.json')
for (const localePath of locales) {
  const locale = readJson(localePath)
  if (locale === undefined) continue
  for (const field of ['title', 'description']) {
    if (typeof locale.meta?.[field] !== 'string' || locale.meta[field].length === 0) {
      fail(`${localePath}: meta.${field} is missing or empty`)
    }
  }
  const detail = locale.meta?.detail
  if (detail === undefined) continue
  if (!detail.startsWith('docs/') || !/\.md$/.test(detail)) {
    fail(`${localePath}: meta.detail must point at docs/*.md, got ${detail}`)
    continue
  }
  const detailStat = statOf(detail)
  if (detailStat === undefined) continue
  const lines = read(detail).split('\n').filter(line => line.trim() !== '')
  if (lines.length !== 1) {
    fail(`${detail}: must contain exactly one image line, found ${lines.length} non-empty lines`)
    continue
  }
  const image = /^!\[[^\]]+\]\(([^)]+)\)$/.exec(lines[0].trim())
  if (image === null) {
    fail(`${detail}: the single line must be a Markdown image`)
    continue
  }
  statOf(join(dirname(detail), image[1]))
}
if (!locales.includes('locale/en.json')) fail('locale/en.json: missing (the bundle page falls back to it)')
if (!locales.includes('locale/zh.json')) fail('locale/zh.json: missing (the author\'s locale)')
ok(`display metadata: ${locales.length} locale file(s), detail documents and images resolve`)

/* ------------------------------------------------------------------ *
 * 4. Artwork
 * ------------------------------------------------------------------ */

const iconText = read('icon.svg')
const iconStat = statOf('icon.svg')
if (iconStat !== undefined && iconStat.size > 256 * 1024) fail(`icon.svg: ${iconStat.size} bytes exceeds the 256 KiB icon limit`)
for (const [label, pattern] of [
  ['a 36x36 canvas', /width="36"[^>]*height="36"|height="36"[^>]*width="36"/],
  ['a 0 0 36 36 viewBox', /viewBox="0 0 36 36"/],
  ['no script element', /^(?![\s\S]*<script)[\s\S]*$/],
  ['no style element', /^(?![\s\S]*<style)[\s\S]*$/],
  ['no foreignObject', /^(?![\s\S]*<foreignObject)[\s\S]*$/],
  ['no embedded raster image', /^(?![\s\S]*<image)[\s\S]*$/],
]) {
  if (!pattern.test(iconText)) fail(`icon.svg: expected ${label}`)
}

const previewText = read('docs/preview.svg')
const previewStat = statOf('docs/preview.svg')
if (previewStat !== undefined && previewStat.size > 5 * 1024 * 1024) fail(`docs/preview.svg: exceeds 5 MiB`)
for (const [label, pattern] of [
  ['a 640x300 canvas', /width="640"[^>]*height="300"/],
  ['a 0 0 640 300 viewBox', /viewBox="0 0 640 300"/],
  ['no text element (text-free illustration)', /^(?![\s\S]*<text)[\s\S]*$/],
  ['no script element', /^(?![\s\S]*<script)[\s\S]*$/],
  ['no stylesheet', /^(?![\s\S]*<style)[\s\S]*$/],
]) {
  if (!pattern.test(previewText)) fail(`docs/preview.svg: expected ${label}`)
}
ok('artwork: icon and preview meet the manifest limits and stay self-contained')

/* ------------------------------------------------------------------ *
 * 5. Client half mirrors the shipped primitives
 * ------------------------------------------------------------------ */

const client = read('client.js')
for (const [label, needle] of [
  ['the Slot outlet seam', '[data-slot="sidebar.workspaces"]'],
  ['the list-area fallback seam', '[data-sidebar-list-area]'],
  ['the Workspace row key', 'data-row-key^="workspace:"'],
  ['the fold attribute', "'aria-expanded'"],
  ['the nested status service', "'uiSession.sessionStatus'"],
  ['the 14px shipped ring size', 'SPINNER_SIZE = 14'],
  ['the shipped ring radius', "circle.setAttribute('r', '9.5')"],
  ['the shipped colour token', '--dsw-alias-label-tertiary'],
  ['the shipped 1.5s spin', 'animation: dsh-wri-spin 1.5s linear infinite'],
  ['the shipped dash cycle', 'stroke-dasharray: 12 150'],
  ['the reduced-motion branch', 'prefers-reduced-motion: reduce'],
  ['the animation phase reset', 'animation.startTime = 0'],
  ['the accessible status word', 'dsh-wri-label'],
]) {
  if (!client.includes(needle)) fail(`client.js: missing ${label} (${needle})`)
}
for (const language of ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt']) {
  if (!new RegExp(`^\\s*${language}: \\{ running:`, 'm').test(client)) {
    fail(`client.js: DICTIONARIES is missing the ${language} status word`)
  }
}
if (/require\(['"]@deepseek-ai\//.test(client)) fail('client.js: must not import a Harness Client package')
if (/require\(['"]react/.test(client)) fail('client.js: must not require React directly')
if (/document\.body\.appendChild/.test(client)) fail('client.js: must not append to document.body')
ok('client half: seams, shipped spinner constants, 8 locale words and isolation rules hold')

/* ------------------------------------------------------------------ *
 * 6. Bundle patch
 * ------------------------------------------------------------------ */

const patch = read('cordis.patch.yml')
if (!patch.includes('id: dsh-workspace-running-indicator')) fail('cordis.patch.yml: missing the row id')
if (!patch.includes("name: '@local/dsh-workspace-running-indicator'")) fail('cordis.patch.yml: missing the row name')
ok('bundle patch: one row naming this package')

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

if (failures.length > 0) {
  console.error(`verify: ${failures.length} problem(s)\n`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
for (const note of notes) console.log(`ok  ${note}`)
console.log(`\nverify: ${relative(process.cwd(), root) || '.'} passed`)
