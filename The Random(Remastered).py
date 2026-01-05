# app.py
# Streamlit 업다운 숫자 맞추기 게임 (Firestore 기록 저장 버전)
# 실행: streamlit run app.py

import json
import random
import time
from datetime import datetime

import streamlit as st

# Firebase Admin
import firebase_admin
from firebase_admin import credentials, firestore


# -----------------------------
# 난이도 설정
# -----------------------------
DIFFICULTIES = {
    "쉬움": {"low": 1, "high": 50, "max_attempts": 8},
    "보통": {"low": 1, "high": 100, "max_attempts": 6},
    "어려움": {"low": 1, "high": 500, "max_attempts": 9},
}

# Firestore 컬렉션 이름
COL_PLAYERS = "updown_players"


# -----------------------------
# Firestore 초기화
# -----------------------------
@st.cache_resource
def get_db():
    """
    Streamlit 앱이 재실행되더라도 Firebase 초기화는 1번만 수행되도록 cache_resource 사용.
    secrets에 firebase_service_account(JSON 문자열)가 있어야 함.
    """
    if not firebase_admin._apps:
        if "firebase_service_account" not in st.secrets:
            raise RuntimeError("Streamlit secrets에 'firebase_service_account'가 없습니다.")

        sa_json = st.secrets["firebase_service_account"]
        sa_dict = json.loads(sa_json)

        cred = credentials.Certificate(sa_dict)
        firebase_admin.initialize_app(cred)

    return firestore.client()


# -----------------------------
# Firestore 기록 로직
# -----------------------------
def player_doc(db, name: str):
    # 이름 그대로 doc id로 쓰면 공백/특수문자 문제가 생길 수 있어 안전하게 strip
    doc_id = name.strip()
    return db.collection(COL_PLAYERS).document(doc_id)


def record_win(db, name: str, difficulty: str, attempts_used: int, seconds_used: float):
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ref = player_doc(db, name)

    def txn_update(transaction):
        snap = ref.get(transaction=transaction)
        if snap.exists:
            data = snap.to_dict()
        else:
            data = {}

        plays = int(data.get("plays", 0)) + 1
        wins = int(data.get("wins", 0)) + 1

        best_attempts = data.get("best_attempts")
        best_time_sec = data.get("best_time_sec")

        if best_attempts is None or attempts_used < best_attempts:
            best_attempts = attempts_used
        if best_time_sec is None or seconds_used < best_time_sec:
            best_time_sec = round(seconds_used, 2)

        by_diff = data.get("by_difficulty", {})
        d = by_diff.get(difficulty, {"plays": 0, "wins": 0, "best_attempts": None})
        d["plays"] = int(d.get("plays", 0)) + 1
        d["wins"] = int(d.get("wins", 0)) + 1
        if d.get("best_attempts") is None or attempts_used < d["best_attempts"]:
            d["best_attempts"] = attempts_used
        by_diff[difficulty] = d

        new_data = {
            "plays": plays,
            "wins": wins,
            "best_attempts": best_attempts,
            "best_time_sec": best_time_sec,
            "last_play": now_str,
            "by_difficulty": by_diff,
        }

        transaction.set(ref, new_data, merge=True)

    db.transaction()(txn_update)


def record_loss(db, name: str, difficulty: str):
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ref = player_doc(db, name)

    def txn_update(transaction):
        snap = ref.get(transaction=transaction)
        if snap.exists:
            data = snap.to_dict()
        else:
            data = {}

        plays = int(data.get("plays", 0)) + 1
        wins = int(data.get("wins", 0))

        by_diff = data.get("by_difficulty", {})
        d = by_diff.get(difficulty, {"plays": 0, "wins": 0, "best_attempts": None})
        d["plays"] = int(d.get("plays", 0)) + 1
        by_diff[difficulty] = d

        new_data = {
            "plays": plays,
            "wins": wins,
            "last_play": now_str,
            "by_difficulty": by_diff,
        }

        transaction.set(ref, new_data, merge=True)

    db.transaction()(txn_update)


