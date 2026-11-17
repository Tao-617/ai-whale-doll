import Cocoa

final class ReplyPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

final class ChatPanel: NSObject, NSTextFieldDelegate {
    let panel: ReplyPanel
    let transcript = NSTextView()
    let input = NSTextField()
    let note = NSTextField(labelWithString: L("只发送这段对话，不附带截图 · 记录仅保留到退出"))
    let send = NSButton(title: L("发送"), target: nil, action: nil)
    var onSend: ((String) -> Void)?

    override init() {
        panel = ReplyPanel(contentRect: NSRect(x: 0, y: 0, width: 430, height: 340),
                          styleMask: [.titled, .closable, .utilityWindow], backing: .buffered, defer: false)
        super.init()
        panel.title = L("和小鲸聊一句"); panel.isReleasedWhenClosed = false; panel.hidesOnDeactivate = false
        panel.level = .floating; panel.center()
        let root = panel.contentView!
        let scroll = NSScrollView(frame: NSRect(x: 16, y: 78, width: 398, height: 246))
        scroll.hasVerticalScroller = true; scroll.borderType = .bezelBorder
        transcript.frame = NSRect(origin: .zero, size: scroll.contentSize)
        transcript.isEditable = false; transcript.isSelectable = true
        transcript.font = .systemFont(ofSize: 14); transcript.textContainerInset = NSSize(width: 10, height: 10)
        transcript.autoresizingMask = [.width]; transcript.isVerticallyResizable = true
        transcript.textContainer?.widthTracksTextView = true
        scroll.documentView = transcript; root.addSubview(scroll)
        input.frame = NSRect(x: 16, y: 42, width: 326, height: 26)
        input.placeholderString = L("想跟小鲸说什么？"); input.delegate = self; input.target = self; input.action = #selector(submit)
        root.addSubview(input)
        send.frame = NSRect(x: 350, y: 40, width: 64, height: 30)
        send.bezelStyle = .rounded; send.target = self; send.action = #selector(submit); root.addSubview(send)
        note.frame = NSRect(x: 16, y: 13, width: 398, height: 20)
        note.font = .systemFont(ofSize: 11); note.textColor = .secondaryLabelColor; root.addSubview(note)
    }
    func refreshLanguage() {
        panel.title=L("和小鲸聊一句");L10n.refresh(panel.contentView!);input.placeholderString=L("想跟小鲸说什么？")
    }
    func open() {
        panel.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); panel.makeFirstResponder(input)
    }
    @objc func submit() {
        guard send.isEnabled else { return }
        let text = String(input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).prefix(500))
        guard !text.isEmpty else { return }
        input.stringValue = ""; onSend?(text)
    }
    func event(_ role: String, _ text: String) {
        if role == "state" {
            send.isEnabled = text.isEmpty
            note.stringValue = text.isEmpty ? L("只发送这段对话，不附带截图 · 记录仅保留到退出") : L(text)
            return
        }
        let who = role == "user" ? L("你") : role == "assistant" ? L("小鲸") : L("提示")
        transcript.textStorage?.append(NSAttributedString(string: "\(who)：\(text)\n\n", attributes: [.font: NSFont.systemFont(ofSize: 14), .foregroundColor: NSColor.labelColor]))
        if transcript.string.count > 12000 { transcript.string = String(transcript.string.suffix(8000)) }
        transcript.scrollToEndOfDocument(nil)
    }
}
