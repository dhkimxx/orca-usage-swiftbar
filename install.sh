#!/usr/bin/env bash
# SwiftBar 플러그인 폴더에 이 저장소의 플러그인을 심볼릭 링크로 연결한다.
# 여러 번 실행해도 같은 결과가 되며, 이후 업데이트는 git pull만 하면 된다.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_FILE="orca-usage.1m.js"
ORCA_APP="/Applications/Orca.app"
SWIFTBAR_APP="/Applications/SwiftBar.app"
SWIFTBAR_DOMAIN="com.ameba.SwiftBar"
DEFAULT_PLUGIN_DIR="$HOME/.config/swiftbar/plugins"
BACKUP_DIR="$HOME/Library/Caches/orca-usage-swiftbar/backup"

if [ ! -d "$ORCA_APP" ]; then
	echo "Orca가 설치돼 있지 않습니다: $ORCA_APP" >&2
	exit 1
fi

if [ ! -d "$SWIFTBAR_APP" ]; then
	if ! command -v brew >/dev/null 2>&1; then
		echo "SwiftBar를 설치하려면 Homebrew가 필요합니다: https://brew.sh" >&2
		exit 1
	fi
	echo "SwiftBar 설치 중..."
	brew install --cask swiftbar
fi

PLUGIN_DIR="$(defaults read "$SWIFTBAR_DOMAIN" PluginDirectory 2>/dev/null || true)"
if [ -z "$PLUGIN_DIR" ]; then
	PLUGIN_DIR="$DEFAULT_PLUGIN_DIR"
	defaults write "$SWIFTBAR_DOMAIN" PluginDirectory "$PLUGIN_DIR"
	echo "SwiftBar 플러그인 폴더를 지정했습니다: $PLUGIN_DIR"
fi
mkdir -p "$PLUGIN_DIR"

TARGET="$PLUGIN_DIR/$PLUGIN_FILE"
if [ -L "$TARGET" ]; then
	rm "$TARGET"
elif [ -e "$TARGET" ]; then
	# 플러그인 폴더 안에 두면 SwiftBar가 플러그인으로 읽으므로 폴더 밖으로 옮긴다.
	mkdir -p "$BACKUP_DIR"
	BACKUP="$BACKUP_DIR/$PLUGIN_FILE.$(date +%Y%m%d%H%M%S)"
	mv "$TARGET" "$BACKUP"
	echo "기존 플러그인 파일을 옮겼습니다: $BACKUP"
fi

chmod +x "$REPO_DIR/$PLUGIN_FILE"
ln -s "$REPO_DIR/$PLUGIN_FILE" "$TARGET"

if pgrep -xq SwiftBar; then
	open -g "swiftbar://refreshallplugins"
else
	open -a SwiftBar
fi

echo "설치 완료: $TARGET -> $REPO_DIR/$PLUGIN_FILE"
