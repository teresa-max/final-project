// Fall - main script

// ===== setup =====
const $ = (id) => document.getElementById(id);
const canvas = $("scene");
const ctx = canvas.getContext("2d");
const [veil, hintEl, titleEl, soundBtn, bgm] = [
  "veil", "hint", "title", "sound", "bgm",
].map($);
const dots = document.querySelectorAll("#dots span");

let W = 0, H = 0;
let leaves = [];
let snow = [];
let time = 0;

// ===== helpers =====
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const mix = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// get a colour from a list of [position, colour] stops
function ramp(stops, t) {
  t = clamp(t, 0, 1);
  const i = Math.max(1, stops.findIndex(([at]) => at >= t));
  const [t0, c0] = stops[i - 1];
  const [t1, c1] = stops[i];
  return mix(c0, c1, (t - t0) / (t1 - t0));
}

// filled circle (the sun, snowflakes) and a straight line
function dot(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
function line(x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// soft round light, used for the sun, the mouse and the pile spot
function glow(x, y, r, colour, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgb(colour, alpha));
  g.addColorStop(1, rgb(colour, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// ===== colours =====
const LEAF = [[0, [78, 112, 52]], [0.5, [212, 160, 56]], [1, [172, 54, 36]]];
const SKY = [[0, [238, 218, 176]], [0.3, [234, 152, 92]], [0.6, [122, 86, 122]],
  [1, [22, 26, 48]]]; // day to night

// starting sky depends on the real time: morning, afternoon, evening, night
function skyFromClock() {
  const h = new Date().getHours();
  return h >= 6 && h < 11 ? 0 : h >= 11 && h < 16 ? 0.12 : h >= 16 && h < 19 ? 0.32 : 0.55;
}
let skyT = 0;
let winter = 0; // fade to the grey sky at the end
let camY = 0; // moves the ground up in the last transition
let canopy = 1; // dark green background behind the leaves
let canopyTarget = 1;

// ===== ground =====
// the bottom is split into columns, each one stores how high the pile is
const COL = 6;
let ground = [];
const initGround = () => (ground = new Array(Math.ceil(W / COL) + 1).fill(0));
const floorAt = (x) => H - ground[clamp(Math.floor(x / COL), 0, ground.length - 1)];
function addToGround(x, size) {
  const half = Math.ceil((size * 0.8) / COL);
  const c = Math.floor(x / COL);
  for (let i = Math.max(0, c - half); i <= c + half && i < ground.length; i++) {
    const f = 1 - Math.abs(i - c) / (half + 1);
    ground[i] = Math.min(ground[i] + size * 0.16 * f, H * 0.3);
  }
}

// ===== input =====
// pointer events work for both mouse and touch
const pointer = { x: -9999, y: -9999, on: false, down: false };
let wind = 0; // only blows in scene 2

canvas.addEventListener("pointermove", (e) => {
  if (pointer.on && pointer.down) scene().onDrag?.(e.clientX - pointer.x, e.clientY - pointer.y);
  Object.assign(pointer, { x: e.clientX, y: e.clientY, on: true });
});
canvas.addEventListener("pointerdown", (e) => {
  initAudio();
  Object.assign(pointer, { x: e.clientX, y: e.clientY, on: true, down: true });
  canvas.setPointerCapture(e.pointerId);
  scene().onDown?.();
});
const pointerEnd = (e) => {
  pointer.down = false;
  if (e.pointerType !== "mouse") pointer.on = false; // finger lifted
};
canvas.addEventListener("pointerup", pointerEnd);
canvas.addEventListener("pointercancel", pointerEnd);
canvas.addEventListener("pointerleave", () => (pointer.on = pointer.down));

// ===== sound =====
// no sound files except the music, the rest is made from white noise
let audio, master, windGain, noise;
let lastRustle = 0;
let soundOn = true;

function initAudio() {
  if (audio) return;
  audio = new AudioContext();
  master = new GainNode(audio);
  master.connect(audio.destination);
  noise = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
  noise.getChannelData(0).forEach((_, i, d) => (d[i] = Math.random() * 2 - 1));

  // wind: low noise on a loop, volume follows the wind
  const src = new AudioBufferSourceNode(audio, { buffer: noise, loop: true });
  const lp = new BiquadFilterNode(audio, { type: "lowpass", frequency: 500 });
  windGain = new GainNode(audio, { gain: 0 });
  src.connect(lp).connect(windGain).connect(master);
  src.start();
}

// short high burst of noise, sounds like leaves
function rustle(strength) {
  if (!audio || audio.currentTime - lastRustle < 0.08) return;
  const t = (lastRustle = audio.currentTime);
  const src = new AudioBufferSourceNode(audio, { buffer: noise });
  const bp = new BiquadFilterNode(audio, {
    type: "bandpass", frequency: rand(2500, 4000), Q: 0.8,
  });
  const g = new GainNode(audio, { gain: 0 });
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.25 * strength, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  src.connect(bp).connect(g).connect(master);
  src.start(t, Math.random(), 0.6);
}

// music starts with the begin button (browsers block autoplay)
$("begin").addEventListener("click", () => {
  initAudio();
  bgm.volume = 0.5;
  bgm.play().catch(() => {}); // fine if there's no music file yet
  hideTitle();
});
soundBtn.addEventListener("click", () => {
  initAudio();
  soundOn = !soundOn;
  master.gain.value = soundOn ? 1 : 0;
  bgm.muted = !soundOn;
  soundBtn.textContent = soundOn ? "sound on" : "sound off";
});

// ===== leaf =====
// the leaf shape, also used for the close-up at the end
function leafPath(s) {
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.bezierCurveTo(s * 0.75, -s * 0.5, s * 0.6, s * 0.55, 0, s);
  ctx.bezierCurveTo(-s * 0.6, s * 0.55, -s * 0.75, -s * 0.5, 0, -s);
}

class Leaf {
  constructor(x, y, size) {
    Object.assign(this, { x, y, size, vx: 0, vy: 0, spin: 0, flip: 0, tremble: 0, slow: false });
    this.angle = rand(0, 6.28);
    this.phase = rand(0, 6.28);
    this.warmth = rand(0, 0.15); // 0 green, 1 red
    this.shade = rand(0, 0.2);
    this.state = "attached"; // attached / falling / ground / gone
  }

  detach(vx, vy) {
    Object.assign(this, { state: "falling", vx, vy, spin: rand(-2, 2) });
  }

  update(dt) {
    if (this.state !== "falling") return;
    const drag = Math.pow(0.25, dt); // air resistance
    this.vy = (this.vy + (this.slow ? 80 : 140) * dt) * drag;
    this.vx = (this.vx + (Math.sin(time * 2.5 + this.phase) * 60 + wind * 360) * dt) * drag;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle += this.spin * dt;
    this.flip += dt * (2 + Math.abs(this.vx) * 0.01); // turning over
    this.warmth = Math.min(1, this.warmth + dt * 0.15); // redder as it falls

    if (this.x < -80 || this.x > W + 80 || this.y < -H) this.state = "gone";
    else if (this.vy > 0 && this.y >= floorAt(this.x)) {
      Object.assign(this, { y: floorAt(this.x), state: "ground", flip: 0 });
      addToGround(this.x, this.size);
    }
  }

  draw() {
    let x = this.x;
    let a = this.angle;
    let sx = 1;
    if (this.state === "attached") {
      const sway = Math.sin(time * 1.6 + this.phase);
      x += sway * (1.5 + wind * 10);
      a += sway * (0.04 + wind * 0.25) + this.tremble;
    } else if (this.state === "falling") sx = Math.cos(this.flip);

    const c = mix(ramp(LEAF, this.warmth), [30, 20, 10], this.shade + (sx < 0) * 0.15);
    ctx.save();
    ctx.translate(x, this.y);
    ctx.rotate(a);
    ctx.scale(Math.abs(sx) < 0.08 ? 0.08 : sx, 1);
    leafPath(this.size);
    ctx.fillStyle = rgb(c);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.2)"; // middle line + stem
    ctx.lineWidth = 1;
    line(0, this.size * 0.9, 0, -this.size * 1.2);
    ctx.restore();
  }
}

// ===== scenes =====
let totalLeaves = 1;

// scene 1: hover to turn the leaves warm
const summer = {
  hint: "linger — your warmth turns the leaves",
  enter() {
    winter = camY = 0;
    canopy = canopyTarget = 1;
    document.body.classList.remove("winter");
    skyT = skyFromClock();
    initGround();
    snow = [];
    leaves = [];
    // two layers of leaves on a loose grid so it looks full
    const sp = clamp(Math.min(W, H) / 12, 34, 64);
    for (let off = 0; off <= sp / 2; off += sp / 2)
      for (let y = off - sp / 2; y < H + sp + off; y += sp)
        for (let x = off - sp / 2; x < W + sp + off; x += sp)
          leaves.push(new Leaf(x + rand(-0.45, 0.45) * sp, y + rand(-0.45, 0.45) * sp, sp * rand(0.55, 0.8)));
    totalLeaves = leaves.length;
  },
  update(dt) {
    if (titleShown) return; // nothing changes until you press begin
    const r = clamp(Math.min(W, H) * 0.14, 70, 140);
    for (const l of leaves) {
      const d = Math.hypot(l.x - pointer.x, l.y - pointer.y);
      const near = pointer.on && d < r ? 1 - d / r : 0;
      l.warmth = Math.min(1, l.warmth + dt * (0.012 + 1.5 * near));
    }
    if (leaves.filter((l) => l.warmth > 0.5).length > leaves.length * 0.4) goTo(1);
  },
  drawFront() {
    // warm glow around the mouse
    const r = clamp(Math.min(W, H) * 0.16, 80, 160);
    if (pointer.on && !titleShown) glow(pointer.x, pointer.y, r, [255, 205, 130], 0.28);
  },
};

// scene 2: the wind comes and the leaves let go one by one
const windScene = {
  hint: "the wind takes them, one by one",
  enter() {
    for (const l of leaves) l.dropAt = time + rand(0.5, 9); // each leaf has its own moment
  },
  update() {
    // a soft breeze that comes and goes
    wind = 0.35 + 0.2 * Math.sin(time * 1.3);
    for (const l of leaves) {
      l.warmth = Math.min(1, l.warmth + 0.001);
      if (l.state === "attached" && time > l.dropAt) l.detach(rand(20, 120), rand(-40, 10));
    }
    canopyTarget = leaves.filter((l) => l.state === "attached").length / totalLeaves;
    if (canopyTarget < 0.08) goTo(2); // the last few keep falling in scene 3
  },
};

// scene 3: sweep some leaves into a small pile in the middle
const sweep = {
  hint: "hold and drag — sweep the leaves into a little pile",
  enter() {
    Object.assign(this, { done: false, pile: 0, strokes: 0, counted: false });
    canopyTarget = 0;
  },
  onDown() {
    this.counted = false; // every press of the mouse is a new sweep
  },
  onDrag(dx) {
    if (this.done || pointer.y < H * 0.4) return;
    let moved = 0;
    for (const l of leaves) {
      const d = Math.abs(l.x - pointer.x);
      if (l.state !== "ground" || l.inPile || d > 100) continue;
      // pushed along like a broom
      l.x = clamp(l.x + dx * (1 - d / 100) * 0.5, 10, W - 10);
      l.angle += dx * 0.01;
      l.swept = true;
      moved++;
    }
    if (moved && Math.abs(dx) > 4) rustle(Math.min(0.6, moved / 40));
    if (moved && !this.counted) {
      this.counted = true;
      this.strokes++;
    }
  },
  update(dt) {
    // leaves left over from scene 2
    for (const l of leaves) if (l.state === "attached" && time > l.dropAt) l.detach(rand(-30, 30), 0);
    // flatten the old ground so the leaves lie flat
    ground = ground.map((g) => g * Math.pow(0.3, dt));

    // the pile is a small dome that grows as more leaves reach it
    const r = clamp(this.pile * 3, 30, W * 0.09);
    const top = clamp(this.pile * 4.5, 25, H * 0.17);
    const k = Math.min(1, dt * 6);
    let joined = false;
    for (const l of leaves) {
      if (l.state !== "ground") continue;
      // only leaves you actually swept can join the pile
      if (!l.inPile && l.swept && Math.abs(l.x - W / 2) < W * 0.05) {
        // u, v = its spot inside the dome (more near the top so it looks full)
        Object.assign(l, { inPile: true, u: rand(-1, 1), v: Math.sqrt(Math.random()) });
        joined = true;
        this.pile++;
      }
      const x = l.inPile ? W / 2 + l.u * r : l.x;
      const y = l.inPile ? H - 4 - l.v * top * (1 - l.u * l.u) : H - 6;
      l.x = lerp(l.x, x, k);
      l.y = lerp(l.y, y, k);
    }
    // pile leaves get drawn last so they sit on top of the flat ones
    if (joined) leaves.sort((a, b) => !!a.inPile - !!b.inPile);

    if (!this.done && this.pile >= 30 && this.strokes >= 4) {
      // pile is done: a soft gust lifts one leaf off the top, then evening comes
      this.done = true;
      setHint("");
      const high = leaves.filter((l) => l.inPile).sort((a, b) => a.y - b.y)[0];
      if (high) Object.assign(high, { inPile: false, slow: true }).detach(120, -320);
      setTimeout(() => goTo(3), 3000);
    }
  },
  drawFront() {
    // a faint glow on the ground where the pile should go
    if (!this.done) glow(W / 2, H, W * 0.1, [255, 236, 200], 0.25);
  },
};

// scene 4: hold to let the last leaf go, then keep it in a book
const lastLeaf = {
  hint: "",
  enter() {
    Object.assign(this, { hold: 0, state: "intro", t: 0, b: 0, open: 1, canRestart: false });
    const y = H * 0.28;
    const p = [[-20, y - 10], [W * 0.22, y + H * 0.035], [W * 0.42, y + H * 0.02]];
    // [x1, y1, x2, y2, thickness] for every piece of the branch
    this.branch = [
      [...p[0], ...p[1], 14], [...p[1], ...p[2], 10],
      [...p[2], W * 0.62, y + H * 0.08, 6],
      [...p[1], W * 0.3, y - H * 0.06, 2.5], [...p[2], W * 0.47, y - H * 0.05, 2.5],
      [W * 0.12, y + H * 0.01, W * 0.16, y + H * 0.09, 2.5],
    ];
    const s = clamp(Math.min(W, H) * 0.045, 22, 38);
    this.leaf = new Leaf(W * 0.62 + 3, y + H * 0.08 + s, s);
    Object.assign(this.leaf, { warmth: 1, shade: 0, angle: 0.12, slow: true });
  },
  onDown() {
    if (!this.canRestart) return;
    titleEl.classList.remove("show");
    goTo(0, true);
  },
  update(dt) {
    const L = this.leaf;
    if (this.state === "intro") {
      // transition 3 -> 4: the camera moves down, the pile slides up and away, the branch rises in
      this.t = Math.min(1, this.t + dt / 4);
      winter = ease(this.t);
      camY = -winter * H;
      if (this.t < 1) return;
      [leaves, camY, this.state] = [[L], 0, "hanging"];
      initGround();
      document.body.classList.add("winter");
      setHint("hold on… then let go");
    } else if (this.state === "hanging") {
      this.hold = clamp(this.hold + (pointer.down ? dt / 2.5 : -dt * 0.8), 0, 1);
      L.tremble = Math.sin(time * 35) * 0.25 * this.hold * this.hold;
      if (this.hold < 1) return;
      [this.state, this.dropY, L.tremble] = ["falling", L.y, 0];
      L.detach(rand(10, 30), 0);
      L.spin = 1.2;
      rustle(0.3);
      setHint("");
    } else if (this.state === "falling" && L.y > this.dropY + H * 0.25) {
      // halfway down, catch it and bring it closer
      Object.assign(this, { state: "pressing", t: 0, sx: L.x, sy: L.y, sa: L.angle, s0: L.size });
      [L.state, leaves] = ["kept", []];
    } else if (this.state === "pressing") {
      // 0-2s: lift it and zoom in, 3.5-5.5s: a book comes up, 6-7.2s: it closes
      this.t += dt;
      const a = ease(clamp(this.t / 2, 0, 1));
      this.b = ease(clamp((this.t - 3.5) / 2, 0, 1));
      this.open = 1 - ease(clamp((this.t - 6) / 1.2, 0, 1));
      const bk = this.book();
      L.x = lerp(lerp(this.sx, W / 2, a), bk.cx + bk.w / 4, this.b);
      L.y = lerp(lerp(this.sy, H * 0.45, a), bk.cy, this.b);
      L.size = lerp(lerp(this.s0, this.s0 * 4, a), bk.h * 0.32, this.b);
      L.angle = lerp(this.sa, 0.15, a);
      if (this.t > 7.6) this.finish();
    } else if (this.state === "done" && snow.length < 260 && Math.random() < dt * 40) {
      snow.push({ x: rand(0, W), y: -10, r: rand(1, 3), vy: rand(20, 50), p: rand(0, 6) });
    }
  },
  finish() {
    this.state = "done";
    setHint("you can't keep autumn, but you can keep one leaf");
    titleEl.innerHTML = '<h1>fall</h1><p class="small">tap to begin again</p>';
    titleEl.classList.add("show", "end");
    setTimeout(() => (this.canRestart = true), 3000);
  },
  drawBack() {
    ctx.save();
    if (this.state === "intro") ctx.translate(0, camY + H); // coming up from below
    ctx.strokeStyle = "rgb(52,46,48)";
    ctx.lineCap = "round";
    for (const [x1, y1, x2, y2, w] of this.branch) {
      ctx.lineWidth = w;
      line(x1, y1, x2, y2);
    }
    if (this.state === "intro") this.leaf.draw();
    ctx.restore();
  },
  // where the book is: it rises from below and slides to the centre as it closes
  book() {
    const w = Math.min(W * 0.75, 560);
    const cx = W / 2 - (w / 4) * (1 - this.open);
    return { cx, cy: lerp(H * 1.5, H * 0.6, this.b), w, h: w * 0.68 };
  },
  drawBook(front) {
    const { cx, cy, w, h } = this.book();
    const top = cy - h / 2;
    const cover = "rgb(120,52,40)";
    if (!front) {
      ctx.fillStyle = cover; // cover behind the pages
      if (this.open > 0.5) ctx.fillRect(cx - w / 2 - 8, top - 8, w / 2 + 8, h + 16);
      ctx.fillRect(cx, top - 8, w / 2 + 8, h + 16);
      ctx.fillStyle = "rgb(242,234,216)"; // right page
      ctx.fillRect(cx, top, w / 2, h);
      return;
    }
    // the left page turns over the right one: its width goes from +w/2 to -w/2
    const lw = (w / 2) * (2 * this.open - 1);
    ctx.fillStyle = lw >= 0 ? "rgb(236,227,207)" : cover;
    ctx.fillRect(cx, top, -lw, h);
    if (this.open < 0.05) {
      ctx.fillStyle = "rgba(246,236,217,0.85)";
      ctx.font = "italic 22px 'Cormorant Garamond', Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText("autumn " + new Date().getFullYear(), cx + w / 4, cy);
    }
  },
  // a more detailed leaf for the close-up
  drawBigLeaf(L) {
    const s = L.size;
    ctx.save();
    ctx.translate(L.x, L.y);
    ctx.rotate(L.angle);
    // stem
    ctx.strokeStyle = "rgb(96,46,30)";
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1.5, s * 0.035);
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.95);
    ctx.quadraticCurveTo(s * 0.04, -s * 1.15, s * 0.1, -s * 1.3);
    ctx.stroke();
    // leaf, darker at the edges
    leafPath(s);
    const g = ctx.createLinearGradient(-s * 0.6, 0, s * 0.6, 0);
    [[0, "rgb(150,44,30)"], [0.45, "rgb(196,78,46)"], [1, "rgb(140,40,28)"]].forEach((c) => g.addColorStop(...c));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip(); // everything below stays inside the leaf
    // main vein, thick at the stem and thin at the tip
    ctx.fillStyle = "rgba(90,24,14,0.45)";
    ctx.beginPath();
    [[-0.02, -1], [0.02, -1], [0, 0.95]].forEach(([px, py]) => ctx.lineTo(px * s, py * s));
    ctx.fill();
    // side veins curve up towards the edge
    ctx.strokeStyle = "rgba(90,24,14,0.22)";
    ctx.lineWidth = Math.max(0.8, s * 0.008);
    for (let i = 0; i < 6; i++) {
      const y = -s * 0.65 + i * s * 0.26;
      const len = s * (0.5 - Math.abs(i - 2) * 0.05);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.quadraticCurveTo(side * len * 0.5, y - s * 0.04, side * len, y - s * 0.22);
        ctx.stroke();
      }
    }
    glow(-s * 0.2, -s * 0.3, s * 0.8, [255, 220, 180], 0.18); // soft light
    ctx.restore();
  },
  drawFront() {
    if (this.state === "pressing" || this.state === "done") {
      if (this.b > 0) this.drawBook(false);
      if (this.open > 0.5) this.drawBigLeaf(this.leaf);
      if (this.b > 0) this.drawBook(true);
    } else if (this.state === "hanging" && this.hold > 0) {
      // circle that fills up while you hold
      ctx.strokeStyle = "rgba(60,50,52,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const { x, y, size } = this.leaf;
      ctx.arc(x, y, size * 1.8, -Math.PI / 2, -Math.PI / 2 + this.hold * 6.28);
      ctx.stroke();
    }
  },
};

