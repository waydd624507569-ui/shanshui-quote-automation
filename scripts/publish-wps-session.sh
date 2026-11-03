#!/bin/zsh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
state_file="$HOME/.config/product-quote/wps-storage-state.json"
password_file="$HOME/.config/product-quote/customer-password"
repo_url="https://github.com/waydd624507569-ui/shanshui-quote-automation.git"
temp_dir="$(mktemp -d /tmp/shanshui-wps-session.XXXXXX)"

cleanup() {
  rm -rf "$temp_dir"
}
trap cleanup EXIT

test -f "$state_file"
test -f "$password_file"

CATALOG_PASSPHRASE="$(cat "$password_file")" openssl enc -aes-256-cbc -pbkdf2 -salt \
  -pass env:CATALOG_PASSPHRASE \
  -in "$state_file" \
  -out "$root/secrets/wps-state.enc"

git clone --depth 1 "$repo_url" "$temp_dir/repo"
mkdir -p "$temp_dir/repo/secrets"
cp "$root/secrets/wps-state.enc" "$temp_dir/repo/secrets/wps-state.enc"
date +%s > "$temp_dir/repo/last-wps-refresh"
git -C "$temp_dir/repo" config user.name 'quote-sync-bot'
git -C "$temp_dir/repo" config user.email 'quote-sync-bot@users.noreply.github.com'
git -C "$temp_dir/repo" add secrets/wps-state.enc last-wps-refresh
git -C "$temp_dir/repo" commit -m 'chore: reauthorize WPS session'
git -C "$temp_dir/repo" push origin main

gh workflow run sync-quote.yml --repo waydd624507569-ui/shanshui-quote-automation
echo 'WPS 登录态已更新，并已触发云端同步。'
