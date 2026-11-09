// pbjsmcp: a Model Context Protocol server for PocketBase JSVM (pb_hooks).
// https://github.com/benallfree/pbjsmcp  (MIT)
//
// Transport: MCP Streamable HTTP, stateless.
// - POST one JSON-RPC message per request; the reply is plain JSON
//   (no SSE stream, no MCP session ids).
// - Notifications (messages without an id) get 202 with no body.
// - Mount GET on the same path and return 405: this server never pushes
//   server-initiated messages.
// - Authentication is the route middleware's job (e.g. $apis.requireSuperuserAuth()).
//
// Usage (inside a route handler, because pb_hooks handlers can't see
// top-level variables):
//
//   const { createMcpServer } = require(`${__hooks}/mcp.js`)
//   return createMcpServer({ name, version, tools }).handle(e)
//
// A tool is { name, description, inputSchema, handler(ctx) }.
// ctx is { args, auth, e }. Return any JSON-able value; it is sent back as
// text content, plus structuredContent when it's a plain object. Throw to
// report a tool error the model can read.

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']

const rpcError = (id, code, message) => ({
  jsonrpc: '2.0',
  id: id === undefined ? null : id,
  error: { code, message },
})
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result })

const toolResult = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  const result = { content: [{ type: 'text', text: text === undefined ? '' : text }] }
  if (value && typeof value === 'object' && !Array.isArray(value)) result.structuredContent = value
  return result
}

const errorMessage = (err) => `${err && err.message ? err.message : err}`

const createMcpServer = ({ name, version, instructions, tools }) => {
  const byName = {}
  ;(tools || []).forEach((t) => (byName[t.name] = t))

  const dispatch = (msg, ctx) => {
    const { id, method } = msg
    const params = msg.params || {}
    switch (method) {
      case 'initialize': {
        const requested = params.protocolVersion
        const protocolVersion =
          SUPPORTED_VERSIONS.indexOf(requested) >= 0 ? requested : SUPPORTED_VERSIONS[0]
        const result = {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name, version },
        }
        if (instructions) result.instructions = instructions
        return rpcResult(id, result)
      }
      case 'ping':
        return rpcResult(id, {})
      case 'tools/list':
        return rpcResult(id, {
          tools: (tools || []).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema || { type: 'object', properties: {} },
          })),
        })
      case 'tools/call': {
        const tool = byName[params.name]
        if (!tool) return rpcError(id, -32602, `Unknown tool: ${params.name}`)
        try {
          return rpcResult(id, toolResult(tool.handler({ args: params.arguments || {}, auth: ctx.auth, e: ctx.e })))
        } catch (err) {
          // Tool failures are results the model can read and react to, not protocol errors.
          return rpcResult(id, { isError: true, content: [{ type: 'text', text: errorMessage(err) }] })
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`)
    }
  }

  /** Route handler for POST <path> */
  const handle = (e) => {
    const info = e.requestInfo()
    const msg = info.body

    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || !msg.method) {
      return e.json(400, rpcError(null, -32600, 'Invalid Request: expected a single JSON-RPC 2.0 message'))
    }

    if (msg.id === undefined || msg.id === null) return e.noContent(202)

    return e.json(200, dispatch(msg, { auth: info.auth, e }))
  }

  return { handle }
}

module.exports = { createMcpServer, SUPPORTED_VERSIONS }
