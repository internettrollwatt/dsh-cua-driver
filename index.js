// dsh-cua-driver — bridge a cua-driver MCP stdio server into DSH tools.
//
// Design: this plugin is a generic MCP stdio host.
//   1. spawn `cua-driver.exe mcp --direct` from vendor/ (self-contained per profile);
//   2. speak newline-delimited JSON-RPC 2.0 (MCP) over its stdin/stdout;
//   3. initialize -> notifications/initialized -> tools/list;
//   4. expose the returned tools as DSH tools with a `cua_` prefix.
//
// Exposure model: by default only `cua_activate` is registered at startup (63 MCP
// tools with long descriptions would otherwise be paid for on every request).
// Calling it registers the full surface for the profile and returns a short manual.
// Set `eager: true` in the bundle row to register everything immediately.
//
// Image results (screenshots from get_desktop_state / get_window_state) are attached
// through the host's `attachments` service when the active model declares image input;
// otherwise the metadata text is returned with `imageStatus: "path-only"`.

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join as joinPath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const inject = ['tools']

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = joinPath(PLUGIN_DIR, 'skills', 'cua-driver')

/**
 * Locate the vendored `cua-driver.exe`. Prefers the known 0.46.1 layout, then falls
 * back to any `vendor/cua-driver-rs-<version>/` directory so a driver upgrade that
 * swaps the version folder does not break the plugin. `config.exe` always wins.
 */
function findVendorExe () {
  const known = joinPath(PLUGIN_DIR, 'vendor', 'cua-driver-rs-0.46.1-windows-x86_64', 'cua-driver.exe')
  if (existsSync(known)) return known
  const vendorDir = joinPath(PLUGIN_DIR, 'vendor')
  try {
    const candidates = readdirSync(vendorDir)
      .filter((name) => name.startsWith('cua-driver-rs-'))
      .map((name) => joinPath(vendorDir, name, 'cua-driver.exe'))
      .filter((path) => existsSync(path))
    if (candidates.length) return candidates.sort().at(-1)
  } catch { /* no vendor dir at all */ }
  return null
}
const CLIENT_NAME = 'dsh-cua-driver'
const CLIENT_VERSION = '0.1.0'

// Tools that never move the pointer or inject input; safe to run concurrently.
const READ_ONLY = new Set([
  'list_apps', 'list_windows', 'get_window_state', 'get_desktop_state', 'get_accessibility_tree',
  'get_screen_size', 'get_cursor_position', 'get_agent_cursor_state', 'get_session_state',
  'get_session', 'list_sessions', 'get_config', 'get_guide', 'check_permissions', 'health_report',
  'get_recording_state', 'get_browser_state', 'debug_window_info', 'check_for_update', 'zoom',
  'verify_state',
])

const MANUAL = [
  'cua-driver: background Windows computer-use via MCP (UIA + PostMessage + CDP).',
  'Workflow: get_window_state (UIA tree, cheap) → act (click/type_text/press_key/set_value/…) → verify_state or a fresh read.',
  'input targets: most actions take pid/window_id or role/name/element tokens from a fresh get_window_state read. Element tokens go stale after the UI changes: re-read before acting when unsure.',
  'Background input: type_text (WM_CHAR), press_key, hotkey, click/drag/scroll run without stealing focus. Chromium page text ignores PostMessage key events — use browser_type / browser_* (CDP) for web content; browser_prepare attaches to an existing Edge/Chromium target.',
  'Batching: run_steps = fixed script of steps with wait_for/expect checks and one observe; run_script = JS logic through `cua`. Prefer them over many single calls.',
  'Verification: verify_state checks bounded predicates deterministically; screenshots come back as image blocks when the model accepts images.',
  'Do not mix cua_* and computer_* (SendInput foreground) on the same target within one task; pick one channel per target.',
  'Permissions: cua-driver mcp --direct inherits this process; browser attachment may require the driver daemon (serve) with grants in restricted setups.',
].join('\n')

