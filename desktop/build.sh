#!/bin/sh
# Build the desktop pet: desktop/build/Xiaojing.app (the web viewer copied in, ad-hoc signed). Needs the Xcode command line tools.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
APP="$HERE/build/Xiaojing.app"
WORKSPACE=$(cd "$HERE/../../.." && pwd)
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
swiftc -O -target "$(uname -m)-apple-macosx14.0" "$HERE/main.swift" "$HERE/Companion.swift" "$HERE/ObservationPolicy.swift" "$HERE/ChatPanel.swift" "$HERE/Roaming.swift" "$HERE/ModelSettings.swift" \
  -o "$APP/Contents/MacOS/Xiaojing" -framework Cocoa -framework WebKit -framework ScreenCaptureKit -framework Carbon -framework Security
# the viewer, without the models pet mode does not load (v1, the retopology experiment)
rsync -a --exclude 'assets/xiaojing.glb' --exclude 'assets/xiaojing-v2r.glb' "$HERE/../web/" "$APP/Contents/Resources/web/"
cp "$HERE/../companion/worker.py" "$APP/Contents/Resources/companion.py"
cp "$HERE/../companion/model.cjs" "$HERE/../companion/node-worker.cjs" "$HERE/../companion/system.txt" "$APP/Contents/Resources/"
NODE_BIN=$(command -v node)
cp "$NODE_BIN" "$APP/Contents/MacOS/node"
cp "$(dirname "$NODE_BIN")/../LICENSE" "$APP/Contents/Resources/Node-LICENSE.txt"
codesign -s - --force "$APP/Contents/MacOS/node" 2>/dev/null
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>小鲸</string>
<key>CFBundleIdentifier</key><string>io.opengrove.xiaojing-pet</string>
<key>CFBundleExecutable</key><string>Xiaojing</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.6</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSScreenCaptureUsageDescription</key><string>小鲸偶尔看一眼你允许的应用当前窗口，并交给云端模型生成陪伴气泡。不会保存截图。</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
/usr/libexec/PlistBuddy -c "Add :XJWorkspaceRoot string $WORKSPACE" "$APP/Contents/Info.plist"
codesign -s - --force --deep "$APP" 2>/dev/null
du -sh "$APP" | cut -f1; echo "$APP"
