# PRI-1488 Scribble Bot Toolkit Handoff

Bot-toolkit should be consumed as `@primeradiant/bot-toolkit`.

Scribble should remove the private `file:./lib/bot-toolkit` dependency and bare
`bot-toolkit` imports. Replace source imports with scoped imports from
`@primeradiant/bot-toolkit`.

Scribble should keep its concrete Slack adapter in this workstream. The original
bot-toolkit architecture keeps concrete Slack/Bolt and email transport adapters
in consuming applications. Bot-toolkit provides core primitives and platform
identifiers only.

Required validation for Scribble:

```bash
npm install /absolute/path/to/primeradiant-bot-toolkit-0.1.0.tgz
npm run build
npm test
rg "from 'bot-toolkit'|from \"bot-toolkit\"" src
test ! -d node_modules/bot-toolkit
```

## Bot Toolkit Verification

Completed on 2026-05-04 from
`/Users/drewritter/prime-rad/sen/bot-toolkit`.

Package gate:

```bash
npm ci
npm run check
npm run build
npm test
npm pack --dry-run
npm pack
```

Outcome: all commands passed. The packed tarball was
`primeradiant-bot-toolkit-0.1.0.tgz`; the dry-run and real pack output included
only `LICENSE`, `README.md`, `package.json`, and compiled `dist/**` files.

Consumer smoke:

```bash
.tmp/consumer-smoke npm install
.tmp/consumer-smoke npx tsc --noEmit
.tmp/consumer-smoke runtime import check
.tmp/consumer-smoke test ! -d node_modules/bot-toolkit
```

Outcome: passed with scoped `@primeradiant/bot-toolkit` imports and
`skipLibCheck: false`.

Scribble smoke:

```bash
.tmp/scribble-smoke npm install
.tmp/scribble-smoke npm run build
.tmp/scribble-smoke npm test
.tmp/scribble-smoke npm run build:mcp
.tmp/scribble-smoke scoped-import and node_modules guards
```

Outcome: passed in a temporary copy of Scribble with `file:./lib/bot-toolkit`
removed, source/doc imports rewritten to `@primeradiant/bot-toolkit`, no
`node_modules/bot-toolkit`, and `node_modules/@primeradiant/bot-toolkit`
present.