/** Minimal newline-delimited JSON-RPC 2.0 client for a stdio MCP server. */
class McpStdioClient {
  constructor (exe, args, { log, requestTimeoutMs = 120_000 } = {}) {
    this.exe = exe
    this.log = log
    this.defaultTimeout = requestTimeoutMs
    this.pending = new Map()
    this.nextId = 1
    this.buffer = ''
    this.closed = false
    this.lastStderr = []
    this.child = spawn(exe, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stdout.on('data', (chunk) => this.#onData(chunk))
    this.child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (!text) return
      this.lastStderr.push(text)
      if (this.lastStderr.length > 40) this.lastStderr.shift()
      this.log(`stderr: ${text.slice(0, 400)}`)
    })
    this.child.on('error', (error) => this.#failAll(error))
    this.child.on('exit', (code, signal) => {
      const tail = this.lastStderr.slice(-5).join('\n')
      this.#failAll(new Error(`cua-driver exited (code=${code}, signal=${signal})${tail ? `: ${tail}` : ''}`))
    })
  }

  #onData (chunk) {
    this.buffer += chunk
    let index
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        this.log(`unparsed stdout line: ${line.slice(0, 200)}`)
        continue
      }
      this.#dispatch(message)
    }
  }

  #dispatch (message) {
    if (message && message.id !== undefined && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id)
      this.pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error) {
        entry.reject(Object.assign(new Error(message.error.message || 'MCP error'), { code: message.error.code, data: message.error.data }))
      } else {
        entry.resolve(message.result)
      }
      return
    }
    // Server -> client requests: answer minimally so the server never blocks on us.
    if (message && typeof message.method === 'string' && message.id !== undefined) {
      const reply = { jsonrpc: '2.0', id: message.id }
      switch (message.method) {
        case 'ping':
          reply.result = {}
          break
        case 'resources/list':
          reply.result = { resources: [] }
          break
        case 'prompts/list':
          reply.result = { prompts: [] }
          break
        case 'roots/list':
          reply.result = { roots: [] }
          break
        default:
          reply.error = { code: -32601, message: 'method not found' }
      }
      this.#write(reply)
    }
  }

  request (method, params, timeoutMs = this.defaultTimeout) {
    if (this.closed) return Promise.reject(new Error('cua-driver MCP client is closed'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`cua-driver MCP timeout after ${timeoutMs}ms: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.#write({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify (method, params) {
    this.#write({ jsonrpc: '2.0', method, params })
  }

  #write (message) {
    if (this.closed) throw new Error('cua-driver MCP client is closed')
    try {
      this.child.stdin.write(JSON.stringify(message) + '\n')
    } catch (error) {
      this.#failAll(error)
      throw error
    }
  }

  #failAll (error) {
    this.closed = true
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pending.clear()
  }

  dispose () {
    this.closed = true
    this.#failAll(new Error('cua-driver bridge disposed'))
    try { this.child.stdin.end() } catch { /* ignore */ }
    try { this.child.kill() } catch { /* ignore */ }
  }
}

function convertNode (node, isRequired = false) {
  if (!node || typeof node !== 'object') {
    return isRequired ? { type: 'string', required: true } : { type: 'string' }
  }
  const out = {}
  if (typeof node.description === 'string' && node.description) {
    out.description = node.description.length > 4000 ? node.description.slice(0, 4000) + '…' : node.description
  }
  const type = pickType(node)
  if (type) out.type = type
  if (Array.isArray(node.enum)) out.enum = node.enum
  if (type === 'array') {
    out.items = node.items && typeof node.items === 'object' ? convertNode(node.items, false) : { type: 'string' }
  } else if (type === 'object') {
    const required = new Set(Array.isArray(node.required) ? node.required : [])
    if (node.properties && typeof node.properties === 'object') {
      const properties = {}
      for (const [key, child] of Object.entries(node.properties)) properties[key] = convertNode(child, required.has(key))
      out.properties = properties
    }
    out.additionalProperties = node.additionalProperties !== false
  }
  if (isRequired) out.required = true
  return out
}

function pickType (node) {
  if (typeof node.type === 'string') return node.type
  if (Array.isArray(node.type)) {
    const first = node.type.find((value) => value && value !== 'null')
    return first || 'string'
  }
  const members = Array.isArray(node.anyOf) ? node.anyOf : Array.isArray(node.oneOf) ? node.oneOf : null
  if (members) {
    for (const member of members) {
      const type = pickType(member)
      if (type) return type
    }
  }
  if (node.properties) return 'object'
  if (node.items) return 'array'
  return 'string'
}

function convertParameters (schema) {
  if (!schema || typeof schema !== 'object') return {}
  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {}
  const out = {}
  for (const [key, node] of Object.entries(properties)) out[key] = convertNode(node, required.has(key))
  return out
}

/** Flatten an MCP tools/call result into a value the DSH tool layer renders. */
async function toDshResult (ctx, exec, result, log) {
  if (!result || typeof result !== 'object') return result ?? null
  const content = Array.isArray(result.content) ? result.content : []
  const textual = content.filter((block) => block && block.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n')
  if (result.isError) {
    throw new Error(textual || 'cua-driver tool returned an error')
  }
  const imageBlock = content.find((block) => block && block.type === 'image' && typeof block.data === 'string')
  const structured = result.structuredContent && typeof result.structuredContent === 'object' ? result.structuredContent : null
  const value = structured ? { ...structured } : {}
  if (textual) value.text = value.text === undefined ? textual : `${value.text}\n${textual}`
  if (imageBlock) {
    const image = await attachImage(ctx, exec, imageBlock, log)
    if (image) value.image = image
    else {
      value.imageStatus = 'path-only'
      if (!value.imageReason) value.imageReason = 'image-not-attached'
    }
  }
  if (Object.keys(value).length === 0) return textual || null
  return value
}

async function attachImage (ctx, exec, block, log) {
  try {
    const attachments = ctx.get?.('attachments')
    const llm = ctx.get?.('llm')
    if (!attachments?.saveImage) return null
    const mediaType = block.mimeType || 'image/png'
    if (llm?.resolveModelInfo) {
      const routed = exec?.agent?.session?.requestHeader?.()?.config
      const provider = routed?.provider ?? exec?.agent?.options?.provider
      const model = routed?.model ?? exec?.agent?.options?.model
      if (provider && model) {
        const info = await llm.resolveModelInfo(provider, model, exec?.signal)
        if (info && Array.isArray(info.inputModalities) && !info.inputModalities.includes('image')) return null
      }
    }
    const image = await attachments.saveImage({
      data: Buffer.from(block.data, 'base64'),
      mediaType,
      name: `cua-driver-${Date.now()}.png`,
    })
    return image
  } catch (error) {
    log(`image attach failed: ${error?.message || error}`)
    return null
  }
}

function renderValue (args, value) {
  if (value === undefined || value === null) return [{ type: 'text', text: 'ok' }]
  if (typeof value === 'string') return [{ type: 'text', text: value.slice(0, 200_000) }]
  const { image, ...rest } = value
  let text
  try {
    text = JSON.stringify(rest)
  } catch {
    text = String(rest)
  }
  if (text.length > 200_000) text = text.slice(0, 200_000) + '…[truncated]'
  const blocks = [{ type: 'text', text }]
  if (image) blocks.push({ type: 'image', attachment: image })
  return blocks
}

function buildDefinition (tool, { ctx, client, prefix, timeoutMs, log }) {
  if (!tool || typeof tool.name !== 'string' || !tool.name) return null
  const mcpName = tool.name
  const description = typeof tool.description === 'string' && tool.description
    ? tool.description.slice(0, 4000)
    : `cua-driver tool ${mcpName}`
  const toolOptions = (parameters) => ({
    name: prefix + mcpName,
    description,
    parameters,
    output: { schema: { type: 'object', additionalProperties: true }, render: renderValue },
    isConcurrencySafe: () => READ_ONLY.has(mcpName),
    timeoutMs,
    execute: async (args, exec) => {
      if (exec?.signal?.aborted) throw new Error('cancelled')
      const callArgs = args && typeof args === 'object' ? args : {}
      const result = await client.request('tools/call', { name: mcpName, arguments: callArgs }, timeoutMs)
      return toDshResult(ctx, exec, result, log)
    },
  })
  try {
    return defineTool(toolOptions(convertParameters(tool.inputSchema)))
  } catch (error) {
    log(`defineTool(${mcpName}) failed with full schema: ${error?.message || error}; retrying with a flattened schema`)
    try {
      const flattened = {}
      const schema = tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : {}
      for (const key of Object.keys(schema.properties || {})) flattened[key] = { type: 'string', description: String((schema.properties[key] || {}).description || key).slice(0, 2000) }
      return defineTool(toolOptions(flattened))
    } catch (inner) {
      log(`skip tool ${mcpName}: ${inner?.message || inner}`)
      return null
    }
  }
}

/** Split a SKILL.md's YAML frontmatter from its body, reading the flat scalar keys this needs. */
function splitSkillFile (raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(raw)
  if (!match) return { data: {}, body: raw }
  const data = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line)
    // An empty value is a nested block (mapping or sequence), not a scalar this reader needs.
    if (kv && kv[2] !== '') data[kv[1]] = kv[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
  }
  return { data, body: raw.slice(match[0].length) }
}

// THE BUNDLED SKILL IS REGISTERED WITH THE HOST, NOT MERELY SHIPPED (same seam as
// dsh-codex-style-computer-use). The host's skill filesystem scanner only walks
// `<project>/.dsh/skills`, `<project>/.agents/skills`, configured custom dirs,
// `<dshHome>/skills` and `<agentsHome>/skills` — never `node_modules` — so a `skills/`
// folder inside this package is invisible to it. `ctx.skills.register()` contributes an
// in-memory ("bundled") skill whose body is served from this package instead.
//
// This is an enhancement, never a precondition: a missing skills service or unreadable
// file degrades to one log line and the tools are exactly as they were.
function registerBundledSkill (ctx, log) {
  if (typeof ctx.inject !== 'function') {
    log('host exposes no ctx.inject — the bundled cua-driver skill stays unregistered')
    return
  }
  ctx.inject(['skills'], (sctx) => {
    const skills = sctx?.skills
    if (!skills || typeof skills.register !== 'function') {
      log('skills service is mounted but exposes no register() — the bundled cua-driver skill stays unregistered')
      return
    }
    const skillFile = joinPath(SKILL_DIR, 'SKILL.md')
    let raw
    try {
      raw = readFileSync(skillFile, 'utf8')
    } catch (error) {
      log(`bundled skill unreadable at ${skillFile} (${error.message})`)
      return
    }
    const { data, body } = splitSkillFile(raw)
    if (!data.name || !data.description) {
      log(`bundled skill ${skillFile} lacks name/description frontmatter — not registered`)
      return
    }
    try {
      skills.register({
        name: data.name,
        description: data.description,
        ...(data.whenToUse ? { whenToUse: data.whenToUse } : {}),
        source: 'bundled',
        content: body,
        resourceBase: { kind: 'directory', path: SKILL_DIR },
      })
      log(`registered bundled skill '${data.name}' from ${SKILL_DIR}`)
    } catch (error) {
      log(`skill registration refused for '${data.name}': ${error.message}`)
    }
  })
}

export function apply (ctx, config = {}) {
  const log = (message) => { try { console.log(`[dsh-cua-driver] ${message}`) } catch { /* ignore */ } }
  const exe = typeof config.exe === 'string' && config.exe ? config.exe : findVendorExe()
  const prefix = typeof config.toolPrefix === 'string' && config.toolPrefix ? config.toolPrefix : 'cua_'
  const timeoutMs = Number.isFinite(config.toolTimeoutMs) ? config.toolTimeoutMs : 120_000
  const eager = config.eager === true
  const extraArgs = Array.isArray(config.mcpArgs) ? config.mcpArgs.filter((value) => typeof value === 'string') : []

  registerBundledSkill(ctx, log)

  if (!exe || !existsSync(exe)) {
    log(`cua-driver binary not found${exe ? ` at ${exe}` : ' under vendor/'}; the bridge will not start`)
    return
  }

  const disposers = []
  const toolDefs = []
  let client
  let ready = false
  let active = false
  let disposed = false

  const start = async () => {
    if (disposed) return
    client = new McpStdioClient(exe, ['mcp', '--direct', ...extraArgs], { log, requestTimeoutMs: timeoutMs })
    const init = await client.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
    }, 30_000)
    log(`initialized: ${JSON.stringify(init?.serverInfo || {})}`)
    client.notify('notifications/initialized')
    const listed = await client.request('tools/list', {}, 30_000)
    const tools = Array.isArray(listed?.tools) ? listed.tools : []
    log(`tools/list returned ${tools.length} tools`)
    for (const tool of tools) {
      const def = buildDefinition(tool, { ctx, client, prefix, timeoutMs, log })
      if (def) toolDefs.push(def)
    }
    ready = true
    log(`ready: ${toolDefs.length} cua tools available${eager ? ' (registering eagerly)' : ''}`)
    if (eager) activateAll()
  }

  const activateAll = () => {
    if (active) return
    active = true
    for (const def of toolDefs) disposers.push(ctx.tools.register(def))
  }

  const activateDef = defineTool({
    name: prefix + 'activate',
    description: 'Load the cua-driver manual (background Windows GUI automation: UIA trees, PostMessage input, CDP browser control) and register this profile\'s cua_* tools. Call once per profile before using cua_* tools.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }] },
    isConcurrencySafe: () => false,
    execute: async () => {
      if (!ready) throw new Error('cua-driver bridge is still starting; call again in a moment')
      const first = !active
      activateAll()
      return {
        activated: true,
        reused: !first,
        tools: toolDefs.map((def) => def.name),
        manual: MANUAL,
        exe,
        driver: 'cua-driver MCP over stdio',
      }
    },
  })
  disposers.push(ctx.tools.register(activateDef))

  ctx.effect(() => () => {
    disposed = true
    for (const dispose of disposers.reverse()) { try { dispose() } catch { /* ignore */ } }
    try { client?.dispose() } catch { /* ignore */ }
  })

  start().catch((error) => log(`bridge failed to start: ${error?.stack || error}`))
}
