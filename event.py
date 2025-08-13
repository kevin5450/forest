# app_issues.py
import os, datetime
from flask import Flask, jsonify
from pymongo import MongoClient
from dotenv import load_dotenv
from flask_cors import CORS


load_dotenv()

URI = os.getenv("MONGODB_URI")
DB_NAME = os.getenv("DB_NAME", "forest")
COLL_NAME = os.getenv("COLLECTION", "iot_data")

client = MongoClient(URI)
coll = client[DB_NAME][COLL_NAME]

app = Flask(__name__)
CORS(app)

TEMP_MIN, TEMP_MAX = 18.0, 28.0
HUM_MIN,  HUM_MAX  = 40.0, 75.0

def status_from_value(v, vmin, vmax, low_msg, high_msg):
    if v is None: return ("no_data", "데이터 없음")
    if v <= vmin: return ("low",  low_msg)
    if v >= vmax: return ("high", high_msg)
    return ("ok",  "현재 이슈 없음")

def find_last_abnormal(since, field, vmin, vmax):
    cursor = coll.find(
        {"timestamp": {"$gte": since}, "$or": [{field: {"$lte": vmin}}, {field: {"$gte": vmax}}]},
        {"_id": 0, "timestamp": 1, field: 1}
    ).sort("timestamp", -1).limit(1)
    return next(cursor, None)

@app.get("/api/issues/latest")
def issues_latest():
    now = datetime.datetime.utcnow()
    since = now - datetime.timedelta(hours=24)

    cursor = coll.find(
        {"timestamp": {"$gte": since}},
        {"_id": 0, "timestamp": 1, "temp": 1, "humidity": 1}
    ).sort("timestamp", -1).limit(1)
    doc = next(cursor, None)

    if not doc:
        return jsonify({
            "window_hours": 24,
            "latest": None,
            "temperature": {"active": None, "now": {"status":"no_data","message":"최근 24시간 데이터 없음"}},
            "humidity":    {"active": None, "now": {"status":"no_data","message":"최근 24시간 데이터 없음"}}
        })

    # 최신값 상태
    t_status, t_msg = status_from_value(
        doc.get("temp"), TEMP_MIN, TEMP_MAX,
        "적정 온도 범위 미만: 18℃ 이하", "적정 온도 범위 초과: 28℃ 이상"
    )
    h_status, h_msg = status_from_value(
        doc.get("humidity"), HUM_MIN, HUM_MAX,
        "적정 습도 범위 미만: 40% 이하", "적정 습도 범위 초과: 75% 이상"
    )
    ts_latest = doc["timestamp"].replace(tzinfo=datetime.timezone.utc).isoformat()

    # 최근 비정상 이벤트
    t_abn = find_last_abnormal(since, "temp",     TEMP_MIN, TEMP_MAX)
    h_abn = find_last_abnormal(since, "humidity", HUM_MIN,  HUM_MAX)

    def make_active(now_status, now_msg, latest_ts, abn_doc, field, vmin, vmax, low_msg, high_msg):
        if now_status != "ok":
            return {"status": now_status, "message": now_msg, "time_utc": latest_ts}
        if not abn_doc:
            return None
        v = abn_doc.get(field)
        st, msg = status_from_value(v, vmin, vmax, low_msg, high_msg)
        return {
            "status": st,
            "message": msg,
            "time_utc": abn_doc["timestamp"].replace(tzinfo=datetime.timezone.utc).isoformat()
        }

    temp_active = make_active(
        t_status, t_msg, ts_latest, t_abn, "temp",
        TEMP_MIN, TEMP_MAX, "적정 온도 범위 미만: 18℃ 이하", "적정 온도 범위 초과: 28℃ 이상"
    )
    hum_active = make_active(
        h_status, h_msg, ts_latest, h_abn, "humidity",
        HUM_MIN, HUM_MAX, "적정 습도 범위 미만: 40% 이하", "적정 습도 범위 초과: 75% 이상"
    )

    return jsonify({
        "window_hours": 24,
        "latest": {
            "timestamp_utc": ts_latest,
            "temp": doc.get("temp"),
            "humidity": doc.get("humidity"),
        },
        "temperature": {"now": {"status": t_status, "message": t_msg}, "active": temp_active},
        "humidity":    {"now": {"status": h_status, "message": h_msg}, "active": hum_active}
    })

@app.get("/api/issues/summary")
def issues_summary():
    # 정오(KST) 기준 직전 24시간 윈도우 계산
    KST = datetime.timezone(datetime.timedelta(hours=9))
    now_local = datetime.datetime.now(KST)
    anchor = now_local.replace(hour=12, minute=0, second=0, microsecond=0)
    if now_local < anchor:
        anchor -= datetime.timedelta(days=1)
    start_local = anchor - datetime.timedelta(hours=24)
    end_local = anchor

    # Mongo에 맞춰 UTC 'naive'로 변환 (너의 /latest 쿼리와 동일 스타일)
    start_utc = start_local.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    end_utc   = end_local.astimezone(datetime.timezone.utc).replace(tzinfo=None)

    pipeline = [
        {"$match": {
            "timestamp": {"$gte": start_utc, "$lt": end_utc},
            "temp": {"$ne": None},
            "humidity": {"$ne": None}
        }},
        {"$group": {
            "_id": None,
            "temp_avg": {"$avg": "$temp"},
            "temp_min": {"$min": "$temp"},
            "temp_max": {"$max": "$temp"},
            "hum_avg":  {"$avg": "$humidity"},
            "hum_min":  {"$min": "$humidity"},
            "hum_max":  {"$max": "$humidity"},
            "n": {"$sum": 1}
        }}
    ]

    agg = list(coll.aggregate(pipeline))
    if not agg:
        return jsonify({
            "window": {"start_utc": start_utc.isoformat(), "end_utc": end_utc.isoformat()},
            "stats": None,
            "message": "최근 24시간(정오 기준) 데이터 없음"
        })

    g = agg[0]
    ta, tmin, tmax = round(g["temp_avg"],1), round(g["temp_min"],1), round(g["temp_max"],1)
    ha, hmin, hmax = round(g["hum_avg"],1),  round(g["hum_min"],1),  round(g["hum_max"],1)

    return jsonify({
        "window": {"start_utc": start_utc.isoformat(), "end_utc": end_utc.isoformat()},
        "stats": {
            "temp": {"avg": ta, "min": tmin, "max": tmax},
            "humidity": {"avg": ha, "min": hmin, "max": hmax},
            "count": g["n"]
        }
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
