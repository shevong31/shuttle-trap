const API = "http://127.0.0.1:5000/api";
const canvas = document.getElementById("courtCanvas");
const ctx = canvas.getContext("2d");

let gameState = null;
let frameCount = 0;

// Smooth player physics & swing states
let player = { x: 220, targetX: 220, swing: 0, walkPhase: 0 };
let ai     = { x: 740, targetX: 740, swing: 0, walkPhase: 0 };

// Crowd cheers timer
let cheerTimer = 0;

// Generate 72 animated spectators across 3 bleacher rows
const crowd = [];
const shirtPalette = ["#ef4444","#3b82f6","#10b981","#f59e0b","#a855f7","#ec4899","#e2e8f0","#14b8a6"];
const skinPalette  = ["#fde68a","#fdba74","#d97706","#92400e","#fed7aa"];
for (let row = 0; row < 3; row++) {
  const y = 132 + row * 34;
  for (let i = 0; i < 24; i++) {
    crowd.push({
      x: 55 + i * 37 + (row % 2) * 14 + (Math.random() * 6 - 3),
      y,
      shirt: shirtPalette[Math.floor(Math.random() * shirtPalette.length)],
      skin: skinPalette[Math.floor(Math.random() * skinPalette.length)],
      phase: Math.random() * Math.PI * 2,
      speed: 0.04 + Math.random() * 0.04
    });
  }
}

// Shuttlecock parabolic animation & hit particles
let shuttle = { active: false, t: 0, sx: 220, sy: 310, ex: 740, ey: 310, peakY: 120, trail: [], vx: 1, vy: 0 };
let particles = [];
let callouts = [];

function aiRowToX(row)     { return 530 + (4 - row) * 76; }
function playerRowToX(row) { return 430 - (row - 5) * 76; }

function spawnParticles(x, y, color) {
  for (let i = 0; i < 14; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd = 2 + Math.random() * 4;
    particles.push({ x, y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd, life: 1, color });
  }
}

function spawnCallout(text, x, y, color = "#fde047") {
  callouts.push({ text, x, y, life: 1, color });
}

// Controls: Shot buttons & Keyboard (1-4, A/D, Arrows)
document.querySelectorAll(".shot-btn").forEach(btn => {
  btn.addEventListener("click", () => triggerShot(btn.dataset.shot, btn));
});

document.getElementById("moveLeftBtn").addEventListener("click", () => player.targetX = Math.max(115, player.targetX - 55));
document.getElementById("moveRightBtn").addEventListener("click", () => player.targetX = Math.min(430, player.targetX + 55));

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "arrowleft" || k === "a")  player.targetX = Math.max(115, player.targetX - 50);
  if (k === "arrowright" || k === "d") player.targetX = Math.min(430, player.targetX + 50);
  if (k === "1") triggerShot("CLEAR");
  if (k === "2") triggerShot("DROP");
  if (k === "3") triggerShot("SMASH");
  if (k === "4") triggerShot("NET_SHOT");
});

document.getElementById("resetBtn").addEventListener("click", async () => {
  const mode = document.getElementById("modeSelect").value;
  const res = await fetch(`${API}/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode })
  });
  gameState = await res.json();
  player.targetX = 220; ai.targetX = 740;
  shuttle.trail = [];
  spawnCallout("NEW MATCH!", 480, 210, "#38bdf8");
  updateHUD();
});

async function triggerShot(shotType, btnEl = null) {
  document.querySelectorAll(".shot-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.shot === shotType);
  });

  const algorithm = document.getElementById("algoSelect").value;
  const targetRow = shotType === "CLEAR" ? 0 : shotType === "SMASH" ? 2 : 4;
  const targetCol = Math.floor(Math.random() * 4) + 1;

  // Player swing animation + hit sparks
  player.swing = 1.0;
  spawnParticles(player.x + 34, 300, shotType === "SMASH" ? "#f87171" : "#fde047");
  spawnCallout(shotType.replace("_", " ") + "!", player.x + 20, 255, shotType === "SMASH" ? "#f87171" : "#38bdf8");

  const destX = aiRowToX(targetRow);
  const peak = shotType === "CLEAR" ? 55 : shotType === "SMASH" ? 235 : 175;
  launchShuttle(player.x + 34, 295, destX, 315, peak);

  const prevP = gameState ? gameState.player_score : 0;
  const prevA = gameState ? gameState.ai_score : 0;

  const res = await fetch(`${API}/play_shot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shot_type: shotType, target: [targetCol, targetRow], algorithm })
  });
  gameState = await res.json();
  ai.targetX = aiRowToX(gameState.ai_pos[1]);

  // Check if a point was won
  const pointScored = gameState.player_score > prevP || gameState.ai_score > prevA;
  if (pointScored) {
    cheerTimer = 75;
    setTimeout(() => {
      const msg = gameState.player_score > prevP ? "POINT YOU!" : "POINT AI!";
      const clr = gameState.player_score > prevP ? "#4ade80" : "#f87171";
      spawnCallout(msg, 480, 195, clr);
      updateHUD();
    }, 480);
  } else {
    // AI returns shuttle
    setTimeout(() => {
      if (!gameState.winner) {
        ai.swing = 1.0;
        spawnParticles(ai.x - 34, 300, "#fb923c");
        const returnX = playerRowToX(gameState.player_pos[1]);
        launchShuttle(ai.x - 34, 295, returnX, 315, 105);
        player.targetX = returnX;
      }
      updateHUD();
    }, 520);
  }
}

