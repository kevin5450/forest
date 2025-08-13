const API_KEY = "b792282edb31c5f118f17614ad051d45";
const CITY = "Seoul";
const INTERVAL = 60000;

const cityEl = document.getElementById("weather-city");
const mainEl = document.getElementById("weather-main");
const tempEl = document.getElementById("weather-temp");
const iconEl = document.getElementById("weather-icon");
const updatedTimeEl = document.getElementById("weather-updated-time");
const countdownEl = document.getElementById("weather-countdown");

async function updateWeather() {
  try {
    const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${CITY}&appid=${API_KEY}&units=metric`);
    if (!res.ok) throw new Error("날씨 불러오기 실패");
    const data = await res.json();

    const weatherMain = data.weather[0].main;
    const temp = data.main.temp.toFixed(1);
    const iconCode = data.weather[0].icon;
    const iconUrl = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;

    cityEl.textContent = data.name;
    mainEl.textContent = weatherMain;
    tempEl.textContent = temp;
    iconEl.src = iconUrl;
    iconEl.style.display = "inline-block";

    updatedTimeEl.textContent = `날씨 업데이트: ${getCurrentTimeString()}`;
  } catch (e) {
    cityEl.textContent = "오류";
    mainEl.textContent = "--";
    tempEl.textContent = "--";
    iconEl.style.display = "none";
    updatedTimeEl.textContent = `날씨 업데이트 실패`;
    console.error("날씨 API 오류:", e);
  }
}

function getCurrentTimeString() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function startCountdown() {
  let countdown = INTERVAL / 1000;

  const interval = setInterval(() => {
    countdown--;
    countdownEl.textContent = `다음 업데이트까지: ${countdown}초`;

    if (countdown <= 0) {
      clearInterval(interval);
      updateWeather();
      startCountdown();
    }
  }, 1000);
}

updateWeather();
startCountdown();
