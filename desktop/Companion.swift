import Cocoa
import ScreenCaptureKit
import Carbon

struct ObservedWindow: Equatable {
    let id: CGWindowID
    let pid: pid_t
    let bundle: String
    let app: String
    let bounds: CGRect
}

private final class PendingObservation {
    let window: ObservedWindow, created = Date(), reply: [String: Any], manual: Bool
    var approached = false, arriving = false
    init(window: ObservedWindow, reply: [String: Any], manual: Bool) {
        self.window = window; self.reply = reply; self.manual = manual
    }
}

final class Companion {
    var changed: (() -> Void)?
    var speak: (([String: Any]) -> Void)?
    var chatEvent: ((String, String) -> Void)?
    var interacting: () -> Bool = { false }
    var approachEnabled = UserDefaults.standard.bool(forKey: "observationApproach")
    var approach: ((ObservedWindow, CGPoint, @escaping (Bool) -> Void) -> Bool)?
    var cancelApproach: (() -> Void)?
    var modelConfig: (() -> [String:String]?)?
    var waitingToSpeak: Bool { pending != nil }
    var enabled = false
    var ready = false
    private var screenAwake = true, sessionActive = true, screenLocked = false
    var awake: Bool { screenAwake && sessionActive && !screenLocked }
    private var statusKey = "观察已暂停", statusArgs: [String] = []
    var status:String { L10n.text(statusKey,statusArgs) }
    var allowed: Set<String> = Set(UserDefaults.standard.stringArray(forKey: "observeApps") ?? [])
    private(set) var busy = false {
        didSet { chatEvent?("state", busy ? "小鲸正在想…" : "") }
    }
    private var timer: Timer?
    private var notices: [NSObjectProtocol] = []
    private var distributed: [NSObjectProtocol] = []
    private var worker: Process?
    private var epoch = 0
    private var target: ObservedWindow?
    private var stableSince = Date()
    private var lastRequest = Date.distantPast
    private var lastSpeech = Date.distantPast
    private var pending: PendingObservation?
    private var history: [[String: String]] = []
    private var context = ""
    private let forbidden: Set<String> = ["com.apple.systempreferences", "com.apple.Passwords", "com.apple.keychainaccess",
        "com.apple.SecurityAgent", "com.agilebits.onepassword7", "com.1password.1password", "com.bitwarden.desktop"]

