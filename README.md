# pbjsmcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that runs **inside PocketBase**, in `pb_hooks`. No sidecar process, no superuser password in an agent's config, and the tools are your app's features rather than raw table access.

- One file, no dependencies: [`mcp.js`](mcp.js)
- MCP **Streamable HTTP** transport, stateless: each POST carries one JSON-RPC message and gets plain JSON back
- Auth is ordinary PocketBase route middleware
- Tools only (no resources, prompts or server-initiated messages yet)

## Quick start

Copy `mcp.js` into your `pb_hooks/`, then add a route:

```js
// pb_hooks/mcp.pb.js
routerAdd(
  'POST',
  '/mcp',
  (e) => {
    const { createMcpServer } = require(`${__hooks}/mcp.js`)
    return createMcpServer({
      name: 'my-app',
      version: '1.0.0',
      tools: [
        {
          name: 'count_posts',
          description: 'Count published posts.',
          inputSchema: { type: 'object', properties: {} },
          handler: () => ({ count: $app.countRecords('posts', $dbx.hashExp({ published: true })) }),
        },
      ],
    }).handle(e)
  },
  $apis.requireSuperuserAuth()
)

routerAdd('GET', '/mcp', (e) => e.json(405, { message: 'Use POST' }))
```

`require` goes **inside** the handler: pb_hooks route handlers can't see top-level variables.

See [`example/`](example) for a runnable app.

## Tools

```js
{
  name: 'tool_name',
  description: 'What it does, for the model.',
  inputSchema: { type: 'object', properties: { ... } }, // JSON Schema
  handler: ({ args, auth, e }) => result,
}
```

- `args`: the tool arguments
- `auth`: the authenticated record (`e.auth`)
- `e`: the PocketBase request event
- Return any JSON-able value. It's sent as text content, and also as `structuredContent` when it's a plain object.
- Throw to return a tool error (`isError: true`) the model can read and recover from.

Arguments are not validated against `inputSchema` for you; check what you rely on.

## Auth

The endpoint is protected by whatever middleware you put on the route. With `$apis.requireSuperuserAuth()`, a long-lived token for an agent can be minted with PocketBase's built-in impersonate API (static, non-refreshable tokens):

```bash
curl -X POST http://127.0.0.1:8090/api/collections/_superusers/impersonate/<SUPERUSER_ID> \
  -H "Authorization: <your superuser token>" \
  -H "content-type: application/json" \
  -d '{"duration": 31536000}'
```

PocketBase accepts it as `Authorization: Bearer <token>`. To revoke every token for that record, change its password or `tokenKey`.

For narrower access, protect the route with `$apis.requireAuth('agents')` for a dedicated auth collection, and check `auth` inside tools.

OAuth (needed by chat apps' "custom connector" flows) is not implemented.

## Connect a client

Claude Code:

```bash
claude mcp add --transport http my-app http://127.0.0.1:8090/mcp --header "Authorization: Bearer <token>"
```

Any client that supports Streamable HTTP with custom headers works the same way.

## Run the example

```bash
cd example
pocketbase superuser upsert you@example.com <password> --dir=pb_data
pocketbase serve --dir=pb_data
```

## Notes

- Protocol versions: `2025-11-25`, `2025-06-18`, `2025-03-26` (the client's version is echoed when supported, otherwise the newest).
- JSON-RPC batches are rejected (they were removed from MCP in 2025-06-18).
- The spec asks servers to validate the `Origin` header against DNS rebinding. Requiring a bearer token covers the main risk; add an `Origin` check in your route if you serve browsers on the same host.

## License

MIT
