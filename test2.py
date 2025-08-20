# sensor.py  (조도 4방향 + DHT22, "정확한 순서" 저장 보장)
import time, csv, json, os
from pathlib import Path
from datetime import datetime, timezone

# ---- smbus: 라즈베리파이 기본(apt: python3-smbus). 미설치면 smbus2로 대체 ----
try:
    import smbus  # sudo apt install -y python3-smbus i2c-tools
except Exception:
    import smbus2 as smbus  # pip install smbus2

import board, adafruit_dht          # pip install Adafruit-Blinka adafruit-circuitpython-dht
from pymongo import MongoClient, errors   # pip install "pymongo[srv]"
from dotenv import load_dotenv            # pip install python-dotenv
from bson import SON                      # 키 순서 보장

# ---------- ENV ----------
load_dotenv(dotenv_path=Path(__file__).with_name(".env"))
URI       = os.getenv("MONGODB_URI", "").strip()
DB_NAME   = os.getenv("DB_NAME", "plantlog_2025").strip()
COLL_NAME = os.getenv("COLLECTION", "events").strip()
DEVICE_ID = os.getenv("DEVICE_ID", "pi-01").strip()

CSV_FILENAME = os.getenv("CSV_FILENAME", "sensor_data_combined.csv")
INTERVAL     = int(os.getenv("INTERVAL", "5"))

# 오프라인 버퍼(jsonl)
BUFFER_DIR  = Path(os.getenv("PLANTLOG_DIR", Path.home() / "plantlog"))
BUFFER_PATH = BUFFER_DIR / "unsent.jsonl"

# ---------- I2C & BH1750 ----------
# 필요에 맞게 버스번호 조정
I2C_BUSES = { 0: "E", 4: "W", 5: "S", 6: "N" }
BH1750_DEV_ADDR = 0x23
CONT_H_RES_MODE = 0x10

def read_light(bus_num: int):
    """특정 I2C 버스에서 BH1750 lux(raw float). 실패 시 None"""
    try:
        bus = smbus.SMBus(bus_num)
        bus.write_byte(BH1750_DEV_ADDR, CONT_H_RES_MODE)
        time.sleep(0.2)
        data = bus.read_i2c_block_data(BH1750_DEV_ADDR, CONT_H_RES_MODE, 2)
        bus.close()
        return int.from_bytes(bytes(data), "big") / 1.2  # raw float
    except Exception as e:
        print(f"[ERROR] BH1750 (i2c-{bus_num}): {e}")
        return None

def read_all_lights():
    """{'E': float|None, 'W':..., 'S':..., 'N':...}"""
    return {dir_code: read_light(bus_num) for bus_num, dir_code in I2C_BUSES.items()}

# ---------- DHT22 ----------
dht_device = adafruit_dht.DHT22(board.D4)

# ---------- Mongo ----------
def get_coll():
    """Mongo 연결. 없으면 (URI 미설정) None 반환"""
    if not URI:
        print("[INFO] MONGODB_URI 미설정 → 오프라인(버퍼) 모드")
        return None, None
    client = MongoClient(URI, serverSelectionTimeoutMS=4000)
    db = client[DB_NAME]
    coll = db[COLL_NAME]
    try:
        coll.create_index([("timestamp", 1), ("device_id", 1)], unique=False)
    except Exception:
        pass
    client.admin.command("ping")
    return client, coll

def buffer_write(doc_son: SON):
    """SON을 JSONL로 기록(키 순서 유지)"""
    BUFFER_DIR.mkdir(parents=True, exist_ok=True)
    with BUFFER_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(doc_son, ensure_ascii=False, default=str, sort_keys=False) + "\n")

