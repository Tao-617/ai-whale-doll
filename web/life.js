import {RESTS} from './rest.js';
// A small local behaviour loop: explore, notice something, gesture, rest. No AI calls or extra permissions.
// The native host owns desktop coordinates; this loop owns animation and never competes with a user's interaction.
const STROLL_LINES = [
  '哒哒哒，路过一下～', '我沿着边边巡逻。', '小鲸今天也有好好活动！', '这边的风景也不错嘛。',
  '我去那边晃一圈。', '一二一，一二一～', '尾巴跟上，出发！', '放心，我贴着边边走。',
  '桌面好大，腿腿好短。', '只是路过，没有急事。', '今天也是忙着溜达的一天。', '拐个弯，换个方向～',
  '我给自己安排了一个小散步。', '嘿咻，前面就是拐角啦。', '小鲸巡逻中，请慢慢忙。', '走两步，心情就亮一点。',
];
export class PetLife {
  constructor(x) {
    this.x = x;
    this.active = false;
    this.mode = 'rest';
    this.next = 25;
    this.nextWalk=120+Math.random()*120;
    this.nextDance=300+Math.random()*300;
    this.danceUntil=0;
    this.recent = [];
    this.heading = 0;
    this.travel = null;
    this.ownedMove = null;
    this.afterTrip = false;
    this.first = true;
    this.chatter = false;
    this.nextChatter = 0;
    this.recentLines = [];
    this.tripStarted = 0;
    this.parked = true;
  }
  host({active, travel = null, chatter = false, parked = true, visiting = false, floor = true}) {
    const now = this.x.state.time;
    this.chatter = chatter;
    this.parked = parked;
    this.visiting = visiting;this.floor=floor;
    if (this.active !== active) {
      this.active = active;
      const preview=this.x.state.restPreview;this.interrupt(active ? 20 : 2);this.x.state.restPreview=preview;
    }
    if (!active) return;
    if (travel) {
      travel={...travel,gait:Math.abs(travel.dy)>Math.abs(travel.dx)*2 && !['observation','return'].includes(travel.kind)?'climb':travel.gait};
      if (this.travel?.id !== travel.id) {
        this.stopDance();
        this.x.state.petRest=this.x.state.restPreview=null;
        this.mode = 'travel';
        this.tripStarted = now;
        this.x.face()?.set('smile', 0, now);
      }
      if(this.travel?.id!==travel.id || this.travel?.gait!==travel.gait){
        if(travel.gait==='climb')this.x.mover()?.stop();
        this.x.playClip(travel.gait==='climb'?null:travel.gait,0.3);
      }
      this.travel = travel;
    } else if (this.travel) {
      this.stopTravel();
      this.afterTrip = true;
      this.next = now + 25+Math.random()*20;this.nextWalk=now+120+Math.random()*120;
    }
  }
  stopTravel() {
    if (this.travel || this.mode === 'waiting') this.x.playClip(null, 0.25);
    this.x.state.petClimb=null;
    this.travel = null;
    this.mode = 'rest';
  }
  stopDance() {
    if(!this.danceUntil)return;
    this.danceUntil=0;this.x.playClip(null,.45);this.mode='rest';
    const face=this.x.face();if(face?.name==='smile')face.set('neutral',0,this.x.state.time);
  }
  interrupt(delay = 6, notify = true) {
    if (notify && (this.travel || this.mode === 'waiting')) this.x.post({type: 'roamStop', id:this.travel?.id ?? null});
    this.stopDance();this.stopTravel();
    this.x.state.petRest=null;this.x.state.restPreview=null;
    if (this.ownedMove && this.x.mover()?.playing === this.ownedMove) this.x.mover().stop();
    this.ownedMove = null;
    this.next = Math.max(this.next, this.x.state.time + delay);
  }
  update(dt, now) {
    const {state} = this.x;
    const blocked = (!this.active && !state.restPreview) || state.petHeld || state.petGrab || this.x.settling() ||
      this.x.face()?.reaction || (state.bubbleBlocking !== false && now < (state.bubbleUntil ?? 0)) || now < (state.petAttendUntil ?? 0);
    if (blocked) this.interrupt(3);
    const target = this.travel ? Math.sign(this.travel.facing || this.travel.dx || 1) * (this.travel.gait==='climb'?Math.PI*.70:
      1.05 + 0.28 * Math.abs(this.travel.dx) / Math.max(1, Math.hypot(this.travel.dx, this.travel.dy))) : 0;
    this.heading += (target - this.heading) * (1 - Math.exp(-dt * 7));
    state.petHeading = this.heading;
    state.petRoaming = !!this.travel;
    state.petClimb=!blocked&&this.travel?.gait==='climb'?{speed:this.travel.speed,direction:this.travel.dy<0?-1:1}:null;
    if (this.travel && state.clip) {
      const nominal = (this.travel.gait === 'run' ? 155 : 85) * this.x.scale();
      state.clip.setEffectiveTimeScale(Math.max(0.15, Math.min(1.55, this.travel.speed / nominal)));
    }
    if (!blocked && this.travel?.kind !== 'observation' && this.travel && this.chatter && now >= this.nextChatter &&
        now - this.tripStarted > 0.8 && now >= (state.bubbleUntil ?? 0) && this.travel.speed > 15) {
      const choices = STROLL_LINES.filter(line => !this.recentLines.includes(line));
      const line = choices[Math.floor(Math.random() * choices.length)];
      this.recentLines = [line, ...this.recentLines].slice(0, 4);
      this.nextChatter = now + 45 + Math.random() * 35;
      this.x.say(line, false, {whileMoving: true});
      this.x.face()?.talk(1.8, now);
    }
    if (blocked || this.travel || this.visiting) return;
    // Returning from an observation or a drag takes priority over idle gestures and random rest timers.
    if (!this.parked && !this.visiting && now >= (this.nextRecovery ?? 0)) {
      this.stopDance();
      state.petRest=state.restPreview=null;
      if(this.ownedMove)this.x.mover()?.stop();
      this.ownedMove=null;this.afterTrip=false;this.nextRecovery=now+2;
      this.mode='waiting';this.next=now+2;
      this.x.post({type:'wander',running:true});return;
    }
    if(state.restPreview||state.petRest||state.restWeight>.02)return;
    if(this.danceUntil){
      if(now>=this.danceUntil){this.stopDance();this.next=now+45+Math.random()*30;}
      return;
    }
    if (this.mode === 'waiting') {
      // A rejected request (no space, display changed) must not strand the pet in a walking animation.
      if (now > this.next) { this.stopTravel(); this.next = now + 3; }
      return;
    }
    if (this.ownedMove) {
      if (this.x.mover()?.playing === this.ownedMove) return;
      this.ownedMove = null; this.mode = 'rest';
      this.next = now + 30 + Math.random() * 35;
    }
    if (this.x.mover()?.busy || state.clip || now < this.next) return;
    if (!this.parked || now>=this.nextWalk) {
      this.first = false;
      this.mode = 'waiting'; this.next = now + 2;
      this.x.post({type: 'wander', running: false});
      return;
    }
    this.afterTrip = false;
    // A rare eight-second dance, on the floor only. A long cooldown keeps rest the default.
    if(this.floor&&now>=this.nextDance&&Math.random()<.18){
      this.nextDance=now+480+Math.random()*420;this.danceUntil=now+8;this.mode='dance';
      this.x.post({type:'restPlace'});this.x.face()?.set('smile',0,now);this.x.playClip('samba',.45);return;
    }
    if(this.floor&&Math.random()<.8){
      const keys=Object.keys(RESTS).filter(k=>k!==this.lastRest),id=keys[Math.floor(Math.random()*keys.length)];this.lastRest=id;
      this.x.post({type:"restPlace"});state.petRest={id,start:now,duration:RESTS[id].duration};this.next=now+RESTS[id].duration+30+Math.random()*40;return;
    }
    const ids = ['look_around', 'head_tilt', 'tail_wag', 'wave', 'maid_sway', 'clap', 'cheer',
      'yawn_stretch', 'think', 'tic_glance', 'tic_tail_flick', 'tic_smile_peek', 'tic_ear_twitch', 'tic_hands_behind'];
    const choices = ids.filter(id => !this.recent.includes(id) && this.x.findMove(id));
    const id = choices[Math.floor(Math.random() * choices.length)];
    if (!id) { this.next = now + 4; return; }
    this.recent = [id, ...this.recent].slice(0, 4);
    this.ownedMove = id; this.mode = 'gesture';
    this.x.mover().play(this.x.findMove(id), now, this.x.face());
  }
}
