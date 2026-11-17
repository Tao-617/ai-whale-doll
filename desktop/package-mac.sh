#!/bin/sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
OUT="$HERE/dist"
STAGE="$HERE/package-stage"
mkdir -p "$OUT"
rm -rf "$STAGE"
mkdir -p "$STAGE"
ditto "$HERE/build/Xiaojing.app" "$STAGE/Xiaojing.app"
# Release bundles never refer to the author's workspace or include its model configuration.
/usr/libexec/PlistBuddy -c 'Delete :XJWorkspaceRoot' "$STAGE/Xiaojing.app/Contents/Info.plist" 2>/dev/null || true
codesign -s - --force --deep "$STAGE/Xiaojing.app" 2>/dev/null
codesign --verify --strict --deep "$STAGE/Xiaojing.app"
ln -s /Applications "$STAGE/Applications"
cp "$HERE/../docs/install-0.6.txt" "$STAGE/使用说明.txt"
hdiutil create -ov -format UDZO -fs HFS+ -volname Xiaojing -srcfolder "$STAGE" "$OUT/Xiaojing-0.6.1-macOS-$(uname -m).dmg"
