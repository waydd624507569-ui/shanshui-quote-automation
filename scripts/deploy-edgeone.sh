#!/bin/zsh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

npm run sync
npm run protect
npm run build

npx --yes edgeone makers deploy dist \
  --name shanshui-quote-public \
  --env production \
  --area overseas \
  --skip-ai-gateway-sync

echo '已发布：https://quote.waydd.xyz/'
