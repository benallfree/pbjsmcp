// pbjsmcp entry: require('pbjsmcp') from node_modules, or
// require(`${__hooks}/pbjsmcp/index.js`) when the folder is copied into pb_hooks.
const { createMcpServer, SUPPORTED_VERSIONS } = require('./mcp.js')
const { pocketbaseTools, POCKETBASE_TOOL_GROUPS } = require('./pocketbase-tools.js')

module.exports = { createMcpServer, pocketbaseTools, SUPPORTED_VERSIONS, POCKETBASE_TOOL_GROUPS }
