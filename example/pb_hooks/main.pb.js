/// <reference path="../pb_data/types.d.ts" />

// POST /mcp: superuser-only MCP endpoint with the built-in PocketBase tools
// plus one app-specific example tool.
routerAdd(
  'POST',
  '/mcp',
  (e) => {
    // In your app: require('pbjsmcp') or require(`${__hooks}/pbjsmcp/index.js`)
    const { createMcpServer, pocketbaseTools } = require(`${__hooks}/../../index.js`)

    return createMcpServer({
      name: 'pbjsmcp-example',
      version: '0.0.1',
      instructions: 'Example PocketBase MCP server. Start with pb_server_info and pb_list_collections.',
      tools: [
        ...pocketbaseTools(),
        {
          name: 'hello',
          description: 'An app-specific tool: greets someone.',
          inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
          handler: ({ args }) => `Hello, ${args.name}!`,
        },
      ],
    }).handle(e)
  },
  $apis.requireSuperuserAuth()
)

routerAdd('GET', '/mcp', (e) => {
  e.response.header().set('Allow', 'POST')
  return e.json(405, { message: 'Use POST' })
})
