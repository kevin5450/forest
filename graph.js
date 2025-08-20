// ====== 설정 ======
const API_BASE = "http://localhost:8001";
const REFRESH_MS = 60_000;
const DEFAULT_METRIC = { key: "temp", label: "온도 (°C)" };
const DEVICE_FILTER = "";

// ====== 유틸 ======
async function fetchAgg(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}
function toXY(rows) {
  const x = rows.map(r => new Date(r.t));
  const y = rows.map(r => r.v);
  return { x, y };
}
function minMaxMarkers(x, y) {
  if (!y.length) return [];
  let imin = 0, imax = 0;
  for (let i = 1; i < y.length; i++) {
    if (y[i] < y[imin]) imin = i;
    if (y[i] > y[imax]) imax = i;
  }
  const mk = { size: 10, symbol: "circle-open", line: { width: 2 } };
  return [
    { x:[x[imin]], y:[y[imin]], mode:"markers+text", text:["min"], textposition:"top right",
      marker:mk, hovertemplate:"최소: %{y:.2f}<extra></extra>" },
    { x:[x[imax]], y:[y[imax]], mode:"markers+text", text:["max"], textposition:"bottom right",
      marker:mk, hovertemplate:"최대: %{y:.2f}<extra></extra>" }
  ];
}

const LAYOUT_BASE = {
  margin:{ l:55, r:10, t:10, b:40 },
  paper_bgcolor:"#111827",
  plot_bgcolor:"#111827",
  xaxis:{ gridcolor:"#1f2937" },
  yaxis:{ gridcolor:"#1f2937" },
  font:{ color:"#e5e7eb" },
  showlegend:false
};

function buildUrls(metricKey) {
  return {
    hourly:  `${API_BASE}/api/agg/hourly?metric=${metricKey}&hours=24${DEVICE_FILTER}`,
    daily:   `${API_BASE}/api/agg/daily?metric=${metricKey}&days=15${DEVICE_FILTER}`,
    monthly: `${API_BASE}/api/agg/monthly?metric=${metricKey}&months=12${DEVICE_FILTER}`
  };
}

// 공통 그리기 함수
async function drawOne(divId, url, ytitle, xaxisTitle, tickformat) {
  try {
    const rows = await fetchAgg(url);
    const { x, y } = toXY(rows);

    const line = { x, y, mode:"lines", hovertemplate: "%{y:.2f}<br>%{x}<extra></extra>" };
    const markers = minMaxMarkers(x, y);

    const layout = {
      ...LAYOUT_BASE,
      xaxis: { ...LAYOUT_BASE.xaxis, title:xaxisTitle, tickformat, automargin:true },
      yaxis: { ...LAYOUT_BASE.yaxis, title:ytitle, automargin:true }
    };
    if (!y.length) layout.yaxis.range = [0, 1];

    Plotly.react(divId, [line, ...markers], layout, { responsive:true });
  } catch (e) {
    console.warn(divId, "API 오류 또는 데이터 없음", e);
    Plotly.react(divId, [], {
      ...LAYOUT_BASE,
      xaxis: { ...LAYOUT_BASE.xaxis, title:xaxisTitle, tickformat },
      yaxis: { ...LAYOUT_BASE.yaxis, title:ytitle, range:[0,1] }
    });
  }
}

