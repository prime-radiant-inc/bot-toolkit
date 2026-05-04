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
