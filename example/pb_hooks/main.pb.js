/// <reference path="../pb_data/types.d.ts" />

// POST /mcp: superuser-only MCP endpoint with two example tools.
routerAdd(
  'POST',
  '/mcp',
  (e) => {
    const { createMcpServer } = require(`${__hooks}/../../mcp.js`) // in your app: `${__hooks}/mcp.js`

    return createMcpServer({
      name: 'pbjsmcp-example',
      version: '0.0.1',
      instructions: 'Example PocketBase MCP server. Use list_collections to explore the schema.',
      tools: [
        {
          name: 'whoami',
          description: 'Show which auth record this MCP connection is using.',
          inputSchema: { type: 'object', properties: {} },
          handler: ({ auth }) => ({
            id: auth.id,
            collection: auth.collection().name,
            email: auth.email(),
          }),
        },
        {
          name: 'list_collections',
          description: 'List collections with their type and field names.',
          inputSchema: {
            type: 'object',
            properties: { includeSystem: { type: 'boolean', default: false } },
          },
          handler: ({ args }) => {
            const collections = $app
              .findAllCollections()
              .filter((c) => args.includeSystem || !c.system)
              .map((c) => ({ name: c.name, type: c.type, fields: c.fields.map((f) => f.getName()) }))
            return { collections }
          },
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
