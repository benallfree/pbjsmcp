# pbjsmcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that runs **inside PocketBase**, in `pb_hooks`. No sidecar process and no superuser password in an agent's config. It ships with tools for managing PocketBase itself, and you add tools for your app's own features next to them.

- No dependencies: [`mcp.js`](mcp.js) (the protocol) and [`pocketbase-tools.js`](pocketbase-tools.js) (built-in tools)
- MCP **Streamable HTTP** transport, stateless: each POST carries one JSON-RPC message and gets plain JSON back
- Auth is ordinary PocketBase route middleware
- Tools only (no resources, prompts or server-initiated messages yet)

## Quick start

Install it, either as a dependency:

```bash
npm i github:benallfree/pbjsmcp
```

or by copying `index.js`, `mcp.js` and `pocketbase-tools.js` into `pb_hooks/pbjsmcp/`. Then add a route:

```js
// pb_hooks/mcp.pb.js
routerAdd(
  'POST',
  '/mcp',
  (e) => {
    const { createMcpServer, pocketbaseTools } = require('pbjsmcp') // or `${__hooks}/pbjsmcp/index.js`
    return createMcpServer({
      name: 'my-app',
      version: '1.0.0',
      tools: [
        ...pocketbaseTools(),
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

## Built-in PocketBase tools

`pocketbaseTools()` returns these. They call `$app` directly, so they bypass collection API rules; every one of them requires a **superuser**, whatever the route allows.

| Group | Tools |
|---|---|
| `info` | `pb_server_info` |
| `collections` | `pb_list_collections`, `pb_get_collection`, `pb_create_collection`, `pb_update_collection`, `pb_delete_collection`, `pb_import_collections` |
| `records` | `pb_list_records` (filter, params, sort, paging, expand), `pb_get_record`, `pb_create_record`, `pb_update_record`, `pb_delete_record` |
| `settings` | `pb_get_settings`, `pb_update_settings` |
| `logs` | `pb_list_logs` |
| `backups` | `pb_list_backups`, `pb_create_backup` |

Pick a subset, or only the read-only ones:

```js
pocketbaseTools({ groups: ['collections', 'records'] })
pocketbaseTools({ readOnly: true })
```

Safety:

- Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`), so clients can ask before running destructive ones.
- `pb_delete_collection` needs `confirm` set to the collection name.
- `pb_import_collections` never deletes collections that aren't in the list.
- Records come back without hidden fields (passwords, token keys). PocketBase leaves SMTP and S3 secrets out of settings.
- Restoring backups and file uploads are not exposed.

## Your own tools

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
- Give tools that change data `annotations: { readOnlyHint: false, destructiveHint: true }` when they delete or overwrite.
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
