import Foundation
import CoreGraphics

@main struct RoamingCheck {
    static func main() {
        var count = 0
        func check(_ ok: Bool, _ why: String) { precondition(ok, why); count += 1 }
        for screen in [CGRect(x: 0, y: 30, width: 1440, height: 845),
                       CGRect(x: -1920, y: -200, width: 1920, height: 1040),
                       CGRect(x: 0, y: 0, width: 600, height: 700)] {
            for size in [CGSize(width: 260, height: 346), CGSize(width: 360, height: 480), CGSize(width: 520, height: 692)] {
                let area = RoamPath.area(screen: screen, size: size)
                let start = RoamPath.clamp(CGPoint(x: -9999, y: 9999), to: area)
                check(start.x >= screen.minX && start.y >= screen.minY, "top left screen bounds")
                check(start.x + size.width <= screen.maxX && start.y + size.height <= screen.maxY, "whole window on screen")
                let end = CGPoint(x: area.maxX, y: area.minY)
                guard let path = RoamPath.make(from: start, area: area, target: end, now: 100, scale: size.width / 360, running: true, id: 1) else { continue }
                check(path.sample(100.2).point == start && path.sample(100.2).speed == 0, "turn before moving")
                for i in 0...120 {
                    let s = path.sample(100 + RoamPath.turnTime + path.duration * Double(i) / 120)
                    check(s.point.x >= area.minX - 1e-8 && s.point.x <= area.maxX + 1e-8 &&
                          s.point.y >= area.minY - 1e-8 && s.point.y <= area.maxY + 1e-8, "path leaves usable screen")
                }
                let final = path.sample(1000)
                check(final.point == end && final.speed == 0 && final.done, "arrive without overshoot")
            }
        }
        let tiny = RoamPath.area(screen: CGRect(x: 0, y: 0, width: 200, height: 200), size: CGSize(width: 520, height: 692))
        check(tiny.width == 0 && tiny.height == 0, "oversized pet cannot form negative bounds")
        check(RoamPath.make(from: .zero, area: tiny, target: CGPoint(x: 999, y: 999), now: 0, scale: 1, running: true, id: 0) == nil, "no room means no trip")
        let rail = CGRect(x: -1500, y: 40, width: 1000, height: 500)
        for scale in [CGFloat(260.0/360), 1, CGFloat(520.0/360)] { for running in [false,true] {
            let climb=RoamPath.make(from:rail.origin,area:rail,target:CGPoint(x:rail.minX,y:rail.minY+300),now:0,scale:scale,running:running,id:1)!
            let walk=RoamPath.make(from:rail.origin,area:rail,target:CGPoint(x:rail.minX+300,y:rail.minY),now:0,scale:scale,running:running,id:2)!
            let visit=RoamPath.make(from:rail.origin,area:rail,target:CGPoint(x:rail.minX,y:rail.minY+300),now:0,scale:scale,running:running,id:3,intentional:true)!
            check(climb.duration == walk.duration*4, "climb must be four times slower than horizontal travel")
            check(visit.duration == walk.duration, "observation visits retain their own timing")
            let mid=RoamPath.turnTime+climb.duration/2, sample=climb.sample(mid)
            let before=climb.sample(mid-0.001).point, after=climb.sample(mid+0.001).point
            check(abs(sample.speed-Double(hypot(after.x-before.x,after.y-before.y))/0.002)<0.001, "renderer receives actual climbing speed")
            check(abs(sample.speed-Double((running ? 155:85)*scale/4))<1e-8 && sample.direction.y>0, "upward speed and direction")
        }}
        func onEdge(_ p: CGPoint) -> Bool {
            abs(p.y - rail.minY) < 1e-6 || abs(p.y - rail.maxY) < 1e-6 || abs(p.x - rail.minX) < 1e-6 || abs(p.x - rail.maxX) < 1e-6
        }
        // From one side to the other: every intermediate sample follows the U, including the corners.
        let sidePath = RoamPath.make(from: CGPoint(x: rail.minX, y: rail.maxY), area: rail,
            target: CGPoint(x: rail.maxX, y: rail.maxY), now: 0, scale: 1, running: true, id: 2)!
        for i in 0...200 {
            let s = sidePath.sample(RoamPath.turnTime + sidePath.duration * Double(i) / 200)
            check(onEdge(s.point), "edge-to-edge travel must not cross the centre")
        }
        let middle = CGPoint(x: rail.midX, y: rail.midY)
        let recovering = RoamPath.route(from: middle, to: CGPoint(x: rail.maxX, y: rail.maxY), in: rail)
        check(recovering[1] == CGPoint(x: rail.midX, y: rail.minY), "a manually dropped pet returns to nearest edge first")
        for i in 0...100 {
            let start = RoamPath.edgePoint(CGFloat(i)*30,in:rail)
            let target = RoamPath.wanderTarget(from:start,in:rail,fraction:CGFloat(i)/100)
            check(onEdge(target), "random destinations stay on the perimeter")
            if let route = RoamPath.make(from:start,area:rail,target:target,now:0,scale:1,running:true,id:i) {
                for frame in 0...60 { check(onEdge(route.sample(RoamPath.turnTime+route.duration*Double(frame)/60).point), "random travel never cuts through the work area") }
            }
        }
        check(RoamPath.wanderTarget(from:middle,in:rail,fraction:0.1)==RoamPath.edge(middle,in:rail), "an interrupted interior visit returns directly to the closest edge")
        let intentional = RoamPath.make(from:rail.origin,area:rail,target:middle,now:0,scale:1,running:true,id:300,intentional:true)!
        check(intentional.sample(1000).point == middle, "explicit observation may approach interior content")
        let ordinary = RoamPath.make(from:rail.origin,area:rail,target:middle,now:0,scale:1,running:true,id:301)!
        check(onEdge(ordinary.sample(1000).point), "ordinary routes cannot use an interior endpoint")
        for screen in [CGRect(x:0,y:88,width:1470,height:800),CGRect(x:-1920,y:-100,width:1920,height:1080)] {
            let sizes = [CGSize(width:260,height:346),CGSize(width:360,height:480),CGSize(width:520,height:692)]
            for oldSize in sizes { for newSize in sizes {
                let oldArea=RoamPath.area(screen:screen,size:oldSize),newArea=RoamPath.area(screen:screen,size:newSize)
                for oldPoint in [oldArea.origin,CGPoint(x:oldArea.maxX,y:oldArea.minY),CGPoint(x:oldArea.midX,y:oldArea.midY),CGPoint(x:oldArea.midX,y:oldArea.maxY)] {
                    let result=RoamPath.resizedFrame(CGRect(origin:oldPoint,size:oldSize),to:newSize,screen:screen)
                    check(RoamPath.onEdge(result.origin,in:newArea), "every resize anchors immediately to a fresh edge")
                    check(result.minX>=screen.minX && result.maxX<=screen.maxX && result.minY>=screen.minY && result.maxY<=screen.maxY, "resizing stays on the same display")
                }
            }}
        }
        let cgWindow = CGRect(x: -1200, y: 120, width: 800, height: 600)
        let point = ObservationLocation.screenPoint(focus: CGPoint(x: 0.25, y: 0.75), window: cgWindow, desktopTop: 900)!
        check(point == CGPoint(x: -1000, y: 330), "screenshot coordinates convert to desktop points, including negative screens")
        check(ObservationLocation.screenPoint(focus: CGPoint(x: 2, y: 0), window: cgWindow, desktopTop: 900) == nil, "out of range focus rejected")
        check(ObservationLocation.screenPoint(focus: CGPoint(x: CGFloat.nan, y: 0), window: cgWindow, desktopTop: 900) == nil, "non-finite focus rejected")
        let screen = CGRect(x: -1500, y: 0, width: 1400, height: 900), size = CGSize(width: 360, height: 480)
        let destination = ObservationLocation.destination(near: point, screen: screen, size: size)!
        let safe = RoamPath.area(screen: screen, size: size)
        check(destination.x>=safe.minX && destination.x<=safe.maxX && destination.y>=safe.minY && destination.y<=safe.maxY, "intentional focus destination remains within usable display")
        check(ObservationLocation.destination(near: CGPoint(x: 100, y: 100), screen: screen, size: size) == nil, "no unexpected trip to another display")
        print("\(count) roaming geometry/timing checks passed")
    }
}
