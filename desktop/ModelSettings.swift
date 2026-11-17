import Cocoa
import Security

final class ModelSettings: NSObject {
    private let service = "io.opengrove.xiaojing-pet.model"
    private var panel: NSPanel?
    private let address = NSTextField(), model = NSTextField(), key = NSSecureTextField()
    private let notice = NSTextField(wrappingLabelWithString: "")
    private func query() -> [String: Any] { [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service, kSecAttrAccount as String:"api"] }
    func config() -> [String: String]? {
        guard let url = UserDefaults.standard.string(forKey:"modelBaseURL"), let name = UserDefaults.standard.string(forKey:"modelName") else { return nil }
        var q = query(); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data, let secret = String(data:data,encoding:.utf8), !secret.isEmpty else { return nil }
        return ["baseUrl":url,"model":name,"apiKey":secret]
    }
    func open() {
        if panel == nil {
            let p = NSPanel(contentRect:NSRect(x:0,y:0,width:520,height:320), styleMask:[.titled,.closable], backing:.buffered,defer:false)
            p.title = "小鲸 · 模型设置"; p.isReleasedWhenClosed = false
            let info = NSTextField(wrappingLabelWithString:"填写支持图片的 Anthropic Messages 兼容模型。聊天文字、允许窗口的截图将发到你配置的服务；密钥保存在本机钥匙串。保存不会发起模型请求。")
            info.frame = NSRect(x:24,y:240,width:472,height:60); p.contentView!.addSubview(info)
            for (i,pair) in [("API 根地址",address),("模型名称",model),("API Key",key)].enumerated() {
                let y = 200 - CGFloat(i)*46
                let label = NSTextField(labelWithString:pair.0); label.frame = NSRect(x:24,y:y,width:96,height:24)
                pair.1.frame = NSRect(x:126,y:y,width:370,height:26)
                p.contentView!.addSubview(label); p.contentView!.addSubview(pair.1)
            }
            key.placeholderString = "已有密钥时，留空保持不变"
            notice.frame = NSRect(x:24,y:24,width:360,height:55); p.contentView!.addSubview(notice)
            let save = NSButton(title:"保存",target:self,action:#selector(save)); save.frame = NSRect(x:400,y:28,width:96,height:32)
            p.contentView!.addSubview(save); panel = p
        }
        address.stringValue = UserDefaults.standard.string(forKey:"modelBaseURL") ?? "https://api.anthropic.com"
        model.stringValue = UserDefaults.standard.string(forKey:"modelName") ?? ""
        key.stringValue = ""; notice.stringValue = "未配置时，本机开发版仍可使用原工作区的模型配置。"
        panel!.center(); panel!.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true)
    }
    @objc private func save() {
        let raw = address.stringValue.trimmingCharacters(in:.whitespacesAndNewlines), name = model.stringValue.trimmingCharacters(in:.whitespacesAndNewlines)
        guard let u = URLComponents(string:raw), u.scheme == "https", u.host != nil, u.user == nil, u.password == nil, u.query == nil, u.fragment == nil, !name.isEmpty else {
            notice.stringValue = "请输入有效的 HTTPS 地址和模型名称。"; return
        }
        let secret = key.stringValue.trimmingCharacters(in:.whitespacesAndNewlines)
        if !secret.isEmpty {
            let data = Data(secret.utf8), q = query()
            var result = SecItemUpdate(q as CFDictionary,[kSecValueData as String:data] as CFDictionary)
            if result == errSecItemNotFound { var a=q; a[kSecValueData as String]=data; result=SecItemAdd(a as CFDictionary,nil) }
            guard result == errSecSuccess else { notice.stringValue = "钥匙串未保存成功，请检查系统提示。"; return }
        } else if config() == nil { notice.stringValue = "首次设置需要填写 API Key。"; return }
        UserDefaults.standard.set(raw,forKey:"modelBaseURL"); UserDefaults.standard.set(name,forKey:"modelName")
        key.stringValue = ""; notice.stringValue = "已保存。可打开聊天窗口试用。"
    }
}
