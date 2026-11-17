// Xiaojing as a desktop pet / wallpaper: a transparent, borderless window holding the web viewer in pet mode
// (web/pet.js, ?pet=1). Build: desktop/build.sh → desktop/build/Xiaojing.app
//   pet        floats above other windows; the mouse reaches her only where she is drawn (the page is asked 20 times a
//              second whether the pointer is on her), everywhere else it goes through to what is underneath.
//              Hold and move the mouse on her to carry her: the page says "grab", this follows the mouse with the
//              window and tells the page how far it moved (she swings) until the button is released.
//   wallpaper  the same window on the desktop layer, behind the icons, never taking the mouse.
// The page is served from the bundle through the xj:// scheme (ES modules and fetch do not work from file://).
// XJ_URL=http://127.0.0.1:8812/?pet=1 loads a dev server instead; XJ_DEBUG=1 prints the page's errors.
import Cocoa
import WebKit
import Darwin

final class Files: NSObject, WKURLSchemeHandler {
    let root: URL
    init(root: URL) { self.root = root.standardizedFileURL }
    static let mime = ["html": "text/html", "js": "text/javascript", "mjs": "text/javascript", "json": "application/json", "css": "text/css",
                       "glb": "model/gltf-binary", "png": "image/png", "jpg": "image/jpeg", "txt": "text/plain"]
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let url = task.request.url!
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist)); return
        }
        let type = Files.mime[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                   headerFields: ["Content-Type": type, "Content-Length": "\(data.count)", "Access-Control-Allow-Origin": "*"])!
        task.didReceive(resp); task.didReceive(data); task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class PetView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class App: NSObject, NSApplicationDelegate, WKScriptMessageHandler, NSMenuDelegate {
    var window: NSPanel!
    var web: PetView!
    var status: NSStatusItem!
    var dragging = false, last = NSPoint.zero, tickNo = 0, wallpaper = false
    // Where the window is = where the mouse carried it (origin) + how far the page shifted it to keep her framed (shift),
    // both kept exactly here and only rounded when applied: reading the window's own frame back loses the fractions.
    var origin = NSPoint.zero, shift = NSPoint.zero
    func place() { window.setFrameOrigin(NSPoint(x: (origin.x + shift.x).rounded(), y: (origin.y + shift.y).rounded())) }
    func adopt() { origin = NSPoint(x: window.frame.minX - shift.x, y: window.frame.minY - shift.y) }
    let sizes: [(String, NSSize)] = [("小", NSSize(width: 260, height: 346)), ("中", NSSize(width: 360, height: 480)), ("大", NSSize(width: 520, height: 692))]
    let store = UserDefaults.standard
    let companion = Companion()
    let chat = ChatPanel()
    let modelSettings = ModelSettings()
    var lively = true, menuOpen = false, strollChatter = true
    var roam: RoamPath?, roamID = 0
    var visitSource: ObservedWindow?, visitToken: UUID?
    var visitCompletion: ((Bool) -> Void)?
    var hitPending = false
    var lastHost = ""
    var lastDisplayArea: CGRect?
    var pointer = NSPoint.zero, pointerIntentUntil: TimeInterval = 0, visitArrivedUntil: TimeInterval = 0
    var canWander: Bool { lively && companion.ready && companion.awake && !wallpaper && !dragging && !chat.panel.isVisible && !menuOpen }

    func applicationDidFinishLaunching(_ note: Notification) {
        lively = store.object(forKey: "lively") as? Bool ?? true
        strollChatter = store.object(forKey: "strollChatter") as? Bool ?? true
        let conf = WKWebViewConfiguration()
        let web = Bundle.main.resourceURL!.appendingPathComponent("web")
        conf.setURLSchemeHandler(Files(root: web), forURLScheme: "xj")
        conf.userContentController.add(self, name: "pet")
        if ProcessInfo.processInfo.environment["XJ_DEBUG"] != nil {
            let js = "window.addEventListener('error', e => webkit.messageHandlers.pet.postMessage({type: 'log', text: String(e.message) + ' ' + (e.filename || '') + ':' + e.lineno}));" +
                     "window.addEventListener('unhandledrejection', e => webkit.messageHandlers.pet.postMessage({type: 'log', text: 'rejection ' + String(e.reason)}));"
            conf.userContentController.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let size = sizes[min(max(store.object(forKey: "size") as? Int ?? 1, 0), 2)].1
        let screen = NSScreen.main!.visibleFrame
        var origin = NSPoint(x: screen.maxX - size.width - 40, y: screen.minY)
        if let x = store.object(forKey: "x") as? Double, let y = store.object(forKey: "y") as? Double { origin = NSPoint(x: x, y: y) }
        window = NSPanel(contentRect: NSRect(origin: origin, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        window.isOpaque = false; window.backgroundColor = .clear; window.hasShadow = false
        window.isFloatingPanel = true; window.hidesOnDeactivate = false; window.becomesKeyOnlyIfNeeded = true
        window.ignoresMouseEvents = true
        self.web = PetView(frame: NSRect(origin: .zero, size: size), configuration: conf)
        self.web.setValue(false, forKey: "drawsBackground")
        self.web.autoresizingMask = [.width, .height]
        window.contentView = self.web
        keepOnScreen(); adopt()
        setWallpaper(store.bool(forKey: "wallpaper"))
        if let dev = ProcessInfo.processInfo.environment["XJ_URL"], let u = URL(string: dev) { self.web.load(URLRequest(url: u)) }
        else { self.web.load(URLRequest(url: URL(string: "xj://app/index.html?pet=1")!)) }
        window.orderFrontRegardless()

        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.title = "🐳"
        companion.changed = { [weak self] in self?.rebuildMenu() }
        companion.interacting = { [weak self] in
            guard let self = self else { return true }
            return self.dragging || self.wallpaper || self.chat.panel.isKeyWindow ||
                (self.roam != nil && self.visitToken == nil) ||
                (self.lively && !RoamPath.onEdge(self.window.frame.origin,in:self.roamArea()) &&
                 self.visitToken == nil && ProcessInfo.processInfo.systemUptime > self.visitArrivedUntil)
        }
        companion.speak = { [weak self] reply in
            guard let self = self, let data = try? JSONSerialization.data(withJSONObject: reply),
                  let json = String(data: data, encoding: .utf8) else { return }
            self.stopRoaming()
            self.visitArrivedUntil = 0
            self.web.evaluateJavaScript("window.xj && xj.companionReply(\(json))", completionHandler: nil)
        }
        companion.chatEvent = { [weak self] role, text in self?.chat.event(role, text) }
        companion.approach = { [weak self] source, point, done in self?.approachObservation(source, focus: point, done: done) ?? false }
        companion.cancelApproach = { [weak self] in
            if self?.visitToken != nil { self?.stopRoaming() }
        }
        chat.onSend = { [weak self] text in self?.companion.chat(text) }
        companion.modelConfig = { [weak self] in self?.modelSettings.config() }
        rebuildMenu()
        let t = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(t, forMode: .common)
    }

    func rebuildMenu() {
        // Also expose state on the borderless panel for accessibility and local verification.
        window.title = "小鲸 · 观察" + (companion.enabled ? "开启" : "暂停") + " · 位置联动" +
            (companion.approachEnabled ? "开启" : "关闭") + " · " + companion.status
        let menu = status.menu ?? NSMenu()
        menu.removeAllItems(); menu.delegate = self
        status.button?.title = companion.enabled ? "🐳·" : "🐳"
        status.button?.toolTip = companion.status
        let info = menu.addItem(withTitle: companion.status, action: nil, keyEquivalent: ""); info.isEnabled = false
        let observing = menu.addItem(withTitle: companion.enabled ? "暂停观察" : "开启观察", action: #selector(toggleObservation), keyEquivalent: "")
        observing.target = self; observing.state = companion.enabled ? .on : .off
        let appMenu = NSMenu(title: "允许观察的应用")
        var apps: [String: String] = Dictionary(uniqueKeysWithValues: companion.allowed.map { ($0, $0) })
        for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
            if let id = app.bundleIdentifier, companion.selectable(id) { apps[id] = app.localizedName ?? id }
        }
        for (id, name) in apps.sorted(by: { $0.value.localizedCompare($1.value) == .orderedAscending }) {
            let item = appMenu.addItem(withTitle: name, action: #selector(toggleObservedApp(_:)), keyEquivalent: "")
            item.target = self; item.representedObject = id; item.state = companion.allowed.contains(id) ? .on : .off
        }
        let appItem = menu.addItem(withTitle: "允许观察的应用", action: nil, keyEquivalent: ""); appItem.submenu = appMenu
        let peek = menu.addItem(withTitle: "看一眼当前窗口", action: #selector(peekNow), keyEquivalent: ""); peek.target = self
        let talk = menu.addItem(withTitle: "和小鲸聊一句…", action: #selector(openChat), keyEquivalent: ""); talk.target = self
        let model = menu.addItem(withTitle:"模型设置…",action:#selector(openModelSettings),keyEquivalent:""); model.target = self
        let cadence = menu.addItem(withTitle: "每分钟搭一句 · 无新操作时安静", action: nil, keyEquivalent: ""); cadence.isEnabled = false
        let privacy = menu.addItem(withTitle: "只看当前窗口 · 内容发送到云端模型", action: nil, keyEquivalent: ""); privacy.isEnabled = false
        menu.addItem(.separator())
        let a = menu.addItem(withTitle: "桌宠（置顶，可以抓）", action: #selector(modePet), keyEquivalent: ""); a.target = self; a.state = wallpaper ? .off : .on
        let b = menu.addItem(withTitle: "壁纸（在图标后面）", action: #selector(modeWall), keyEquivalent: ""); b.target = self; b.state = wallpaper ? .on : .off
        let life = menu.addItem(withTitle: "自由活动（跑动和小动作）", action: #selector(toggleLively), keyEquivalent: "")
        life.target = self; life.state = lively ? .on : .off
        let chatter = menu.addItem(withTitle: "跑动时偶尔闲聊", action: #selector(toggleChatter), keyEquivalent: "")
        chatter.target = self; chatter.state = strollChatter ? .on : .off
        let approach = menu.addItem(withTitle: "截图后主动靠近内容（说完回边缘）", action: #selector(toggleApproach), keyEquivalent: "")
        approach.target = self; approach.state = companion.approachEnabled ? .on : .off
        menu.addItem(.separator())
        let cur = store.object(forKey: "size") as? Int ?? 1
        for (i, s) in sizes.enumerated() {
            let it = menu.addItem(withTitle: "大小：" + s.0, action: #selector(setSize(_:)), keyEquivalent: ""); it.target = self; it.tag = i; it.state = i == cur ? .on : .off
        }
        menu.addItem(.separator())
        let c = menu.addItem(withTitle: "回到屏幕右下角", action: #selector(home), keyEquivalent: ""); c.target = self
        let q = menu.addItem(withTitle: "退出", action: #selector(quit), keyEquivalent: "q"); q.target = self
        status.menu = menu
    }
    func menuNeedsUpdate(_ menu: NSMenu) { if menu === status.menu { rebuildMenu() } }
    func menuWillOpen(_ menu: NSMenu) { menuOpen = true; stopRoaming(); sendHost() }
    func menuDidClose(_ menu: NSMenu) { menuOpen = false; sendHost() }
    @objc func toggleLively() {
        lively.toggle(); store.set(lively, forKey: "lively")
        stopRoaming(); sendHost(); rebuildMenu()
    }
    @objc func toggleChatter() {
        strollChatter.toggle(); store.set(strollChatter, forKey: "strollChatter"); sendHost(); rebuildMenu()
    }
    @objc func toggleApproach() {
        companion.approachEnabled.toggle(); store.set(companion.approachEnabled, forKey: "observationApproach")
        if !companion.approachEnabled && visitToken != nil { stopRoaming() }
        rebuildMenu()
    }
    @objc func toggleObservation() { companion.toggle() }
    @objc func toggleObservedApp(_ item: NSMenuItem) { if let id = item.representedObject as? String { companion.toggleApp(id) } }
    @objc func peekNow() {
        if companion.enabled { companion.tick(manual: true) }
        else { companion.setStatus("先开启观察，再请小鲸看一眼") }
    }
    @objc func openChat() {
        stopRoaming()
        chat.event("state", companion.busy ? "小鲸正在想…" : "")
        chat.open()
        sendHost()
    }
    @objc func openModelSettings() { companion.pause(); restLife(); modelSettings.open() }
    @objc func modePet() { setWallpaper(false) }
    @objc func modeWall() { setWallpaper(true) }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationWillTerminate(_ note: Notification) { companion.pause() }
    @objc func home() {
        restLife()
        let s = NSScreen.main!.visibleFrame
        window.setFrameOrigin(NSPoint(x: s.maxX - window.frame.width - 40, y: s.minY)); adopt(); savePlace()
    }
    @objc func setSize(_ item: NSMenuItem) {
        let screen = roamScreen().visibleFrame, f = window.frame
        restLife()
        let size = sizes[item.tag].1
        window.setFrame(RoamPath.resizedFrame(f, to: size, screen: screen), display: true)
        store.set(item.tag, forKey: "size"); adopt(); savePlace(); lastDisplayArea = roamArea(); sendHost(); rebuildMenu()
    }
    func setWallpaper(_ on: Bool) {
        stopRoaming()
        if on { companion.pause() }
        wallpaper = on; store.set(on, forKey: "wallpaper")
        if on {
            window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 1)
            window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
            window.ignoresMouseEvents = true
        } else {
            window.level = .floating
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        }
        if status != nil { rebuildMenu() }
        sendHost()
    }
    func savePlace() { store.set(Double(window.frame.minX), forKey: "x"); store.set(Double(window.frame.minY), forKey: "y") }
    // at least a third of her stays on some screen, so she can always be taken back
    func keepOnScreen() {
        let f = window.frame
        guard !NSScreen.screens.contains(where: { $0.frame.intersection(f).width > f.width / 3 && $0.frame.intersection(f).height > f.height / 3 }) else { return }
        let s = NSScreen.main!.visibleFrame
        window.setFrameOrigin(NSPoint(x: s.maxX - f.width - 40, y: s.minY))
    }

    func roamScreen() -> NSScreen {
        let f = window.frame
        let screen = NSScreen.screens.max { a, b in
            let aa = a.visibleFrame.intersection(f), bb = b.visibleFrame.intersection(f)
            return (aa.isNull ? 0 : aa.width * aa.height) < (bb.isNull ? 0 : bb.width * bb.height)
        } ?? NSScreen.main!
        return screen
    }
    func roamArea() -> CGRect { RoamPath.area(screen: roamScreen().visibleFrame, size: window.frame.size) }
    func startRoaming(running: Bool) {
        guard canWander, roam == nil, visitToken == nil else { return }
        let area = roamArea(), start = RoamPath.clamp(window.frame.origin, to: area)
        let recovering = !RoamPath.onEdge(start,in:area)
        guard area.width+area.height >= 45,
              recovering || (!companion.busy && !companion.waitingToSpeak),
              !(companion.waitingToSpeak && ProcessInfo.processInfo.systemUptime < visitArrivedUntil) else { return }
        let target = RoamPath.wanderTarget(from: start,in:area,fraction:CGFloat.random(in:0...1))
        roamID += 1
        guard let path = RoamPath.make(from: start, area: area, target: target, now: ProcessInfo.processInfo.systemUptime,
                                       scale: window.frame.width / 360, running: running, id: roamID) else { return }
        window.setFrameOrigin(path.start); adopt()
        lastDisplayArea = area; roam = path; sendHost()
    }
    func approachObservation(_ source: ObservedWindow, focus: CGPoint, done: @escaping (Bool) -> Void) -> Bool {
        guard canWander, companion.approachEnabled, companion.mayApproach(source),
              let point = ObservationLocation.screenPoint(focus: focus, window: source.bounds, desktopTop: NSScreen.screens[0].frame.maxY),
              let target = ObservationLocation.destination(near: point, screen: roamScreen().visibleFrame, size: window.frame.size) else { return false }
        stopRoaming()
        let token = UUID(); visitToken = token; visitSource = source; visitCompletion = done
        // Finish any local gesture before installing the route; stale JS stop messages cannot cancel a new trip.
        web.evaluateJavaScript("window.xjPet && xjPet.prepareVisit()") { [weak self] _, _ in
            guard let self = self, self.visitToken == token else { return }
            guard self.canWander, self.companion.mayApproach(source) else { self.stopRoaming(); return }
            let area = self.roamArea(); self.roamID += 1
            guard let path = RoamPath.make(from: self.window.frame.origin, area: area, target: target,
                 now: ProcessInfo.processInfo.systemUptime, scale: self.window.frame.width / 360, running: true, id: self.roamID, intentional:true),
                 path.duration < 18 else { self.stopRoaming(arrived: true); return }
            self.window.setFrameOrigin(path.start); self.adopt()
            self.lastDisplayArea = area; self.roam = path; self.sendHost()
        }
        return true
    }
    func stopRoaming(arrived: Bool = false) {
        guard roam != nil || visitToken != nil else { return }
        let done = visitCompletion
        if visitToken != nil { visitArrivedUntil = arrived ? ProcessInfo.processInfo.systemUptime+30 : 0 }
        roam = nil; visitToken = nil; visitSource = nil; visitCompletion = nil
        savePlace(); sendHost(); done?(arrived)
    }
    func restLife() {
        stopRoaming()
        web?.evaluateJavaScript("window.xjPet && xjPet.interrupt(6)", completionHandler: nil)
    }
    func hostJSON() -> String {
        let area = roamArea()
        var payload: [String: Any] = ["active": canWander, "chatter": strollChatter && !companion.busy && !companion.waitingToSpeak,
            "parked": area.width+area.height < 45 || RoamPath.onEdge(window.frame.origin, in: area)]
        if let path = roam {
            let s = path.sample(ProcessInfo.processInfo.systemUptime)
            payload["travel"] = ["id": path.id, "gait": path.gait, "dx": s.direction.x,
                                 "facing": abs(s.direction.y)>abs(s.direction.x)*2 ? (window.frame.midX < roamScreen().visibleFrame.midX ? -1:1) : (s.direction.x < 0 ? -1:1),
                                 "dy": s.direction.y, "speed": s.speed, "kind": visitToken == nil ? "stroll" : "observation"]
        }
        let data = try! JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        return String(data: data, encoding: .utf8)!
    }
    func sendHost() {
        guard companion.ready else { return }
        let json = hostJSON()
        guard json != lastHost else { return }; lastHost = json
        web.evaluateJavaScript("window.xjPet && xjPet.host(\(json))", completionHandler: nil)
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let d = m.body as? [String: Any], let type = d["type"] as? String else { return }
        if type == "grab", !wallpaper { dragging = true; stopRoaming(); last = NSEvent.mouseLocation; window.ignoresMouseEvents = false }
        else if type == "wander" { startRoaming(running: d["running"] as? Bool ?? true) }
        else if type == "roamStop", let id=d["id"] as? Int, roam?.id == id { stopRoaming() }
        else if type == "release", dragging {
            dragging=false; web.evaluateJavaScript("window.xjPet && xjPet.release()",completionHandler:nil)
            keepOnScreen(); adopt(); savePlace()
        }
        else if type == "shift", !wallpaper, let x = d["x"] as? Double, let y = d["y"] as? Double {
            // the page keeps her in the middle of the window however she hangs: its total shift so far, in points
            shift = NSPoint(x: x, y: y); place()
            if !dragging { savePlace() }
        }
        else if type == "chat" { openChat() }
        else if type == "ready" {
            companion.ready = true
            // Explicit local one-shot request, consumed before attempting. Normal launches still start paused.
            if store.bool(forKey: "enableObservationOnce") {
                store.removeObject(forKey: "enableObservationOnce")
                if !companion.enabled { companion.toggle() }
            }
            sendHost(); FileHandle.standardError.write("[page] ready\n".data(using: .utf8)!)
        }
        else if type == "log" { FileHandle.standardError.write("[page] log \(d["text"] as? String ?? "")\n".data(using: .utf8)!) }
    }

    func tick() {
        tickNo += 1
        let p = NSEvent.mouseLocation
        let now = ProcessInfo.processInfo.systemUptime
        if hypot(p.x-pointer.x,p.y-pointer.y)>1 || NSEvent.pressedMouseButtons != 0 { pointerIntentUntil=now+0.5 }
        pointer=p
        if tickNo % 6 == 0, let source = visitSource, !companion.mayApproach(source) { stopRoaming() }
        if !canWander { stopRoaming() }
        if let path = roam {
            let area = roamArea()
            if area != lastDisplayArea { stopRoaming(); keepOnScreen(); adopt(); restLife() }
            else {
                let sample = path.sample(ProcessInfo.processInfo.systemUptime)
                // origin + shift remains the single source of truth for both autonomous movement and carrying.
                origin = NSPoint(x: sample.point.x - shift.x, y: sample.point.y - shift.y); place()
                if sample.done { stopRoaming(arrived: true) }
            }
        }
        if dragging {
            let dx = p.x - last.x, dy = p.y - last.y
            last = p
            if dx != 0 || dy != 0 {
                origin.x += dx; origin.y += dy; place()
                web.evaluateJavaScript("window.xjPet && xjPet.dragBy(\(dx), \(-dy))", completionHandler: nil)
            }
            if NSEvent.pressedMouseButtons & 1 == 0 {
                dragging = false
                web.evaluateJavaScript("window.xjPet && xjPet.release()", completionHandler: nil)
                keepOnScreen(); adopt(); savePlace()
            }
            return
        }
        guard tickNo % 3 == 0 else { return }
        sendHost()
        guard !hitPending else { return }; hitPending = true
        // where the pointer is in the page (y down); the page turns her eyes to it and says whether it is on her
        let f = window.frame, x = p.x - f.minX, y = f.maxY - p.y
        let intentional = now < pointerIntentUntil
        web.evaluateJavaScript("window.xjPet ? xjPet.hit(\(x), \(y), \(intentional ? "true":"false")) : false") { [weak self] r, _ in
            guard let self = self else { return }; self.hitPending = false
            guard !self.dragging else { return }
            let hit = (r as? Bool) ?? false
            self.window.ignoresMouseEvents = self.wallpaper || !hit
            if hit && intentional { self.stopRoaming() }
        }
    }
}

let app = NSApplication.shared
// Pausing may terminate a worker while its in-memory screenshot is still being written to stdin.
signal(SIGPIPE, SIG_IGN)
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
