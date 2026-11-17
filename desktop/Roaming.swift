import Foundation
import CoreGraphics

// Window origins stay inside one display's usable area (excluding the menu bar and Dock).
// Keep this geometry independent of AppKit so small displays and negative monitor coordinates can be checked.
struct RoamPath {
    let start: CGPoint
    let end: CGPoint
    let started: TimeInterval
    let duration: TimeInterval
    let gait: String
    let id: Int
    let points: [CGPoint]
    let climbWeight: CGFloat
    static let turnTime: TimeInterval = 0.4

    static func area(screen: CGRect, size: CGSize) -> CGRect {
        let margin: CGFloat = 8
        return CGRect(x: screen.minX + min(margin, max(0, (screen.width - size.width) / 2)),
                      y: screen.minY + min(margin, max(0, (screen.height - size.height) / 2)),
                      width: max(0, screen.width - size.width - 2 * margin),
                      height: max(0, screen.height - size.height - 2 * margin))
    }
    static func clamp(_ p: CGPoint, to area: CGRect) -> CGPoint {
        CGPoint(x: min(area.maxX, max(area.minX, p.x)), y: min(area.maxY, max(area.minY, p.y)))
    }
    // A closed perimeter. Random outings stay on this track, including their intermediate points.
    static func edge(_ point: CGPoint, in area: CGRect) -> CGPoint {
        let p = clamp(point, to: area)
        let candidates = [CGPoint(x: p.x, y: area.minY), CGPoint(x: area.minX, y: p.y), CGPoint(x: area.maxX, y: p.y), CGPoint(x:p.x,y:area.maxY)]
        return candidates.min { hypot($0.x - p.x, $0.y - p.y) < hypot($1.x - p.x, $1.y - p.y) }!
    }
    static func edgePosition(_ p: CGPoint, in area: CGRect) -> CGFloat {
        if abs(p.y - area.minY) < 0.01 { return p.x - area.minX }
        if abs(p.x - area.maxX) < 0.01 { return area.width + p.y - area.minY }
        if abs(p.y - area.maxY) < 0.01 { return area.width + area.height + area.maxX - p.x }
        return 2 * area.width + area.height + area.maxY - p.y
    }
    static func edgePoint(_ s: CGFloat, in area: CGRect) -> CGPoint {
        let length = 2 * (area.width + area.height)
        guard length > 0 else { return area.origin }
        let t = (s.truncatingRemainder(dividingBy:length) + length).truncatingRemainder(dividingBy:length)
        if t <= area.width { return CGPoint(x:area.minX+t,y:area.minY) }
        if t <= area.width+area.height { return CGPoint(x:area.maxX,y:area.minY+t-area.width) }
        if t <= 2*area.width+area.height { return CGPoint(x:area.maxX-(t-area.width-area.height),y:area.maxY) }
        return CGPoint(x:area.minX,y:area.maxY-(t-2*area.width-area.height))
    }
    static func route(from start: CGPoint, to target: CGPoint, in area: CGRect) -> [CGPoint] {
        let a = edge(start, in: area), b = edge(target, in: area)
        let sa = edgePosition(a, in: area), length = 2*(area.width+area.height)
        guard length > 0 else { return [start,area.origin] }
        var sb = edgePosition(b, in: area)
        if sb-sa > length/2 { sb -= length }
        if sa-sb > length/2 { sb += length }
        let base: [CGFloat] = [0, area.width, area.width+area.height, 2*area.width+area.height]
        var candidates: [CGFloat] = []
        for turn in -1...1 { for corner in base { candidates.append(corner+CGFloat(turn)*length) } }
        var corners = candidates.filter { $0 > min(sa,sb)+0.01 && $0 < max(sa,sb)-0.01 }.sorted()
        if sa > sb { corners.reverse() }
        let raw = [start, a] + corners.map { edgePoint($0, in: area) } + [b]
        return raw.reduce(into: []) { result, p in
            if let last = result.last, hypot(p.x - last.x, p.y - last.y) < 0.01 { return }
            result.append(p)
        }
    }
    static func resizedFrame(_ frame: CGRect, to size: CGSize, screen: CGRect) -> CGRect {
        let old = area(screen:screen,size:frame.size), next = area(screen:screen,size:size)
        let p = edge(frame.origin,in:old)
        let fx = old.width > 0 ? (p.x-old.minX)/old.width : 0
        let fy = old.height > 0 ? (p.y-old.minY)/old.height : 0
        return CGRect(origin:edge(CGPoint(x:next.minX+fx*next.width,y:next.minY+fy*next.height),in:next),size:size)
    }
    static func onEdge(_ p: CGPoint, in area: CGRect) -> Bool { let e=edge(p,in:area); return hypot(p.x-e.x,p.y-e.y)<2 }
    static func wanderTarget(from p: CGPoint, in area: CGRect, fraction: CGFloat) -> CGPoint {
        if !onEdge(p,in:area) { return edge(p,in:area) }
        let length = 2*(area.width+area.height), stride = min(length*0.45,max(90,length*(0.12+abs(fraction-0.5)*0.4)))
        return edgePoint(edgePosition(edge(p,in:area),in:area)+(fraction<0.5 ? -stride:stride),in:area)
    }
    static func make(from p: CGPoint, area: CGRect, target: CGPoint, now: TimeInterval,
                     scale: CGFloat, running: Bool, id: Int, intentional: Bool = false) -> RoamPath? {
        let start = clamp(p, to: area), end = intentional ? clamp(target,to:area) : edge(target, in: area)
        var points = route(from: start, to: end, in: area)
        if intentional, let last=points.last, hypot(last.x-end.x,last.y-end.y)>0.01 { points.append(end) }
        guard zip(points,points.dropFirst()).reduce(CGFloat(0), { $0+hypot($1.1.x-$1.0.x,$1.1.y-$1.0.y) }) >= 2 else { return nil }
        let climbWeight: CGFloat = intentional ? 1 : 4
        let distance = zip(points, points.dropFirst()).reduce(CGFloat(0)) {
            let dx=$1.1.x-$1.0.x, dy=$1.1.y-$1.0.y
            return $0 + hypot(dx,dy) * (abs(dy)>abs(dx)*2 ? climbWeight:1)
        }
        guard distance >= 2 else { return nil }
        let speed = (running ? 155.0 : 85.0) * scale
        return RoamPath(start: start, end: end, started: now,
                        duration: max(1.8, 1.5 * distance / speed), gait: running ? "run" : "walk", id: id, points: points, climbWeight: climbWeight)
    }
    func sample(_ now: TimeInterval) -> (point: CGPoint, speed: Double, done: Bool, direction: CGPoint) {
        let u = min(1, max(0, (now - started - Self.turnTime) / duration))
        let ease = u * u * (3 - 2 * u)
        let segments = Array(zip(points, points.dropFirst()))
        let lengths = segments.map { hypot($0.1.x - $0.0.x, $0.1.y - $0.0.y) }
        let weights: [CGFloat] = segments.map { abs($0.1.y-$0.0.y)>abs($0.1.x-$0.0.x)*2 ? climbWeight:1 }
        let costs = zip(lengths,weights).map { $0*$1 }
        let distance = costs.reduce(0, +)
        var remaining = distance * ease
        for (i, segment) in segments.enumerated() {
            if remaining <= costs[i] || i == segments.count - 1 {
                let f = min(1, remaining / max(0.001, costs[i]))
                let d = CGPoint(x: segment.1.x - segment.0.x, y: segment.1.y - segment.0.y)
                return (CGPoint(x: segment.0.x + d.x * f, y: segment.0.y + d.y * f),
                        Double(distance/weights[i]) * 6 * u * (1 - u) / duration, u >= 1, d)
            }
            remaining -= costs[i]
        }
        return (end, 0, true, .zero)
    }
}

enum ObservationLocation {
    // The screenshot and CGWindowList use a top-left origin; AppKit uses the primary display's bottom-left origin.
    static func screenPoint(focus: CGPoint, window: CGRect, desktopTop: CGFloat) -> CGPoint? {
        guard focus.x.isFinite, focus.y.isFinite, (0...1).contains(focus.x), (0...1).contains(focus.y),
              window.width > 0, window.height > 0 else { return nil }
        return CGPoint(x: window.minX + focus.x * window.width, y: desktopTop - window.minY - focus.y * window.height)
    }
    static func destination(near point: CGPoint, screen: CGRect, size: CGSize) -> CGPoint? {
        guard screen.contains(point) else { return nil }
        // Stand next to the focus instead of covering it. Only an explicit observation visit uses the interior.
        let x = point.x < screen.midX ? point.x+24 : point.x-size.width-24
        return RoamPath.clamp(CGPoint(x:x,y:point.y-size.height*0.5),to:RoamPath.area(screen:screen,size:size))
    }
}