def get_leaderboard(db, limit: int = 10):
    """
    best_attempts 오름차순(적을수록 좋음), 동점이면 best_time_sec 오름차순.
    best_attempts가 없는(승리 기록 없는) 사람은 제외.
    """
    q = (
        db.collection(COL_PLAYERS)
        .where("best_attempts", "!=", None)
        .order_by("best_attempts")
        .order_by("best_time_sec")
        .limit(limit)
    )
    docs = q.stream()

    rows = []
    for doc in docs:
        data = doc.to_dict()
        rows.append({
            "name": doc.id,
            "best_attempts": data.get("best_attempts"),
            "best_time_sec": data.get("best_time_sec"),
            "wins": data.get("wins", 0),
            "plays": data.get("plays", 0),
        })
    return rows


# -----------------------------
# 게임 상태(Session State)
# -----------------------------
def init_state():
    st.session_state.setdefault("phase", "start")  # start | playing | end
    st.session_state.setdefault("player_name", "")
    st.session_state.setdefault("difficulty", "보통")

    st.session_state.setdefault("answer", None)
    st.session_state.setdefault("attempts_used", 0)
    st.session_state.setdefault("history", [])
    st.session_state.setdefault("message", "")
    st.session_state.setdefault("status", "info")

    st.session_state.setdefault("start_time", None)
    st.session_state.setdefault("end_time", None)

    st.session_state.setdefault("count_duplicates", False)


def new_game():
    diff = DIFFICULTIES[st.session_state.difficulty]
    st.session_state.answer = random.randint(diff["low"], diff["high"])
    st.session_state.attempts_used = 0
    st.session_state.history = []
    st.session_state.message = "게임을 시작했습니다! 숫자를 입력해보세요."
    st.session_state.status = "info"
    st.session_state.start_time = time.time()
    st.session_state.end_time = None
    st.session_state.phase = "playing"


def reset_to_start():
    st.session_state.phase = "start"
    st.session_state.answer = None
    st.session_state.attempts_used = 0
    st.session_state.history = []
    st.session_state.message = ""
    st.session_state.status = "info"
    st.session_state.start_time = None
    st.session_state.end_time = None


def validate_guess(raw: str, low: int, high: int):
    raw = (raw or "").strip()
    if raw == "":
        return None, "숫자를 입력하세요."
    if not raw.isdigit():
        return None, "숫자만 입력하세요."
    g = int(raw)
    if g < low or g > high:
        return None, f"범위 밖입니다. {low}~{high} 사이로 입력하세요."
    return g, None


def temp_hint(guess: int, answer: int) -> str:
    gap = abs(guess - answer)
    if gap <= 10:
        return "🔥 뜨겁다(10 이내)"
    if gap <= 30:
        return "🌤️ 따뜻하다(30 이내)"
    return "❄️ 차갑다(30 초과)"


def process_guess(db, guess: int):
    diff = DIFFICULTIES[st.session_state.difficulty]
    low, high, max_attempts = diff["low"], diff["high"], diff["max_attempts"]
    answer = st.session_state.answer

    # 중복 입력 처리
    if guess in st.session_state.history and not st.session_state.count_duplicates:
        st.session_state.message = f"이미 입력한 숫자예요: {guess} (시도 횟수는 차감하지 않았어요)"
        st.session_state.status = "error"
        return

    st.session_state.attempts_used += 1
    st.session_state.history.append(guess)

    remaining = max_attempts - st.session_state.attempts_used

    # 정답
    if guess == answer:
        st.session_state.end_time = time.time()
        seconds = st.session_state.end_time - st.session_state.start_time

        st.session_state.message = (
            f"✅ 정답! {st.session_state.player_name}님, "
            f"{st.session_state.attempts_used}번 만에 맞췄어요. (시간: {seconds:.2f}초)"
        )
        st.session_state.status = "success"
        st.session_state.phase = "end"

        # Firestore 승리 기록 저장
        record_win(db, st.session_state.player_name, st.session_state.difficulty, st.session_state.attempts_used, seconds)
        return

    # 실패(횟수 초과)
    if remaining <= 0:
        st.session_state.end_time = time.time()
        st.session_state.message = f"⛔ 게임 종료! 정답은 {answer}였습니다."
        st.session_state.status = "error"
        st.session_state.phase = "end"

        # Firestore 패배 기록 저장
        record_loss(db, st.session_state.player_name, st.session_state.difficulty)
        return

    # 오답 힌트
    updown = "업 ⬆️" if guess < answer else "다운 ⬇️"
    heat = temp_hint(guess, answer)
    st.session_state.message = f"❌ 틀렸습니다. 힌트: **{updown}** / {heat} | 남은 시도: {remaining}"
    st.session_state.status = "info"