function launchShuttle(sx, sy, ex, ey, peakY) {
  shuttle = { active: true, t: 0, sx, sy, ex, ey, peakY, trail: [], vx: ex - sx, vy: -10 };
}

/* ==================== RENDERING ==================== */

function drawStadium() {
  // Deep arena backdrop
  const wallGrad = ctx.createLinearGradient(0, 0, 0, 275);
  wallGrad.addColorStop(0, "#090d16");
  wallGrad.addColorStop(1, "#1e1b2e");
  ctx.fillStyle = wallGrad;
  ctx.fillRect(0, 0, canvas.width, 275);

  // Overhead stadium spotlight beams
  [180, 480, 780].forEach(lx => {
    const beam = ctx.createRadialGradient(lx, 10, 5, lx, 160, 240);
    beam.addColorStop(0, "rgba(254, 249, 195, 0.28)");
    beam.addColorStop(1, "rgba(254, 249, 195, 0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(lx - 22, 0); ctx.lineTo(lx + 22, 0);
    ctx.lineTo(lx + 180, 275); ctx.lineTo(lx - 180, 275);
    ctx.closePath();
    ctx.fill();

    // Light fixture
    ctx.fillStyle = "#fef08a";
    ctx.fillRect(lx - 18, 0, 36, 7);
  });

  // 3 Bleacher Tiers + Animated Audience
  for (let row = 0; row < 3; row++) {
    const benchY = 142 + row * 34;
    ctx.fillStyle = row === 0 ? "#292524" : row === 1 ? "#3b2f2f" : "#4a3728";
    ctx.fillRect(20, benchY, canvas.width - 40, 20);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(20, benchY, canvas.width - 40, 2);

    // Draw spectators in this row
    crowd.filter(c => Math.abs(c.y - (132 + row * 34)) < 5).forEach(s => {
      const cheering = cheerTimer > 0;
      const bounce = cheering
        ? Math.abs(Math.sin(frameCount * 0.25 + s.phase)) * -9
        : Math.sin(frameCount * s.speed + s.phase) * 1.5;

      const sy = s.y + bounce;
      // Shoulders / Shirt
      ctx.fillStyle = s.shirt;
      ctx.beginPath();
      ctx.roundRect(s.x - 9, sy - 2, 18, 16, 6);
      ctx.fill();
      // Head
      ctx.fillStyle = s.skin;
      ctx.beginPath();
      ctx.arc(s.x, sy - 8, 6.5, 0, Math.PI * 2);
      ctx.fill();
      // Raised cheering arms
      if (cheering) {
        ctx.strokeStyle = s.shirt;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(s.x - 8, sy + 2); ctx.lineTo(s.x - 13, sy - 10);
        ctx.moveTo(s.x + 8, sy + 2); ctx.lineTo(s.x + 13, sy - 10);
        ctx.stroke();
      }
    });
  }

  // Court-side LED Sponsor Barrier
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 240, canvas.width, 32);
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 240); ctx.lineTo(canvas.width, 240); ctx.stroke();

  ctx.fillStyle = "#94a3b8";
  ctx.font = "bold 11px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("THE SHUTTLE TRAP  •  A* PATHFINDING  •  ADAPTIVE AI ENGINE  •  BWF ARENA 2026", 480, 260);
  ctx.textAlign = "left";

  // Hardwood stadium surround floor
  ctx.fillStyle = "#166534";
  ctx.fillRect(0, 272, canvas.width, 208);

  // Perspective Pro Badminton Mat (Rich Emerald Gradient)
  const matGrad = ctx.createLinearGradient(0, 285, 0, 445);
  matGrad.addColorStop(0, "#15803d");
  matGrad.addColorStop(1, "#22c55e");
  ctx.fillStyle = matGrad;
  ctx.beginPath();
  ctx.moveTo(100, 290); ctx.lineTo(860, 290);
  ctx.lineTo(935, 435); ctx.lineTo(25, 435);
  ctx.closePath();
  ctx.fill();

  // Crisp White Court Lines
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Doubles / Singles Back Service Lines & Front Service Lines
  ctx.lineWidth = 2;
  ctx.beginPath();
  // Short service lines
  ctx.moveTo(370, 290); ctx.lineTo(350, 435);
  ctx.moveTo(590, 290); ctx.lineTo(610, 435);
  // Long service lines
  ctx.moveTo(145, 290); ctx.lineTo(80, 435);
  ctx.moveTo(815, 290); ctx.lineTo(880, 435);
  // Center service line
  ctx.moveTo(118, 362); ctx.lineTo(360, 362);
  ctx.moveTo(600, 362); ctx.lineTo(842, 362);
  ctx.stroke();

  // Pro Net with Crosshatch Mesh & White Top Tape
  ctx.fillStyle = "rgba(15, 23, 42, 0.35)";
  ctx.fillRect(475, 245, 10, 185);
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1;
  for (let ny = 250; ny < 425; ny += 10) {
    ctx.beginPath(); ctx.moveTo(475, ny); ctx.lineTo(485, ny + 5); ctx.stroke();
  }
  // Net Post & Top Tape
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(476, 242, 8, 12);
  ctx.fillStyle = "#64748b";
  ctx.fillRect(478, 254, 4, 182);
}