// 월별 전용(최근 12개월 값을 현재월부터 라벨 회전해 표시)
async function drawMonthly(divId, url, ytitle) {
  try {
    const rows = await fetchAgg(url);           // 최근 12개월 (오래된→최신 가정)
    const { x, y } = toXY(rows);

    // 최근 12개월의 (연,월) -> 값 매핑
    const monthMap = new Map(); // key: `${year}-${month}`, but 우리는 월 이름 순환 표시가 목적
    x.forEach((d, i) => monthMap.set(`${d.getFullYear()}-${d.getMonth()}`, y[i]));

    // 현재월부터 12개월 라벨 만들기 (영문 약어)
    const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const now = new Date();
    const curM = now.getMonth();  // 0~11

    // 라벨: AUG, SEP, ..., JUL (현재월부터 앞으로 회전)
    const labels = Array.from({length:12}, (_,k)=> MONTHS[(curM + k) % 12]);

    // 각 라벨에 대응하는 '지난 12개월'의 실제 값 매핑
    // 예: 8월 기준 labels[1]인 SEP는 "작년 9월" 값을 매칭
    const values = [];
    for (let k = 0; k < 12; k++) {
      // k=0 => 현재월(올해 curM), k=1~(11) => 그보다 과거의 개월들
      // rows가 "최근 12개월"이므로, 현재월부터 과거로 k개월 차감한 실제 (연,월)을 계산해 값 찾기
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - ((k + 11) % 12)), 1);
      // 위 수식은 rows가 오래된→최신이라도 12개 중 해당 월이 1개만 존재한다고 가정
      // 좀 더 명확히: 최근 12개월 집합 안에서 '라벨 순서'와 1:1로 매칭되도록 역순 인덱싱
      // 안전하게 다시 계산:
      const target = new Date(now.getFullYear(), now.getMonth() - (11 - k), 1);
      const key = `${target.getFullYear()}-${target.getMonth()}`;
      values.push(monthMap.get(key) ?? null);
    }

    const trace = {
      x: labels,
      y: values,
      mode: "lines",
      hovertemplate: "%{y:.2f}<extra></extra>"
    };

    const markers = minMaxMarkers(labels, values);

    const layout = {
      ...LAYOUT_BASE,
      xaxis: { ...LAYOUT_BASE.xaxis, title:"월", type:"category", automargin:true },
      yaxis: { ...LAYOUT_BASE.yaxis, title:ytitle, automargin:true }
    };

    Plotly.react(divId, [trace, ...markers], layout, { responsive:true });
  } catch (e) {
    console.warn(divId, "월별 API 오류 또는 데이터 없음", e);
    Plotly.react(divId, [], {
      ...LAYOUT_BASE,
      xaxis: { ...LAYOUT_BASE.xaxis, title:"월", type:"category" },
      yaxis: { ...LAYOUT_BASE.yaxis, title:ytitle, range:[0,1] }
    });
  }
}

// 세 칸 고정 렌더
async function renderAll(metric) {
  const urls = buildUrls(metric.key);
  await Promise.all([
    // 시간별: 최근 24시간(1시간 평균), HH:MM
    drawOne("chart_hourly",  urls.hourly,  metric.label, "시간", "%H:%M"),
    // 일별: 최근 15일, MM/DD
    drawOne("chart_daily",   urls.daily,   metric.label, "일자", "%m/%d"),
    // 월별: 최근 12개월, 현재월부터 라벨 회전
    drawMonthly("chart_monthly", urls.monthly, metric.label)
  ]);
}

// ====== 토글 UI ======
const toggleBtn  = document.getElementById("metricToggle");
const toggleMenu = document.getElementById("toggleMenu");
let currentMetric = { ...DEFAULT_METRIC };

function setToggleLabel(label){ toggleBtn.textContent = label; }
function openMenu(open){
  toggleMenu.classList.toggle("show", open);
  toggleMenu.setAttribute("aria-hidden", String(!open));
  toggleBtn.setAttribute("aria-expanded", String(open));
}
toggleBtn.addEventListener("click", () => openMenu(!toggleMenu.classList.contains("show")));
document.addEventListener("click", (e) => {
  if (!toggleMenu.contains(e.target) && e.target !== toggleBtn) openMenu(false);
});
toggleMenu.querySelectorAll("button").forEach(btn => {
  btn.addEventListener("click", async () => {
    const key = btn.getAttribute("data-metric");
    const label = btn.getAttribute("data-label");
    currentMetric = { key, label };
    setToggleLabel(label);
    openMenu(false);
    await renderAll(currentMetric);
  });
});

// ====== 초기 로딩 & 주기 갱신 ======
(async function init(){
  setToggleLabel(DEFAULT_METRIC.label);
  await renderAll(currentMetric);
  setInterval(() => renderAll(currentMetric), REFRESH_MS);
})();
