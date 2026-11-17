import Foundation

// Pure scheduling rules shared by capture and result delivery. No keyboard characters are read.
struct ObservationPolicy {
    static let interval: TimeInterval = 60
    static let speechGap: TimeInterval = 60
    static let activityWindow: TimeInterval = 60
    static func recentInput(idle: TimeInterval) -> Bool { idle >= 4 && idle < activityWindow }
    static func mayObserve(enabled: Bool, awake: Bool, allowed: Bool, busy: Bool,
                           interacting: Bool, idle: TimeInterval, stable: TimeInterval,
                           sinceRequest: TimeInterval, manual: Bool = false) -> Bool {
        guard enabled, awake, allowed, !busy, !interacting else { return false }
        if manual { return sinceRequest >= 5 }
        return recentInput(idle: idle) && stable >= 8 && sinceRequest >= interval
    }
    static func mayDeliver(enabled: Bool, awake: Bool, sameWindow: Bool, allowed: Bool,
                           interacting: Bool, idle: TimeInterval, age: TimeInterval,
                           sinceSpeech: TimeInterval, manual: Bool = false) -> Bool {
        enabled && awake && sameWindow && allowed && !interacting && recentInput(idle: idle) && age <= 30 &&
        (manual || sinceSpeech >= speechGap)
    }
}
