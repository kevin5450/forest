// ======================= event.js (서버가 요약 생성, 클라 주기 로드) =======================

// 1) API (절대 경로)
const API = "http://127.0.0.1:5001/api/issues/latest";
const SUMMARY_API = "http://127.0.0.1:5001/api/issues/summary";

// 2) 포맷 유틸
const pad = (n) => String(n).padStart(2, "0");
function toLocalTime(tsIso) {
  if (!tsIso) return "";
  const d = new Date(tsIso); // 로컬 타임존
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function todayLocalDate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function isTodayLocal(tsIso) {
  if (!tsIso) return false;
  const d = new Date(tsIso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

// 3) 상태 문구(클라-백업용; 서버 메시지가 없을 때만 사용)
function pickStatement(T, H) {
  if (T >= 32 && H >= 80) return "매우 덥고 습해요. 건강·장비 과열 주의";
  if (T >= 28 && H >= 75) return "날씨가 더워요, 습도도 높아요. 주의";
  if (T >= 28 && H <= 40) return "덥고 건조해요. 급격한 수분 손실 주의";
  if (T <= 10 && H >= 75) return "매우 쌀쌀하고 습해요. 응결·곰팡이 주의";
  if (T <= 18 && H >= 75) return "쌀쌀하고 습해요. 환기/제습 필요";
  if (T <= 18 && H <= 40) return "쌀쌀하고 건조해요. 보온/가습 고려";
  if (H >= 85)           return "습도가 매우 높아요. 제습/환기 필수";
  if (H <= 30)           return "습도가 매우 낮아요. 가습/관수 필요";
  if (T >= 28)           return "날씨가 더워요";
  if (T > 18 && T < 28 && H > 40 && H < 75) return "오늘은 맑네요. 상태가 양호합니다.";
  return "상태 판단 불가";
}

// 4) 요약 DOM 보장 (클래스 우선, 없으면 id 백업)
function ensureSummaryNodes() {
  const box =
    document.querySelector(".summary") || document.getElementById("summary");
  if (!box) return {};
  let msg =
    box.querySelector(".summary-msg") || document.getElementById("summary-msg");
  let avg =
    box.querySelector(".summary-avg") || document.getElementById("summary-avg");
  if (!msg) {
    msg = document.createElement("p");
    msg.className = "summary-msg";
    box.appendChild(msg);
  }
  if (!avg) {
    avg = document.createElement("p");
    avg.className = "summary-avg";
    box.appendChild(avg);
  }
  return { msg, avg };
}

// 5) 이슈 테이블 렌더 (새 데이터 없으면 기존 표시 유지)
function paint(rowKey, active) {
  const row = document.querySelector(`tr[data-row="${rowKey}"]`);
  if (!row) return;

  const timeEl = row.querySelector(".time");
  const msgEl = row.querySelector(".msg");

  if (!active) {
    // 초기 완전 비어있을 때만 기본 문구
    if (!timeEl.textContent && !msgEl.textContent.trim()) {
      msgEl.textContent = "현재 이슈 없음";
      msgEl.style.fontWeight = "400";
    }
    return; // 유지
  }

  timeEl.textContent = toLocalTime(active.time_utc);
  msgEl.textContent = active.message || "현재 이슈 없음";
  msgEl.style.fontWeight = "600";
}

// 6) 최신 이슈 로드 (15초 폴링, 오늘 데이터만 표시)
async function loadIssues() {
  try {
    const res = await fetch(API, { cache: "no-store" });
    if (!res.ok) {
      console.warn("API 실패", res.status);
      return;
    }
    const data = await res.json();

    let t = data.temperature?.active || null;
    let h = data.humidity?.active || null;

    if (t && !isTodayLocal(t.time_utc)) t = null;
    if (h && !isTodayLocal(h.time_utc)) h = null;

    // 날짜 배지(클래스 우선, 없으면 id)
    const badge =
      document.querySelector(".diary-date-badge") ||
      document.getElementById("diary-date");
    if (badge) badge.textContent = todayLocalDate();

    paint("temp", t);
    paint("hum", h);
  } catch (e) {
    console.error("loadIssues 에러:", e);
  }
}

// 7) 요약 표시/캐시
function paintSummary(msgLine, avgLine) {
  const { msg, avg } = ensureSummaryNodes();
  if (!msg || !avg) return;
  msg.textContent = msgLine || "";
  avg.textContent = avgLine || "";
  localStorage.setItem("summary_msg", msgLine || "");
  localStorage.setItem("summary_avg", avgLine || "");
  // 날짜는 보존해도 되고 생략해도 됨. 유지 표시 목적이라 생략.
}

// 캐시 먼저 그리기(날짜 무관: 다음 요약 나오기 전까지 유지)
function renderSummaryFromCache() {
  const { msg, avg } = ensureSummaryNodes();
  if (!msg || !avg) return;
  msg.textContent = localStorage.getItem("summary_msg") || "";
  avg.textContent = localStorage.getItem("summary_avg") || "";
}

// 8) 서버에서 최신 요약 주기 로드(정오에 페이지 안 떠 있어도 반영)
async function fetchAndRenderLatestSummary() {
  try {
    const res = await fetch(SUMMARY_API, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (!data) return;

    // 서버 포맷 호환: {message, avg:{temp,humidity}} 또는 {stats:{temp:{avg}, humidity:{avg}}}
    const ta =
      typeof data?.avg?.temp === "number"
        ? data.avg.temp
        : typeof data?.stats?.temp?.avg === "number"
        ? data.stats.temp.avg
        : undefined;
    const ha =
      typeof data?.avg?.humidity === "number"
        ? data.avg.humidity
        : typeof data?.stats?.humidity?.avg === "number"
        ? data.stats.humidity.avg
        : undefined;

    const msg =
      typeof data?.message === "string" && data.message.trim()
        ? data.message
        : typeof ta === "number" && typeof ha === "number"
        ? pickStatement(ta, ha)
        : "";

    const avg =
      typeof ta === "number" && typeof ha === "number"
        ? `평균 온도: ${ta}℃ / 평균 습도: ${ha}%`
        : "";

    // 렌더 + 캐시
    paintSummary(msg, avg);
  } catch (e) {
    console.warn("fetchAndRenderLatestSummary error:", e);
  }
}

// 9) 날짜 바뀌어도 요약은 유지(다음 요약 올 때 덮어씀)
let _lastDate = todayLocalDate();
function checkDateRollover() {
  const nowDate = todayLocalDate();
  if (nowDate !== _lastDate) {
    _lastDate = nowDate;

    const badge =
      document.querySelector(".diary-date-badge") ||
      document.getElementById("diary-date");
    if (badge) badge.textContent = nowDate;

    // 표만 리셋 (요약은 유지)
    paint("temp", null);
    paint("hum", null);

    // 새 이슈가 있으면 반영
    loadIssues();
  }
}

// 10) 초기화
document.addEventListener("DOMContentLoaded", () => {
  // 요약: 캐시 → 서버 최신(10분 주기)
  renderSummaryFromCache();
  fetchAndRenderLatestSummary();
  setInterval(fetchAndRenderLatestSummary, 10 * 60 * 1000);

  // 이슈: 15초 폴링
  loadIssues();
  setInterval(loadIssues, 15000);

  // 날짜 전환 감지
  checkDateRollover();
  setInterval(checkDateRollover, 60 * 1000);
});