def buffer_flush(coll):
    """버퍼 재전송: JSON -> SON 변환 후 삽입"""
    if not BUFFER_PATH.exists():
        return
    lines = BUFFER_PATH.read_text(encoding="utf-8").splitlines()
    if not lines:
        return
    keep = []
    for line in lines:
        try:
            d = json.loads(line)             # 3.7+ dict는 입력 순서 유지
            doc_son = SON(list(d.items()))   # 안전하게 SON으로 변환
            coll.insert_one(doc_son)
        except errors.DuplicateKeyError:
            pass
        except Exception:
            keep.append(line)
    if keep:
        BUFFER_PATH.write_text("\n".join(keep) + "\n", encoding="utf-8")
    else:
        BUFFER_PATH.unlink(missing_ok=True)

# ===== CSV: 정확한 컬럼 순서와 이름 고정 =====
CSV_HEADER = [
    "timestamp", "timestamp_str", "device_id",
    "lux_e", "lux_w", "lux_s", "lux_n",
    "lux_max", "lux_dir",
    "temp", "humidity",
]

csv_path = Path(CSV_FILENAME)

# 파일 없으면 새로 만들고 헤더 작성 (있으면 덮어쓰지 않음)
if not csv_path.exists():
    with csv_path.open("w", newline="") as f:
        csv.writer(f).writerow(CSV_HEADER)

print(f"센서 데이터 측정 시작 (간격 {INTERVAL}s) → DB={DB_NAME}, COLL={COLL_NAME}")

client, coll = None, None

try:
    while True:
        # ---- 시간 ----
        ts_local_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        ts_utc = datetime.now(timezone.utc)

        # ---- 조도 ----
        lux_vals = read_all_lights()
        valid = [(d, v) for d, v in lux_vals.items() if isinstance(v, (int, float))]
        if valid:
            lux_dir, lux_max = max(valid, key=lambda kv: kv[1])
        else:
            lux_dir, lux_max = None, None

        # ---- DHT22 ----
        try:
            temperature = dht_device.temperature
            humidity    = dht_device.humidity
        except RuntimeError as e:
            print(f"[{ts_local_str}] [DHT22] 일시적 오류: {e}")
            temperature, humidity = None, None
        except Exception as e:
            print(f"[{ts_local_str}] [DHT22] 치명적 오류: {e}")
            dht_device.exit()
            raise

        # ---- Mongo에 넣을 문서: SON으로 "키 순서 고정" ----
        doc = SON([
            ("timestamp", ts_utc),
            ("timestamp_str", ts_local_str),
            ("device_id", DEVICE_ID),
            ("lux_e", lux_vals.get("E")),
            ("lux_w", lux_vals.get("W")),
            ("lux_s", lux_vals.get("S")),
            ("lux_n", lux_vals.get("N")),
            ("lux_max", lux_max),
            ("lux_dir", lux_dir),
            ("temp", temperature),
            ("humidity", humidity),
        ])

        # ---- CSV 행도 동일한 순서로 기록 ----
        row = [
            doc["timestamp"].isoformat(),  # CSV는 문자열로
            doc["timestamp_str"],
            doc["device_id"],
            doc["lux_e"], doc["lux_w"], doc["lux_s"], doc["lux_n"],
            doc["lux_max"], doc["lux_dir"],
            doc["temp"], doc["humidity"],
        ]
        with csv_path.open("a", newline="") as f:
            csv.writer(f).writerow(row)

        # ---- Mongo 저장 (오프라인 버퍼 포함) ----
        try:
            if coll is None:
                client, coll = get_coll()
                if coll is not None:
                    buffer_flush(coll)

            if coll is not None:
                coll.insert_one(doc)   # SON 그대로 삽입 → 순서 유지
                print(f"[Mongo] inserted -> {DB_NAME}.{COLL_NAME}")
            else:
                buffer_write(doc)
                print(f"[Buffer] wrote -> {BUFFER_PATH}")

        except Exception as e:
            print(f"[WARN] Mongo insert 실패 → 버퍼 저장: {e}")
            buffer_write(doc)
            if client is not None:
                client.close()
            client, coll = None, None

        time.sleep(INTERVAL)

except KeyboardInterrupt:
    print("\n종료 요청(Ctrl+C). 프로그램을 마칩니다.")
finally:
    try:
        dht_device.exit()
    except Exception:
        pass
    try:
        if client:
            client.close()
    except Exception:
        pass