    init() {
        let center = NSWorkspace.shared.notificationCenter
        for (name, screen, value) in [(NSWorkspace.screensDidSleepNotification, true, false),
                                     (NSWorkspace.screensDidWakeNotification, true, true),
                                     (NSWorkspace.sessionDidResignActiveNotification, false, false),
                                     (NSWorkspace.sessionDidBecomeActiveNotification, false, true)] {
            notices.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                guard let self = self else { return }
                if screen { self.screenAwake = value } else { self.sessionActive = value }
                self.availabilityChanged()
            })
        }
        for (name, value) in [("com.apple.screenIsLocked", false), ("com.apple.screenIsUnlocked", true)] {
            distributed.append(DistributedNotificationCenter.default().addObserver(forName: NSNotification.Name(name), object: nil, queue: .main) {
                [weak self] _ in self?.screenLocked = !value; self?.availabilityChanged()
            })
        }
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.tick() }
    }

    func setStatus(_ value: String, _ args:String...) {
        guard statusKey != value || statusArgs != args else { return }
        statusKey = value; statusArgs=args; changed?()
    }
    func permitted(_ bundle: String) -> Bool {
        allowed.contains(bundle) && !forbidden.contains(bundle) && bundle != Bundle.main.bundleIdentifier
    }
    func selectable(_ bundle: String) -> Bool { !forbidden.contains(bundle) && bundle != Bundle.main.bundleIdentifier }
    func mayApproach(_ window: ObservedWindow) -> Bool {
        enabled && awake && permitted(window.bundle) && CGPreflightScreenCaptureAccess() && frontWindow() == window
    }
    func toggleApp(_ bundle: String) {
        if allowed.contains(bundle) { allowed.remove(bundle) } else { allowed.insert(bundle) }
        UserDefaults.standard.set(Array(allowed).sorted(), forKey: "observeApps")
        // Removing an app also invalidates observations already in flight.
        cancel(); context = ""
        setStatus(enabled ? "等待允许的应用" : "观察已暂停"); changed?()
    }
    func toggle() {
        if enabled { pause(); return }
        guard allowed.contains(where: selectable) else { setStatus("先在「允许观察的应用」中勾选应用"); return }
        guard CGPreflightScreenCaptureAccess() else {
            _ = CGRequestScreenCaptureAccess()
            setStatus("请授权屏幕录制，然后再次开启观察"); return
        }
        enabled = true; stableSince = Date(); lastRequest = .distantPast; lastSpeech = .distantPast
        setStatus("等待你停下来，再看一眼"); changed?()
    }
    func cancel() {
        epoch += 1; discardPending(); busy = false
        if let process = worker, process.isRunning { process.terminate() }
        worker = nil
        chatEvent?("state", "")
    }
    private func discardPending() {
        let wasArriving = pending?.arriving == true
        pending = nil
        if wasArriving { cancelApproach?() }
    }
    func pause() {
        enabled = false; cancel(); context = ""; history = []
        setStatus("观察已暂停"); changed?()
    }
    func languageChanged() {
        cancel();setStatus(enabled ? "等待你停下来，再看一眼":"观察已暂停");changed?()
    }
    func availabilityChanged() {
        stableSince = Date()
        if !awake { cancel(); context = "" }
        if enabled { setStatus(awake ? "等待你停下来，再看一眼" : "屏幕休息中，暂停观察") }
    }
    func idleSeconds() -> TimeInterval {
        // Timing only: no key events, key codes, characters, clipboard or text fields.
        [.keyDown, .leftMouseDown, .rightMouseDown, .scrollWheel, .mouseMoved].map {
            CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: $0)
        }.min() ?? 0
    }
    func frontWindow() -> ObservedWindow? {
        guard !IsSecureEventInputEnabled(), let app = NSWorkspace.shared.frontmostApplication,
              let bundle = app.bundleIdentifier, selectable(bundle),
              let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
        // CGWindowList is ordered front to back. Do not fall back to another app or a whole display.
        guard let row = rows.first(where: {
            ($0[kCGWindowOwnerPID as String] as? Int32) == app.processIdentifier &&
            ($0[kCGWindowLayer as String] as? Int) == 0 && ($0[kCGWindowAlpha as String] as? Double ?? 1) > 0
        }), let id = row[kCGWindowNumber as String] as? UInt32,
            let rawBounds = row[kCGWindowBounds as String] as? [String: Any],
            let bounds = CGRect(dictionaryRepresentation: rawBounds as CFDictionary) else { return nil }
        return ObservedWindow(id: id, pid: app.processIdentifier, bundle: bundle, app: app.localizedName ?? bundle, bounds: bounds)
    }
    func tick(manual: Bool = false) {
        guard enabled, ready, awake else { return }
        guard CGPreflightScreenCaptureAccess() else { pause(); setStatus("屏幕录制权限已关闭"); return }
        let now = Date(), current = frontWindow()
        if current != target { target = current; stableSince = now; discardPending(); context = "" }
        if let item = pending {
            let window = item.window, created = item.created
            if now.timeIntervalSince(created) > 30 || current != window || !permitted(window.bundle) { discardPending() }
            else if ObservationPolicy.mayDeliver(enabled: enabled, awake: awake, sameWindow: current == window,
                      allowed: permitted(window.bundle), interacting: interacting(), idle: idleSeconds(), age: now.timeIntervalSince(created),
                      sinceSpeech: now.timeIntervalSince(lastSpeech), manual: item.manual) {
                guard !item.arriving else { return }
                if approachEnabled && !item.approached, let xy = item.reply["focus"] as? [String: Double],
                   let x = xy["x"], let y = xy["y"], x.isFinite, y.isFinite, (0...1).contains(x), (0...1).contains(y) {
                    item.approached = true; item.arriving = true
                    let started = approach?(window, CGPoint(x: x, y: y), { [weak self, weak item] arrived in
                        guard let self = self, let item = item, self.pending === item else { return }
                        item.arriving = false
                        if !arrived { self.discardPending() }
                    }) ?? false
                    if started { setStatus("到旁边看看，再和你说"); return }
                    item.arriving = false
                }
                pending = nil; present(item.reply); setStatus("在旁边陪着你")
            }
            return
        }
        guard let window = current, permitted(window.bundle) else { if !busy { setStatus("当前应用不在观察名单里") }; return }
        guard ObservationPolicy.mayObserve(enabled: enabled, awake: awake, allowed: permitted(window.bundle), busy: busy,
            interacting: interacting(), idle: idleSeconds(), stable: now.timeIntervalSince(stableSince),
            sinceRequest: now.timeIntervalSince(lastRequest), manual: manual) else { return }
        epoch += 1; busy = true; lastRequest = now; let generation = epoch
        setStatus("正在看一眼「{0}」",window.app)
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
            guard let self = self, self.epoch == generation, self.busy, self.worker == nil else { return }
            self.cancel(); self.setStatus("截图超时，稍后再看")
        }
        capture(window) { [weak self] image in
            guard let self = self, self.epoch == generation else { return }
            guard self.enabled, self.awake, self.frontWindow() == window, self.permitted(window.bundle), !self.interacting(),
                  manual || ObservationPolicy.recentInput(idle: self.idleSeconds()) else { self.busy = false; return }
            guard let image = image else { self.busy = false; self.setStatus("当前窗口无法截图，稍后再看"); return }
            guard let data = NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [.compressionFactor: 0.7]),
                  data.count < 2_000_000 else { self.busy = false; self.setStatus("截图编码失败"); return }
            let payload: [String: Any] = ["kind": manual ? "peek" : "observe", "observation": ["app": window.app, "locate": self.approachEnabled],
                "image": ["media_type": "image/jpeg", "data": data.base64EncodedString()],
                "recent_context": self.context, "history": self.history]
            self.run(payload, generation: generation) { [weak self] reply in
                guard let self = self else { return }
                self.busy = false
                guard reply["ok"] as? Bool == true else { self.fail(reply); return }
                guard self.enabled, self.awake, self.frontWindow() == window, self.permitted(window.bundle) else { return }
                self.context = String((reply["context"] as? String ?? "").prefix(100))
                if reply["speak"] as? Bool == true {
                    self.pending = PendingObservation(window: window, reply: reply, manual: manual)
                    self.setStatus("等你停下来再说")
                } else { self.setStatus("看过了，安静陪着") }
            }
        }
    }

    private func capture(_ window: ObservedWindow, done: @escaping (CGImage?) -> Void) {
        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { content, _ in
            DispatchQueue.main.async {
                guard self.enabled, self.awake, self.frontWindow() == window, self.permitted(window.bundle),
                      let selected = content?.windows.first(where: { $0.windowID == window.id }),
                      selected.frame.width > 80, selected.frame.height > 80 else { done(nil); return }
                let config = SCStreamConfiguration()
                let scale = min(1, 1280 / max(selected.frame.width, selected.frame.height))
                config.width = max(1, Int(selected.frame.width * scale)); config.height = max(1, Int(selected.frame.height * scale))
                config.showsCursor = false
                let filter = SCContentFilter(desktopIndependentWindow: selected)
                SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) { image, _ in
                    DispatchQueue.main.async { done(image) }
                }
            }
        }
    }
    private func present(_ reply: [String: Any]) {
        let text = reply["text"] as? String ?? ""
        guard !text.isEmpty else { return }
        lastSpeech = Date(); history.append(["role": "assistant", "text": text]); history = Array(history.suffix(8))
        speak?(reply); chatEvent?("assistant", text)
    }
    func chat(_ raw: String) {
        let text = String(raw.trimmingCharacters(in: .whitespacesAndNewlines).prefix(500))
        guard !text.isEmpty, !busy else { return }
        epoch += 1; discardPending(); busy = true; let generation = epoch
        let payload: [String: Any] = ["kind": "chat", "text": text, "recent_context": context, "history": history]
        history.append(["role": "user", "text": text]); history = Array(history.suffix(8))
        chatEvent?("user", text); chatEvent?("state", "小鲸正在想…")
        run(payload, generation: generation) { [weak self] reply in
            guard let self = self else { return }
            self.busy = false; self.chatEvent?("state", "")
            if reply["ok"] as? Bool == true { self.present(reply) } else { self.fail(reply) }
        }
    }
    private func fail(_ reply: [String: Any]) {
        let code = reply["error"] as? String ?? "worker_failed"
        pause()
        setStatus("连接未完成（{0}），已暂停；不会自动重试",code); chatEvent?("notice", status)
    }
    private func run(_ payload: [String: Any], generation: Int, done: @escaping ([String: Any]) -> Void) {
        guard let resource = Bundle.main.resourceURL else { done(["ok":false,"error":"local_payload_error"]); return }
        var request = payload
        request["language"]=L10n.language
        let standalone = modelConfig?()
        if let standalone = standalone { request["config"]=standalone }
        guard let data = try? JSONSerialization.data(withJSONObject: request) else {
            done(["ok": false, "error": "local_payload_error"]); return
        }
        let process = Process(), input = Pipe(), output = Pipe()
        if standalone != nil {
            process.executableURL = Bundle.main.executableURL!.deletingLastPathComponent().appendingPathComponent("node")
            process.arguments = [resource.appendingPathComponent("node-worker.cjs").path]
        } else {
            process.executableURL = URL(fileURLWithPath:"/usr/bin/python3")
            process.arguments = ["-B",resource.appendingPathComponent("companion.py").path]
        }
        let env = ProcessInfo.processInfo.environment
        process.environment = env.filter { ["HOME", "PATH", "LANG", "TMPDIR", "USER"].contains($0.key) }
        process.environment?["XJ_WORKSPACE"] = env["XJ_WORKSPACE"] ?? Bundle.main.object(forInfoDictionaryKey: "XJWorkspaceRoot") as? String
        process.standardInput = input; process.standardOutput = output; process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { done(["ok": false, "error": "python_launch_failed"]); return }
        worker = process
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak self, weak process] in
            if let process = process, process.isRunning, self?.epoch == generation { process.terminate() }
        }
        DispatchQueue.global(qos: .utility).async {
            try? input.fileHandleForWriting.write(contentsOf: data)
            try? input.fileHandleForWriting.close()
            let bytes = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            let reply = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any]
                ?? ["ok": false, "error": "worker_result_uncertain"]
            DispatchQueue.main.async { [weak self] in
                guard let self = self, self.epoch == generation else { return }
                self.worker = nil; done(reply)
            }
        }
    }
}
