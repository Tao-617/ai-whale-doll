import Foundation

@main struct PolicyCheck {
    static func main() {
        var checks = 0
        func check(_ condition: Bool, _ reason: String) { precondition(condition, reason); checks += 1 }
        func observe(enabled: Bool = true, awake: Bool = true, allowed: Bool = true,
                     busy: Bool = false, interacting: Bool = false, idle: Double = 5,
                     stable: Double = 10, request: Double = 60, manual: Bool = false) -> Bool {
            ObservationPolicy.mayObserve(enabled: enabled, awake: awake, allowed: allowed, busy: busy,
                interacting: interacting, idle: idle, stable: stable, sinceRequest: request, manual: manual)
        }
        func deliver(idle: Double = 5, age: Double = 1, speech: Double = 60, same: Bool = true,
                     allowed: Bool = true, manual: Bool = false) -> Bool {
            ObservationPolicy.mayDeliver(enabled: true, awake: true, sameWindow: same,
                allowed: allowed, interacting: false, idle: idle, age: age, sinceSpeech: speech, manual: manual)
        }
        check(observe(), "active minute can observe at 60 seconds")
        check(!observe(request: 59.99), "no request before one minute")
        check(observe(idle: 59.99), "input inside the last minute counts")
        check(!observe(idle: 60), "a minute without input stays silent")
        check(!observe(idle: 400), "user away")
        check(!observe(enabled: false), "observation off")
        check(!observe(awake: false), "asleep")
        check(!observe(allowed: false), "app excluded")
        check(!observe(busy: true), "one request at a time")
        check(!observe(interacting: true), "carrying or chatting")
        check(!observe(idle: 0.5), "wait for a typing pause")
        check(!observe(stable: 1), "window just switched")
        check(observe(idle: 400, stable: 0, request: 10, manual: true), "explicit peek works without recent input")
        check(!observe(enabled: false, manual: true), "peek cannot bypass off switch")
        check(!observe(allowed: false, manual: true), "peek cannot bypass app list")
        check(deliver(), "speech allowed after one minute")
        check(!deliver(speech: 59.99), "variable model latency cannot bunch up bubbles")
        check(deliver(speech: 1, manual: true), "explicit peek is not an automatic interruption")
        check(!deliver(same: false), "discard changed window")
        check(!deliver(allowed: false), "discard revoked app")
        check(!deliver(idle: 0), "wait while typing")
        check(!deliver(idle: 60), "discard if no recent input at delivery")
        check(!deliver(age: 31), "discard stale reply")
        // A single input cannot fuel several observations; resuming input makes the next turn eligible.
        var lastRequest = 0.0
        var observed: [Double] = []
        for (now, lastInput) in [(60.0, 55.0), (120, 55), (180, 175)] {
            if observe(idle: now - lastInput, request: now - lastRequest) { observed.append(now); lastRequest = now }
        }
        check(observed == [60, 180], "skip inactive minute and resume on fresh input")
        print("\(checks) observation/delivery policy checks passed")
    }
}
