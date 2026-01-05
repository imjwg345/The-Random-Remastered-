import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, collection, addDoc, query,
  where, orderBy, limit, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getAuth, signInAnonymously } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

/* 🔑 firebaseConfig (공개 OK) */
const firebaseConfig = {
  apiKey: "AIzaSyCgyGWHWstnTbbOm8UmSMqtOdoNhoV7RvU",
  authDomain: "the-random-remastered.firebaseapp.com",
  projectId: "the-random-remastered",
  appId: "1:726117255054:web:e260d57feb6fa6b80bc6df"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
await signInAnonymously(auth);

const $ = id => document.getElementById(id);

/* 탭 전환 */
document.querySelectorAll(".tab").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    $("viewGame").style.display = btn.dataset.view==="game"?"block":"none";
    $("viewRank").style.display = btn.dataset.view==="rank"?"block":"none";
  };
});

/* ===== 게임 로직 ===== */
let answer = 0;
let remain = 0;
let history = [];
let startTime = 0;

const DIFF = {
  쉬움:{l:1,h:50,m:8},
  보통:{l:1,h:100,m:6},
  어려움:{l:1,h:500,m:9}
};

$("btnStart").onclick = () => {
  const d = DIFF[$("difficulty").value];
  answer = Math.floor(Math.random()*(d.h-d.l+1))+d.l;
  remain = d.m;
  history = [];
  startTime = Date.now();
  $("status").textContent = "게임 시작!";
  $("remain").textContent = remain;
  $("range").textContent = `${d.l}~${d.h}`;
  $("history").textContent = "-";
};

$("btnGuess").onclick = async () => {
  const g = Number($("guess").value);
  if (!g) return;
  history.push(g);
  remain--;
  $("history").textContent = history.join(", ");
  $("remain").textContent = remain;

  if (g === answer) {
    const sec = (Date.now()-startTime)/1000;
    $("status").textContent = `🎉 정답! ${sec.toFixed(2)}초`;
    await addDoc(collection(db,"updown_game_logs"),{
      ts:serverTimestamp(),
      name:$("nick").value,
      result:"win",
      attempts:history.length,
      time_sec:sec,
      difficulty:$("difficulty").value
    });
  } else if (remain<=0) {
    $("status").textContent = `⛔ 실패! 정답은 ${answer}`;
    await addDoc(collection(db,"updown_game_logs"),{
      ts:serverTimestamp(),
      name:$("nick").value,
      result:"loss",
      attempts:history.length,
      difficulty:$("difficulty").value
    });
  } else {
    $("status").textContent = g<answer?"업 ⬆️":"다운 ⬇️";
  }
};

/* ===== 랭킹 로딩 ===== */
async function loadRanks(){
  const today = query(
    collection(db,"updown_game_logs"),
    where("result","==","win"),
    orderBy("ts","desc"),
    limit(10)
  );
  const snap = await getDocs(today);
  $("todayTbody").innerHTML="";
  snap.forEach((d,i)=>{
    const r=d.data();
    $("todayTbody").innerHTML+=
      `<tr><td>${i+1}</td><td>${r.name}</td><td>${r.attempts}</td><td>${r.time_sec?.toFixed(2)}</td></tr>`;
  });

  const recent = query(
    collection(db,"updown_game_logs"),
    orderBy("ts","desc"),
    limit(10)
  );
  const s2 = await getDocs(recent);
  $("recentTbody").innerHTML="";
  s2.forEach(d=>{
    const r=d.data();
    $("recentTbody").innerHTML+=
      `<tr><td>-</td><td>${r.name}</td><td>${r.result}</td><td>${r.attempts}</td></tr>`;
  });
}

loadRanks();
setInterval(loadRanks,10000);