function drawAthlete(p, y, facingRight, jerseyColor, shortColor, hairColor, isPlayer) {
  const dir = facingRight ? 1 : -1;
  const x = p.x;
  const idleBob = Math.sin(frameCount * 0.1) * 2;
  const stride = Math.sin(p.walkPhase) * 9;

  // Floor shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
  ctx.beginPath();
  ctx.ellipse(x, y + 38, 24, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // Pulsing Glowing Ring under Player
  if (isPlayer) {
    const pulse = 2 + Math.sin(frameCount * 0.12) * 1.5;
    ctx.strokeStyle = "#a3e635";
    ctx.lineWidth = pulse;
    ctx.beginPath();
    ctx.ellipse(x, y + 38, 34, 10, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Legs + Shoes
  ctx.strokeStyle = "#fed7aa";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - 4, y + 10); ctx.lineTo(x - 10 + stride, y + 34);
  ctx.moveTo(x + 4, y + 10); ctx.lineTo(x + 10 - stride, y + 34);
  ctx.stroke();

  // Sneakers
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x - 15 + stride, y + 32, 12, 6);
  ctx.fillRect(x + 5 - stride, y + 32, 12, 6);

  // Shorts
  ctx.fillStyle = shortColor;
  ctx.fillRect(x - 11, y + 2, 22, 14);

  // Athletic Jersey + Stripe
  ctx.fillStyle = jerseyColor;
  ctx.beginPath();
  ctx.roundRect(x - 11, y - 24 + idleBob, 22, 28, 5);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(x - 11, y - 12 + idleBob, 22, 5);

  // Head + Hair + Sweatband
  ctx.fillStyle = "#fdba74";
  ctx.beginPath();
  ctx.arc(x, y - 34 + idleBob, 11, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = hairColor;
  ctx.beginPath();
  ctx.arc(x - 2 * dir, y - 37 + idleBob, 10.5, Math.PI * 0.9, Math.PI * 2.1);
  ctx.fill();

  ctx.fillStyle = jerseyColor;
  ctx.fillRect(x - 10, y - 40 + idleBob, 20, 3.5);

  // Animated Racket Swing Angle
  const swingAngle = p.swing > 0 ? Math.sin(p.swing * Math.PI) * 1.4 : 0;
  const armEndX = x + Math.cos(-0.5 + swingAngle) * 24 * dir;
  const armEndY = y - 14 + idleBob + Math.sin(-0.5 + swingAngle) * 24;

  ctx.strokeStyle = "#fdba74";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x + 4 * dir, y - 16 + idleBob);
  ctx.lineTo(armEndX, armEndY);
  ctx.stroke();

  // Racket Shaft & Strung Oval Head
  const rHeadX = armEndX + Math.cos(-0.9 + swingAngle * 1.3) * 22 * dir;
  const rHeadY = armEndY + Math.sin(-0.9 + swingAngle * 1.3) * 22;

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(armEndX, armEndY);
  ctx.lineTo(rHeadX, rHeadY);
  ctx.stroke();

  ctx.strokeStyle = isPlayer ? "#38bdf8" : "#f87171";
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(rHeadX, rHeadY, 7, 11, (0.4 - swingAngle) * dir, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawShuttleAndFX() {
  if (shuttle.active) {
    shuttle.t += 0.048;
    const t = Math.min(1, shuttle.t);
    const prevX = shuttle.trail.length ? shuttle.trail[shuttle.trail.length - 1].x : shuttle.sx;
    const prevY = shuttle.trail.length ? shuttle.trail[shuttle.trail.length - 1].y : shuttle.sy;

    const x = (1 - t) * shuttle.sx + t * shuttle.ex;
    const y = (1 - t) * (1 - t) * shuttle.sy + 2 * (1 - t) * t * shuttle.peakY + t * t * shuttle.ey;
    shuttle.vx = x - prevX;
    shuttle.vy = y - prevY;
    shuttle.trail.push({ x, y });
    if (shuttle.trail.length > 20) shuttle.trail.shift();
    if (t >= 1) shuttle.active = false;
  }

  // Glowing comet trail
  shuttle.trail.forEach((pt, idx) => {
    const alpha = (idx / shuttle.trail.length) * 0.85;
    ctx.fillStyle = `rgba(254, 240, 138, ${alpha})`;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 1.5 + (idx / shuttle.trail.length) * 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // Feathered Shuttlecock + Ground Shadow
  const tip = shuttle.trail[shuttle.trail.length - 1];
  if (tip) {
    // Dynamic shadow on court
    const heightFactor = Math.max(0.25, 1 - (390 - tip.y) / 380);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(tip.x, 385, 9 * heightFactor, 3 * heightFactor, 0, 0, Math.PI * 2);
    ctx.fill();

    // Rotate shuttlecock along flight direction
    const angle = Math.atan2(shuttle.vy, shuttle.vx);
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(angle);
    // Feather skirt
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(2, 0); ctx.lineTo(-11, -6); ctx.lineTo(-11, 6);
    ctx.closePath();
    ctx.fill();
    // Cork tip
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.arc(3, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Hit sparks
  particles = particles.filter(p => p.life > 0);
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy; p.life -= 0.06;
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  });

  // Floating Arcade Callouts
  callouts = callouts.filter(c => c.life > 0);
  callouts.forEach(c => {
    c.y -= 0.9; c.life -= 0.022;
    ctx.save();
    ctx.globalAlpha = Math.max(0, c.life);
    ctx.font = "900 22px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 4;
    ctx.strokeText(c.text, c.x, c.y);
    ctx.fillStyle = c.color;
    ctx.fillText(c.text, c.x, c.y);
    ctx.restore();
  });
}

function updateHUD() {
  if (!gameState) return;
  document.getElementById("pScore").textContent = gameState.player_score;
  document.getElementById("aScore").textContent = gameState.ai_score;
  document.getElementById("serveInfo").textContent = `SERVE • ${gameState.server.toUpperCase()} (${gameState.service_side})`;
  document.getElementById("pStaminaBar").style.width = `${gameState.player_stamina}%`;
  document.getElementById("aStaminaBar").style.width = `${gameState.ai_stamina}%`;
  document.getElementById("pStaminaTxt").textContent = `${gameState.player_stamina}%`;
  document.getElementById("aStaminaTxt").textContent = `${gameState.ai_stamina}%`;
  document.getElementById("aiPrediction").textContent = `${gameState.ai_prediction}  |  ${gameState.suggested_play}`;
  document.getElementById("matchLog").textContent = gameState.winner
    ? `🏆 MATCH OVER! Winner: ${gameState.winner.toUpperCase()}`
    : gameState.log;
}

function renderLoop() {
  frameCount++;
  if (cheerTimer > 0) cheerTimer--;

  // Smooth movement + walking stride + swing decay
  [player, ai].forEach(actor => {
    const dx = actor.targetX - actor.x;
    if (Math.abs(dx) > 1.5) {
      actor.x += dx * 0.14;
      actor.walkPhase += 0.35;
    }
    if (actor.swing > 0) actor.swing = Math.max(0, actor.swing - 0.08);
  });

  drawStadium();

  // Doubles partners (drawn slightly behind in perspective)
  if (gameState && gameState.mode === "doubles") {
    drawAthlete({ x: Math.max(120, player.x - 65), walkPhase: player.walkPhase, swing: 0 }, 318, true, "#0284c7", "#0f172a", "#1e293b", false);
    drawAthlete({ x: Math.min(840, ai.x + 65), walkPhase: ai.walkPhase, swing: 0 }, 318, false, "#f87171", "#0f172a", "#451a03", false);
  }

  // Main Athletes
  drawAthlete(player, 345, true,  "#0ea5e9", "#0f172a", "#1e293b", true);
  drawAthlete(ai,     345, false, "#ef4444", "#18181b", "#451a03", false);

  drawShuttleAndFX();
  requestAnimationFrame(renderLoop);
}

fetch(`${API}/state`).then(r => r.json()).then(data => { gameState = data; updateHUD(); });
renderLoop();