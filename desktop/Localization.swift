import Cocoa

enum L10n {
    static var language: String {
        get { normalize(UserDefaults.standard.string(forKey:"language") ?? Locale.preferredLanguages.first ?? "en") }
        set { UserDefaults.standard.set(normalize(newValue),forKey:"language") }
    }
    static func normalize(_ value: String) -> String { value.lowercased().hasPrefix("zh") ? "zh" : "en" }
    static let english: [String:String] = {
        guard let url=Bundle.main.resourceURL?.appendingPathComponent("web/locales/en.json"),
              let data=try? Data(contentsOf:url), let map=try? JSONDecoder().decode([String:String].self,from:data) else { return [:] }
        return map
    }()
    static func text(_ key: String, _ args: [String] = []) -> String {
        var result=language == "en" ? (english[key] ?? key) : key
        for (i,value) in args.enumerated() { result=result.replacingOccurrences(of:"{\(i)}",with:value) }
        return result
    }
    static func refresh(_ root:NSView) {
        func source(_ value:String)->String { english.first(where:{$0.value==value})?.key ?? value }
        if let label=root as? NSTextField, !label.isEditable { label.stringValue=text(source(label.stringValue)) }
        if let button=root as? NSButton { button.title=text(source(button.title)) }
        for child in root.subviews { refresh(child) }
    }
}
func L(_ key: String, _ args: String...) -> String { L10n.text(key,args) }
