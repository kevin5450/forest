// ====== 설정 ======
const API_BASE = "http://localhost:8001";   // Flask 집계 API(app_agg.py)
const REFRESH_MS = 60_000;
const DEFAULT_METRIC = { key: "temp", label: "온도 (°C)" };
// 특정 device만 보고 싶으면 예: const DEVICE_FILTER = "&device_id=pi-greenhouse-01";
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
    daily:   `${API_BASE}/api/agg/daily?metric=${metricKey}&days=30${DEVICE_FILTER}`,
    monthly: `${API_BASE}/api/agg/monthly?metric=${metricKey}&months=12${DEVICE_FILTER}`
  };
}

// 공통 그리기 함수 (title 제거, legend 숨김, x축 포맷/라벨 전달)
async function drawOne(divId, url, ytitle, xaxisTitle, tickformat) {
  try {
    const rows = await fetchAgg(url);
    const { x, y } = toXY(rows);

    const line = {
      x, y, mode:"lines",
      hovertemplate: "%{y:.2f}<br>%{x}<extra></extra>"
    };
    const markers = minMaxMarkers(x, y);

    const layout = {
      ...LAYOUT_BASE,
      xaxis: { ...LAYOUT_BASE.xaxis, title:xaxisTitle, tickformat, automargin:true },
      yaxis: { ...LAYOUT_BASE.yaxis, title:ytitle, automargin:true }
    };

    if (!y.length) layout.yaxis.range = [0, 1]; // 데이터 없을 때 기본 범위

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

// 세 칸 고정 렌더
async function renderAll(metric) {
  const urls = buildUrls(metric.key);
  await Promise.all([
    drawOne("chart_hourly",  urls.hourly,  metric.label, "시간 (시)", "%H시"),
    drawOne("chart_daily",   urls.daily,   metric.label, "일",        "%m/%d"),
    drawOne("chart_monthly", urls.monthly, metric.label, "월",        "%Y-%m")
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
    await renderAll(currentMetric); // 자리 고정, 데이터만 교체
  });
});

// ====== 초기 로딩 & 주기 갱신 ======
(async function init(){
  setToggleLabel(DEFAULT_METRIC.label);
  await renderAll(currentMetric);
  setInterval(() => renderAll(currentMetric), REFRESH_MS);
})();
