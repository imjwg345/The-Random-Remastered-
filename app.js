import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* ✅ 너 프로젝트 값으로 바꿔 */
const firebaseConfig = {
  apiKey: "AIzaSyCgyGWHWstnTbbOm8UmSMqtOdoNhoV7RvU",
  authDomain: "the-random-remastered.firebaseapp.com",
  projectId: "the-random-remastered",
  storageBucket: "the-random-remastered.firebasestorage.app",
  messagingSenderId: "726117255054",
  appId: "1:726117255054:web:e260d57feb6fa6b80bc6df"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const COL_PLAYERS = "updown_players";

const $ = (id) => document.getElementById(id);

const DIFF = {
  "쉬움": { low: 1, high: 50, max: 8 },
  "보통": { low: 1, high: 100, max: 6 },
  "어려움": { low: 1, high: 500, max: 9 },
};

let state = {
  phase: "start",
  name: "",
  difficulty: "보통",
  dupPenalty: false,

  answer: null,
  used: 0,
  history: [],
  startMs: 0,

  minPossible: 1,
  maxPossible: 100,
};

/* ===== Rules ===== */
function rulesText(){
  const e = DIFF["쉬움"], n = DIFF["보통"], h = DIFF["어려움"];
  return `
  <b>🎯 목표</b><br/>
  - 컴퓨터가 고른 <b>정답 숫자</b>를 제한된 횟수 안에 맞히면 승리!<br/><br/>

  <b>🧩 난이도(범위/기회)</b><br/>
  - 쉬움: <b>${e.low}~${e.high}</b>, 기회 <b>${e.max}번</b><br/>
  - 보통: <b>${n.low}~${n.high}</b>, 기회 <b>${n.max}번</b><br/>
  - 어려움: <b>${h.low}~${h.high}</b>, 기회 <b>${h.max}번</b><br/><br/>

  <b>📌 힌트</b><br/>
  - 작으면 <b>업 ⬆️</b>, 크면 <b>다운 ⬇️</b><br/>
  - 거리 힌트: 🔥 10 이내 / 🌤️ 30 이내 / ❄️ 30 초과<br/><br/>

  <b>🔁 중복 입력 옵션</b><br/>
  - ‘중복 입력도 차감’이 꺼져 있으면 같은 숫자는 <b>기회 차감 없음</b><br/><br/>

  <b>📏 가능 범위</b><br/>
  - 입력할수록 가능 범위가 자동으로 좁혀져 표시됩니다.
  `;
}
function openRules(){
  $("rulesBody").innerHTML = rulesText();
  $("rulesModal").showModal();
}
function closeRules(){ $("rulesModal").close(); }
function autoRulesOnce(){
  const key = "rules_shown_streamlit_like_v1";
  if (localStorage.getItem(key) === "1") return;
  localStorage.setItem(key, "1");
  openRules();
}

/* ===== Helpers ===== */
function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function heatHint(guess, answer){
  const gap = Math.abs(guess - answer);
  if (gap <= 10) return "🔥 뜨겁다(10 이내)";
  if (gap <= 30) return "🌤️ 따뜻하다(30 이내)";
  return "❄️ 차갑다(30 초과)";
}

/* ===== UI ===== */
function setPhase(p){
  state.phase = p;
  $("screenStart").style.display = (p==="start") ? "block" : "none";
  $("screenPlay").style.display  = (p==="playing") ? "block" : "none";
  $("screenEnd").style.display   = (p==="end") ? "block" : "none";
  $("badgePhase").textContent = p.toUpperCase();
}
function setNotice(kind, text){
  const box = $("msgBox");
  box.className = "notice " + (kind ? `notice--${kind}` : "");
  box.textContent = text;
}
function render(){
  const d = DIFF[state.difficulty];
  $("playerName").textContent = state.name || "-";
  $("playerDiff").textContent = state.difficulty;

  const remain = Math.max(0, d.max - state.used);
  $("remain").textContent = String(remain);
  $("range").textContent = `${state.minPossible} ~ ${state.maxPossible}`;
  $("history").textContent = state.history.length ? state.history.join(", ") : "-";

  const pct = d.max ? Math.min(100, (state.used / d.max) * 100) : 0;
  $("progressFill").style.width = `${pct}%`;
  $("progressText").textContent = `${state.used}/${d.max}`;
}

/* ===== Game flow ===== */
function newGame(){
  const d = DIFF[state.difficulty];
  state.answer = randInt(d.low, d.high);
  state.used = 0;
  state.history = [];
  state.startMs = Date.now();
  state.minPossible = d.low;
  state.maxPossible = d.high;

  setPhase("playing");
  setNotice("info", "게임을 시작했습니다! 숫자를 입력해보세요.");
  render();
}
function resetToStart(){
  state.name = "";
  $("nick").value = "";
  setPhase("start");
  // 시작화면 갈 때마다 룰 띄우고 싶으면 아래 줄을 openRules()로 바꾸면 됨
  // openRules();
}
function endGame(kind, text){
  setPhase("end");
  const endBox = $("endBox");
  endBox.className = "notice " + (kind ? `notice--${kind}` : "");
  endBox.textContent = text;

  $("answerText").textContent = String(state.answer ?? "-");
  $("attemptText").textContent = String(state.used);
  $("endHistory").textContent = state.history.length ? state.history.join(", ") : "-";
}

function processGuess(raw){
  const d = DIFF[state.difficulty];
  const s = String(raw || "").trim();
  if (!s) { setNotice("bad", "숫자를 입력하세요."); return; }
  if (!/^\d+$/.test(s)) { setNotice("bad", "숫자만 입력하세요."); return; }

  const g = Number(s);
  if (g < d.low || g > d.high){
    setNotice("bad", `범위 밖입니다. (${d.low}~${d.high})`);
    return;
  }

  if (!state.dupPenalty && state.history.includes(g)){
    setNotice("bad", `이미 입력한 숫자예요: ${g} (차감 안 함)`);
    render();
    return;
  }

  state.used += 1;
  state.history.push(g);
  const remain = d.max - state.used;

  if (g === state.answer){
    const sec = (Date.now() - state.startMs) / 1000;
    endGame("good", `✅ 정답! ${state.used}번 / ${sec.toFixed(2)}초`);
    return;
  }

  if (remain <= 0){
    endGame("bad", `⛔ 게임 종료! 정답은 ${state.answer}`);
    return;
  }

  if (g < state.answer) state.minPossible = Math.max(state.minPossible, g + 1);
  else state.maxPossible = Math.min(state.maxPossible, g - 1);

  const updown = (g < state.answer) ? "업 ⬆️" : "다운 ⬇️";
  const heat = heatHint(g, state.answer);
  setNotice("info", `❌ ${updown} / ${heat} | 남은 기회 ${remain}`);
  render();
}

/* ===== Sidebar ranking (optional, stream without index) ===== */
function fmtSec(x){
  if (x === null || x === undefined) return "-";
  const n = Number(x);
  if (!Number.isFinite(n) || n >= 1e9) return "-";
  return n.toFixed(2);
}
async function loadTop10(){
  const box = $("rankTop10");
  try{
    const snap = await getDocs(collection(db, COL_PLAYERS));
    const rows = [];
    snap.forEach(doc=>{
      const d = doc.data() || {};
      if (d.best_attempts == null) return;
      rows.push({
        name: doc.id,
        a: Number(d.best_attempts),
        t: (d.best_time_sec == null) ? 1e9 : Number(d.best_time_sec),
      });
    });
    rows.sort((x,y)=> (x.a-y.a) || (x.t-y.t));
    const top = rows.slice(0,10);

    box.innerHTML = "";
    if (!top.length){
      box.innerHTML = `<div class="muted">데이터 없음</div>`;
      return;
    }
    top.forEach((r,i)=>{
      const div = document.createElement("div");
      div.className = "sbitem";
      div.innerHTML = `
        <div class="sbitem__top">
          <div class="sbitem__name">${i+1}. ${r.name}</div>
          <div class="muted">${r.a}회</div>
        </div>
        <div class="sbitem__meta">시간: ${fmtSec(r.t)}s</div>
      `;
      box.appendChild(div);
    });
  }catch(e){
    box.innerHTML = `<div class="muted">랭킹 로딩 실패</div>`;
  }
}

/* ===== Bindings ===== */
$("btnShowRules").addEventListener("click", openRules);
$("btnCloseRules").addEventListener("click", closeRules);
$("btnRulesOk").addEventListener("click", closeRules);

$("difficulty").addEventListener("change", (e)=>{ state.difficulty = e.target.value; });
$("dupPenalty").addEventListener("change", (e)=>{ state.dupPenalty = e.target.checked; });

$("btnStartGame").addEventListener("click", ()=>{
  const name = $("nick").value.trim();
  if (!name){
    const n = $("startNotice");
    n.className = "notice notice--bad";
    n.textContent = "닉네임을 입력하세요.";
    return;
  }
  state.name = name;
  $("startNotice").className = "notice notice--info";
  $("startNotice").textContent = "좋아요! 게임을 시작합니다.";
  newGame();
});

$("btnGuess").addEventListener("click", ()=>{
  processGuess($("guess").value);
  $("guess").value = "";
});
$("guess").addEventListener("keydown", (e)=>{
  if (e.key === "Enter"){
    processGuess($("guess").value);
    $("guess").value = "";
  }
});

$("btnRestartRound").addEventListener("click", ()=> newGame());
$("btnGoStart").addEventListener("click", ()=> resetToStart());

$("btnPlayAgain").addEventListener("click", ()=> newGame());
$("btnEndGoStart").addEventListener("click", ()=> resetToStart());

$("btnRefreshRank").addEventListener("click", ()=> loadTop10());

/* init */
setPhase("start");
autoRulesOnce();
loadTop10();
setInterval(loadTop10, 15000);
