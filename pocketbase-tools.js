// pbjsmcp: built-in PocketBase admin tools.
// https://github.com/benallfree/pbjsmcp  (MIT)
//
// These call $app directly (in-process), so they bypass collection API rules.
// Every tool therefore requires a superuser, even if the route lets others in.
//
//   const { pocketbaseTools } = require(...)
//   tools: [...pocketbaseTools(), ...myTools]
//   tools: [...pocketbaseTools({ groups: ['collections', 'records'], readOnly: true })]
//
// Groups: info, collections, records, settings, logs, backups

const ALL_GROUPS = ['info', 'collections', 'records', 'settings', 'logs', 'backups']

const READ = { readOnlyHint: true }
const WRITE = { readOnlyHint: false, destructiveHint: false }
const DESTROY = { readOnlyHint: false, destructiveHint: true }

const toJson = (v) => JSON.parse(JSON.stringify(v))

const requireSuperuser = (auth) => {
  if (!auth || !auth.isSuperuser()) throw new Error('This tool requires a superuser.')
}

const str = (v) => (v === undefined || v === null ? '' : `${v}`)
const int = (v, fallback, min, max) => Math.max(min, Math.min(max, parseInt(v, 10) || fallback))
const splitList = (v) =>
  Array.isArray(v) ? v : str(v).split(',').map((s) => s.trim()).filter(Boolean)

const findCollection = (nameOrId) => {
  try {
    return $app.findCollectionByNameOrId(str(nameOrId))
  } catch (_) {
    throw new Error(`Collection "${str(nameOrId)}" not found. Use pb_list_collections to see what exists.`)
  }
}

const findRecord = (collection, id) => {
  const c = findCollection(collection)
  try {
    return $app.findRecordById(c, str(id))
  } catch (_) {
    throw new Error(`Record "${str(id)}" not found in "${c.name}".`)
  }
}

const exportRecord = (record, expand) => {
  record.ignoreEmailVisibility(true)
  if (expand && expand.length) $app.expandRecord(record, expand, null)
  return toJson(record)
}

const collectionSummary = (c) => ({
  id: c.id,
  name: c.name,
  type: c.type,
  system: c.system,
  fields: c.fields.map((f) => `${f.getName()}:${f.type()}`),
})

const collectionArg = { type: 'string', description: 'Collection name or id' }