const SCENES = [summer, windScene, sweep, lastLeaf];
let current = 0;
const scene = () => SCENES[current];

// ===== switching scenes =====
let busy = false;
function goTo(i, useVeil = false) {
  if (busy) return;
  busy = true;
  const swap = () => {
    current = i;
    SCENES[i].enter();
    dots.forEach((d, k) => d.classList.toggle("active", k === i));
    setHint(SCENES[i].hint);
    busy = false;
    veil.classList.remove("on");
  };
  // fade to black only when starting over
  if (useVeil) veil.classList.add("on");
  setTimeout(swap, useVeil ? 1400 : 0);
}

function setHint(text) {
  hintEl.classList.remove("show");
  setTimeout(() => {
    hintEl.textContent = text;
    hintEl.classList.toggle("show", !!text);
  }, 700);
}

let titleShown = true;
function hideTitle() {
  if (!titleShown) return;
  titleShown = false;
  titleEl.classList.remove("show");
  setTimeout(() => setHint(summer.hint), 1200);
}

// ===== drawing =====
function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgb(mix(ramp(SKY, skyT + 0.18), [168, 170, 178], winter)));
  g.addColorStop(1, rgb(mix(ramp(SKY, skyT), [222, 221, 224], winter)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawSun() {
  const fade = 1 - winter;
  const sx = W * 0.68;
  const sy = lerp(H * 0.22, H * 1.1, clamp(skyT / 0.75, 0, 1));
  const c = mix([255, 236, 190], [240, 110, 60], clamp(skyT / 0.6, 0, 1));
  const r = Math.min(W, H) * 0.07;
  glow(sx, sy, r * 4, c, 0.45 * fade);
  ctx.fillStyle = rgb(c, 0.95 * fade);
  dot(sx, sy, r);
}

function draw() {
  drawSky();
  if (winter < 1) drawSun();
  ctx.fillStyle = rgb([30, 46, 26], canopy);
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(0, camY);
  if (camY) ctx.globalAlpha = 1 - winter; // the pile fades as it slides away
  // the earth under the pile
  ctx.fillStyle = "rgb(66,40,26)";
  ctx.beginPath();
  ctx.moveTo(0, H);
  ground.forEach((g, i) => ctx.lineTo(i * COL, H - g * 0.85));
  ctx.lineTo(W, H);
  ctx.fill();
  // ground leaves first, falling ones on top
  for (const st of ["ground", "attached", "falling"]) leaves.forEach((l) => l.state === st && l.draw());
  ctx.restore();

  scene().drawBack?.();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (const f of snow) dot(f.x, f.y, f.r);
  scene().drawFront?.();
}

// ===== main loop =====
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;

  wind *= Math.pow(0.3, dt); // the wind dies down after scene 2

  scene().update(dt);
  canopy = lerp(canopy, canopyTarget, Math.min(1, dt * 1.5));
  leaves.forEach((l) => l.update(dt));
  leaves = leaves.filter((l) => l.state !== "gone");

  for (const f of snow) [f.y, f.x] = [f.y + f.vy * dt, f.x + Math.sin(time + f.p) * 12 * dt];
  snow = snow.filter((f) => f.y < H + 10);

  windGain?.gain.setTargetAtTime(current <= 1 ? wind * 0.3 : 0, audio.currentTime, 0.1);

  draw();
  requestAnimationFrame(frame);
}

// ===== start =====
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  [W, H] = [innerWidth, innerHeight];
  [canvas.width, canvas.height] = [W * dpr, H * dpr];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  initGround();
  for (const l of leaves) if (l.state === "ground") l.state = "falling";
}
addEventListener("resize", resize);

resize();
summer.enter();
requestAnimationFrame(frame);