# -----------------------------
# UI
# -----------------------------
st.set_page_config(page_title="업다운 숫자 맞추기", page_icon="🎯", layout="centered")
init_state()

st.title("🎯 업다운 숫자 맞추기 (Firestore 기록 저장)")

# DB 연결(사이드바/랭킹에서도 쓰므로 먼저 확보)
try:
    db = get_db()
except Exception as e:
    st.error("Firestore 연결 설정이 필요합니다.")
    st.code(str(e))
    st.stop()

# 사이드바
with st.sidebar:
    st.header("설정")
    st.session_state.difficulty = st.selectbox(
        "난이도",
        list(DIFFICULTIES.keys()),
        index=list(DIFFICULTIES.keys()).index(st.session_state.difficulty),
    )
    st.session_state.count_duplicates = st.toggle(
        "중복 입력도 시도 횟수 차감",
        value=st.session_state.count_duplicates,
    )

    st.divider()
    st.header("랭킹 TOP 10")
    try:
        leaderboard = get_leaderboard(db, limit=10)
        if not leaderboard:
            st.info("아직 승리 기록이 없어요.")
        else:
            for i, row in enumerate(leaderboard, start=1):
                t = "-" if row["best_time_sec"] is None else f'{row["best_time_sec"]:.2f}s'
                st.write(f"{i}. **{row['name']}** — {row['best_attempts']}회 / {t} (승:{row['wins']}, 판:{row['plays']})")
    except Exception as e:
        st.warning("랭킹을 불러오지 못했어요.")
        st.code(str(e))


# 화면 전환
if st.session_state.phase == "start":
    st.subheader("시작하기")
    name = st.text_input("플레이어 이름", value=st.session_state.player_name, placeholder="예: 임주완")

    c1, c2 = st.columns([1, 1])
    with c1:
        if st.button("게임 시작", type="primary"):
            name = (name or "").strip()
            if not name:
                st.warning("이름을 입력하세요.")
            else:
                st.session_state.player_name = name
                new_game()
                st.rerun()

    with c2:
        st.caption("난이도/중복차감 옵션은 왼쪽에서 변경 가능")

elif st.session_state.phase == "playing":
    diff = DIFFICULTIES[st.session_state.difficulty]
    low, high, max_attempts = diff["low"], diff["high"], diff["max_attempts"]

    st.write(f"플레이어: **{st.session_state.player_name}** | 난이도: **{st.session_state.difficulty}**")
    st.progress(st.session_state.attempts_used / max_attempts)

    if st.session_state.message:
        if st.session_state.status == "success":
            st.success(st.session_state.message)
        elif st.session_state.status == "error":
            st.error(st.session_state.message)
        else:
            st.info(st.session_state.message)

    with st.form("guess_form", clear_on_submit=True):
        raw = st.text_input(f"{low}~{high} 사이 정수 입력", placeholder=f"{low}~{high}")
        submitted = st.form_submit_button("확인")
        if submitted:
            guess, err = validate_guess(raw, low, high)
            if err:
                st.warning(err)
            else:
                process_guess(db, guess)
                st.rerun()

    remaining = max_attempts - st.session_state.attempts_used
    st.caption(f"남은 시도: **{remaining}** / 총 **{max_attempts}**")

    if st.session_state.history:
        st.subheader("입력 히스토리")
        st.write(", ".join(map(str, st.session_state.history)))

    a, b = st.columns(2)
    with a:
        if st.button("이번 게임 다시 시작"):
            new_game()
            st.rerun()
    with b:
        if st.button("시작 화면으로"):
            reset_to_start()
            st.rerun()

elif st.session_state.phase == "end":
    if st.session_state.status == "success":
        st.success(st.session_state.message)
    else:
        st.error(st.session_state.message)

    st.write(f"정답: **{st.session_state.answer}**")
    if st.session_state.history:
        st.write("입력 기록:", ", ".join(map(str, st.session_state.history)))

    c1, c2 = st.columns(2)
    with c1:
        if st.button("다시 시작", type="primary"):
            new_game()
            st.rerun()
    with c2:
        if st.button("시작 화면"):
            reset_to_start()
            st.rerun()