const tools = [
  // ---------------------------------------------------------------- info
  {
    group: 'info',
    name: 'pb_server_info',
    description: 'PocketBase app name/URL, dev mode, collection counts, and which auth record this connection uses.',
    annotations: READ,
    handler: ({ auth }) => {
      const meta = $app.settings().meta
      const all = $app.findAllCollections()
      return {
        appName: meta.appName,
        appURL: meta.appURL,
        isDev: $app.isDev(),
        collections: { total: all.length, user: all.filter((c) => !c.system).length },
        auth: { id: auth.id, collection: auth.collection().name, email: auth.email() },
      }
    },
  },

  // ---------------------------------------------------------- collections
  {
    group: 'collections',
    name: 'pb_list_collections',
    description: 'List collections with id, type and fields (name:type).',
    annotations: READ,
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['base', 'auth', 'view'] },
        includeSystem: { type: 'boolean', default: false },
      },
    },
    handler: ({ args }) => {
      const list = args.type ? $app.findAllCollections(args.type) : $app.findAllCollections()
      return { collections: list.filter((c) => args.includeSystem || !c.system).map(collectionSummary) }
    },
  },
  {
    group: 'collections',
    name: 'pb_get_collection',
    description: 'Full definition of one collection: fields with options, API rules, indexes, auth options.',
    annotations: READ,
    inputSchema: { type: 'object', properties: { collection: collectionArg }, required: ['collection'] },
    handler: ({ args }) => toJson(findCollection(args.collection)),
  },
  {
    group: 'collections',
    name: 'pb_create_collection',
    description:
      'Create a collection. `collection` uses the same JSON shape as the PocketBase collections API ' +
      '(name, type, fields, listRule/viewRule/createRule/updateRule/deleteRule, indexes). ' +
      'Rules default to null (superuser only).',
    annotations: WRITE,
    inputSchema: {
      type: 'object',
      properties: {
        collection: {
          type: 'object',
          description: 'e.g. {"name":"posts","type":"base","fields":[{"name":"title","type":"text","required":true}]}',
        },
      },
      required: ['collection'],
    },
    handler: ({ args }) => {
      const c = new Collection(args.collection || {})
      $app.save(c)
      return toJson(c)
    },
  },
  {
    group: 'collections',
    name: 'pb_update_collection',
    description:
      'Update a collection by merging `changes` onto it (same JSON shape as the collections API). ' +
      'Careful: `fields` and `indexes` REPLACE the whole list. To keep a field, include it with its existing id ' +
      '(get it from pb_get_collection first). A field left out is dropped along with its data.',
    annotations: DESTROY,
    inputSchema: {
      type: 'object',
      properties: { collection: collectionArg, changes: { type: 'object' } },
      required: ['collection', 'changes'],
    },
    handler: ({ args }) => {
      const c = findCollection(args.collection)
      unmarshal(args.changes || {}, c)
      $app.save(c)
      return toJson(c)
    },
  },
  {
    group: 'collections',
    name: 'pb_delete_collection',
    description: 'Delete a collection and ALL its records. `confirm` must repeat the collection name.',
    annotations: DESTROY,
    inputSchema: {
      type: 'object',
      properties: { collection: collectionArg, confirm: { type: 'string' } },
      required: ['collection', 'confirm'],
    },
    handler: ({ args }) => {
      const c = findCollection(args.collection)
      if (str(args.confirm) !== c.name) throw new Error(`confirm must be "${c.name}"`)
      $app.delete(c)
      return { deleted: c.name }
    },
  },
  {
    group: 'collections',
    name: 'pb_import_collections',
    description:
      'Create or update several collections in one transaction (matched by id, then name). ' +
      'Existing collections not in the list are left alone.',
    annotations: WRITE,
    inputSchema: {
      type: 'object',
      properties: { collections: { type: 'array', items: { type: 'object' }, minItems: 1 } },
      required: ['collections'],
    },
    handler: ({ args }) => {
      $app.importCollections(args.collections || [], false)
      return { imported: (args.collections || []).map((c) => c.name || c.id) }
    },
  },

  // -------------------------------------------------------------- records
  {
    group: 'records',
    name: 'pb_list_records',
    description:
      'List records. `filter` and `sort` use PocketBase syntax, e.g. filter "status = {:s} && created > \'2026-01-01\'" ' +
      'with params {"s":"active"}, sort "-created". Hidden fields (passwords, tokens) are never returned.',
    annotations: READ,
    inputSchema: {
      type: 'object',
      properties: {
        collection: collectionArg,
        filter: { type: 'string' },
        params: { type: 'object', description: 'Values for {:name} placeholders in filter' },
        sort: { type: 'string', default: '-created' },
        page: { type: 'integer', minimum: 1, default: 1 },
        perPage: { type: 'integer', minimum: 1, maximum: 500, default: 30 },
        expand: { type: 'string', description: 'Comma-separated relation fields' },
      },
      required: ['collection'],
    },
    handler: ({ args }) => {
      const collection = findCollection(args.collection)
      const page = int(args.page, 1, 1, 1e9)
      const perPage = int(args.perPage, 30, 1, 500)
      const sort = args.sort === undefined ? (collection.fields.getByName('created') ? '-created' : '') : str(args.sort)
      // Fetch one extra row to know whether there's another page.
      const rows = $app.findRecordsByFilter(
        collection,
        str(args.filter),
        sort,
        perPage + 1,
        (page - 1) * perPage,
        args.params || {}
      )
      const expand = splitList(args.expand)
      return {
        page,
        perPage,
        hasMore: rows.length > perPage,
        items: rows.slice(0, perPage).map((r) => exportRecord(r, expand)),
      }
    },
  },
  {
    group: 'records',
    name: 'pb_get_record',
    description: 'Get one record by id.',
    annotations: READ,
    inputSchema: {
      type: 'object',
      properties: { collection: collectionArg, id: { type: 'string' }, expand: { type: 'string' } },
      required: ['collection', 'id'],
    },
    handler: ({ args }) =>
      exportRecord(findRecord(args.collection, args.id), splitList(args.expand)),
  },
  {
    group: 'records',
    name: 'pb_create_record',
    description:
      'Create a record. For auth collections include "password" (and "passwordConfirm" is not needed). ' +
      'File fields are not supported here.',
    annotations: WRITE,
    inputSchema: {
      type: 'object',
      properties: { collection: collectionArg, data: { type: 'object' } },
      required: ['collection', 'data'],
    },
    handler: ({ args }) => {
      const record = new Record(findCollection(args.collection))
      record.load(args.data || {})
      $app.save(record)
      return exportRecord(record)
    },
  },
  {
    group: 'records',
    name: 'pb_update_record',
    description: 'Update fields on one record. Only the keys in `data` change.',
    annotations: WRITE,
    inputSchema: {
      type: 'object',
      properties: { collection: collectionArg, id: { type: 'string' }, data: { type: 'object' } },
      required: ['collection', 'id', 'data'],
    },
    handler: ({ args }) => {
      const record = findRecord(args.collection, args.id)
      record.load(args.data || {})
      $app.save(record)
      return exportRecord(record)
    },
  },
  {
    group: 'records',
    name: 'pb_delete_record',
    description: 'Delete one record (cascades follow the collection relation settings).',
    annotations: DESTROY,
    inputSchema: {
      type: 'object',
      properties: { collection: collectionArg, id: { type: 'string' } },
      required: ['collection', 'id'],
    },
    handler: ({ args }) => {
      const record = findRecord(args.collection, args.id)
      $app.delete(record)
      return { deleted: record.id }
    },
  },

  // ------------------------------------------------------------- settings
  {
    group: 'settings',
    name: 'pb_get_settings',
    description: 'App settings (meta, smtp, s3, backups, rate limits, logs, batch, trusted proxy). Secrets are redacted.',
    annotations: READ,
    handler: () => {
      const s = toJson($app.settings())
      if (s.smtp && s.smtp.password) s.smtp.password = '******'
      if (s.s3 && s.s3.secret) s.s3.secret = '******'
      if (s.backups && s.backups.s3 && s.backups.s3.secret) s.backups.s3.secret = '******'
      return s
    },
  },
  {
    group: 'settings',
    name: 'pb_update_settings',
    description:
      'Merge `changes` into the app settings, e.g. {"meta":{"appName":"Acme"}} or {"smtp":{"enabled":true,"host":"..."}}. ' +
      'Nested objects merge; arrays replace.',
    annotations: WRITE,
    inputSchema: { type: 'object', properties: { changes: { type: 'object' } }, required: ['changes'] },
    handler: ({ args }) => {
      const s = $app.settings()
      unmarshal(args.changes || {}, s)
      $app.save(s)
      return { updated: Object.keys(args.changes || {}) }
    },
  },

  // ----------------------------------------------------------------- logs
  {
    group: 'logs',
    name: 'pb_list_logs',
    description: 'Recent request and app logs, newest first.',
    annotations: READ,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        minLevel: { type: 'integer', description: '-4 debug, 0 info, 4 warn, 8 error', default: -4 },
        search: { type: 'string', description: 'Substring match on the message' },
      },
    },
    handler: ({ args }) => {
      const rows = arrayOf(new DynamicModel({ id: '', created: '', level: 0, message: '', data: '' }))
      let q = $app
        .logQuery()
        .andWhere($dbx.exp('level >= {:lvl}', { lvl: parseInt(args.minLevel, 10) || -4 }))
      if (args.search) q = q.andWhere($dbx.like('message', str(args.search)))
      q.orderBy('created DESC').limit(int(args.limit, 50, 1, 200)).all(rows)
      return {
        logs: rows.map((r) => {
          let data = r.data
          try {
            data = JSON.parse(r.data)
          } catch (_) {}
          return { id: r.id, created: r.created, level: r.level, message: r.message, data }
        }),
      }
    },
  },

  // -------------------------------------------------------------- backups
  {
    group: 'backups',
    name: 'pb_list_backups',
    description: 'List backup files, newest first.',
    annotations: READ,
    handler: () => {
      const fsys = $app.newBackupsFilesystem()
      try {
        const files = fsys.list('').sort((a, b) => b.modTime.unix() - a.modTime.unix())
        return { backups: files.map((f) => ({ key: f.key, size: f.size, modified: f.modTime.utc().format('2006-01-02 15:04:05.000Z') })) }
      } finally {
        fsys.close()
      }
    },
  },
  {
    group: 'backups',
    name: 'pb_create_backup',
    description: 'Create a backup zip of pb_data now. Restoring is intentionally not exposed.',
    annotations: WRITE,
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Optional, must end in .zip' } },
    },
    handler: ({ args, e }) => {
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
      const name = args.name ? str(args.name) : `mcp_${stamp}.zip`
      $app.createBackup(e.request.context(), name)
      return { created: name }
    },
  },
]

const pocketbaseTools = (options) => {
  const opts = options || {}
  const groups = opts.groups || ALL_GROUPS
  return tools
    .filter((t) => groups.indexOf(t.group) >= 0)
    .filter((t) => !opts.readOnly || t.annotations.readOnlyHint)
    .map((t) => ({
      name: t.name,
      description: t.description,
      annotations: t.annotations,
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
      handler: (ctx) => {
        requireSuperuser(ctx.auth)
        return t.handler(ctx)
      },
    }))
}

module.exports = { pocketbaseTools, POCKETBASE_TOOL_GROUPS: ALL_GROUPS }
