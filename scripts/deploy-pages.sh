#!/bin/zsh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
repo_url="https://github.com/waydd624507569-ui/shanshui-quote.git"
deploy_dir="$(mktemp -d /tmp/shanshui-quote-pages.XXXXXX)"

cleanup() {
  rm -rf "$deploy_dir"
}
trap cleanup EXIT

cd "$root"
npm run sync
npm run protect
export VITE_CATALOG_PASSPHRASE="$(cat "$HOME/.config/product-quote/customer-password")"
VITE_BASE=/shanshui-quote/ npm run build

git clone --depth 1 "$repo_url" "$deploy_dir/repo"
rsync -a --delete --exclude='.git' "$root/dist/" "$deploy_dir/repo/"
git -C "$deploy_dir/repo" config user.name 'waydd624507569-ui'
git -C "$deploy_dir/repo" config user.email 'waydd624507569-ui@users.noreply.github.com'
git -C "$deploy_dir/repo" add -A

if git -C "$deploy_dir/repo" diff --cached --quiet; then
  echo '报价没有变化，无需重新发布。'
  exit 0
fi

git -C "$deploy_dir/repo" commit -m "Update quote site $(date '+%Y-%m-%d %H:%M')"
git -C "$deploy_dir/repo" push origin main
echo '已发布：https://waydd624507569-ui.github.io/shanshui-quote/'
