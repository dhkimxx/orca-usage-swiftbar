#!/usr/bin/env bash
# SwiftBar 플러그인 폴더에서 링크와 상태 파일을 지운다. --purge를 주면 SwiftBar 변수 설정도 지운다.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_FILE="orca-usage.1m.js"
VARS_FILE="orca-usage.1m.vars.json"
SWIFTBAR_DOMAIN="com.ameba.SwiftBar"
DEFAULT_PLUGIN_DIR="$HOME/.config/swiftbar/plugins"
CACHE_DIR="$HOME/Library/Caches/orca-usage-swiftbar"

PLUGIN_DIR="$(defaults read "$SWIFTBAR_DOMAIN" PluginDirectory 2>/dev/null || echo "$DEFAULT_PLUGIN_DIR")"
TARGET="$PLUGIN_DIR/$PLUGIN_FILE"

if [ -L "$TARGET" ] && [ "$(readlink "$TARGET")" = "$REPO_DIR/$PLUGIN_FILE" ]; then
	rm "$TARGET"
	echo "링크를 지웠습니다: $TARGET"
elif [ -e "$TARGET" ]; then
	echo "이 저장소에서 설치한 링크가 아니라 그대로 둡니다: $TARGET" >&2
fi

# install.sh가 옮겨 둔 백업(backup/)은 남기고 상태 파일만 지운다.
rm -f "$CACHE_DIR/state.json"
rmdir "$CACHE_DIR" 2>/dev/null || true

if [ "${1:-}" = "--purge" ]; then
	rm -f "$PLUGIN_DIR/$VARS_FILE"
	echo "설정 파일을 지웠습니다: $PLUGIN_DIR/$VARS_FILE"
fi

if pgrep -xq SwiftBar; then
	open -g "swiftbar://refreshallplugins"
fi
