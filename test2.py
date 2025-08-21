# sensor.py — 필드 순서 고정(SON) / 조도 4방향 + DHT22 / Mongo Time-Series 대응
import time, csv, os
from pathlib import Path
from datetime import datetime, timezone

# ---- smbus: 라즈베리파이 기본(apt: python3-smbus). 미설치면 smbus2로 대체 ----
try:
    import smbus  # sudo apt install -y python3-smbus i2c-tools
except Exception:
    import smbus2 as smbus  # pip install smbus2

import board, adafruit_dht          # pip install Adafruit-Blinka adafruit-circuitpython-dht
from pymongo import MongoClient      # pip install "pymongo[srv]"
from dotenv import load_dotenv       # pip install python-dotenv
from bson.son import SON             # 필드 삽입 순서 보존용

# ---------- ENV ----------
load_dotenv(dotenv_path=Path(__file__).with_name(".env"))
URI       = os.getenv("MONGODB_URI", "").strip()
DB_NAME   = os.getenv("DB_NAME", "plantlog_2025").strip()
COLL_NAME = os.getenv("COLLECTION", "events").strip()
DEVICE_ID = os.getenv("DEVICE_ID", "pi-01").strip()

CSV_FILENAME = os.getenv("CSV_FILENAME", "sensor_data_combined.csv")
INTERVAL     = int(os.getenv("INTERVAL", "5"))

# ---------- I2C & BH1750 ----------
# 배선에 맞게 (버스번호, 주소) 수정하세요.
BH1750_ADDR_PRIMARY   = 0x23
BH1750_ADDR_SECONDARY = 0x5C

BH1750_CONFIG = {
    "E": (0, BH1750_ADDR_PRIMARY),
    "W": (4, BH1750_ADDR_PRIMARY),
    "S": (5, BH1750_ADDR_PRIMARY),
    "N": (6, BH1750_ADDR_PRIMARY),
}
CONT_H_RES_MODE = 0x10

_bus_handles = {}
def get_bus(bus_num: int):
    if bus_num not in _bus_handles:
        _bus_handles[bus_num] = smbus.SMBus(bus_num)
    return _bus_handles[bus_num]

def read_bh1750(bus_num: int, addr: int):
    """BH1750 lux(raw float) 읽기. 실패 시 None"""
    try:
        bus = get_bus(bus_num)
        bus.write_byte(addr, CONT_H_RES_MODE)
        time.sleep(0.2)
        data = bus.read_i2c_block_data(addr, CONT_H_RES_MODE, 2)
        return int.from_bytes(bytes(data), "big") / 1.2
    except Exception as e:
        print(f"[ERROR] BH1750 (i2c-{bus_num}, 0x{addr:02X}): {e}")
        return None

def read_all_lights():
    """{'E': float|None, 'W':..., 'S':..., 'N':...}"""
    out = {}
    for dir_code, (bus_num, addr) in BH1750_CONFIG.items():
        out[dir_code] = read_bh1750(bus_num, addr)
    return out

# ---------- DHT22 ----------
dht_device = adafruit_dht.DHT22(board.D4)

# ---------- Mongo ----------
def get_coll():
    if not URI:
        raise RuntimeError("MONGODB_URI가 설정되지 않았습니다 (.env 확인).")
    client = MongoClient(URI, serverSelectionTimeoutMS=4000)
    client.admin.command("ping")  # 연결 확인
    db = client[DB_NAME]
    coll = db[COLL_NAME]
    try:
        coll.create_index([("timestamp", 1), ("device_id", 1)], unique=False)
    except Exception:
        pass
    return client, coll

# ===== CSV: 정확한 컬럼 순서와 이름 고정 =====
CSV_HEADER = [
    "timestamp", "device_id",
    "lux_e", "lux_w", "lux_s", "lux_n",
    "lux_max", "lux_dir",
    "temp", "humidity",
    "timestamp_str",
]
csv_path = Path(CSV_FILENAME)
if not csv_path.exists():
    with csv_path.open("w", newline="") as f:
        csv.writer(f).writerow(CSV_HEADER)

print(f"센서 데이터 측정 시작 (간격 {INTERVAL}s) → DB={DB_NAME}, COLL={COLL_NAME}")

client, coll = None, None

try:
    # Mongo 1회 연결
    client, coll = get_coll()
    print("[Mongo] 연결 성공")

    while True:
        # ---- 시간 ----
        ts_local_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")   # 표시용 문자열
        ts_utc = datetime.now(timezone.utc)                            # BSON Date(필수)

        # ---- 조도 ----
        lux_vals = read_all_lights()  # {'E':..., 'W':..., 'S':..., 'N':...}
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

        # ---- Mongo 문서(★필드 순서 강제: SON 사용★) ----
        doc = SON([
            ("timestamp", ts_utc),
            ("device_id", DEVICE_ID),

            ("lux_e", lux_vals.get("E")),
            ("lux_w", lux_vals.get("W")),
            ("lux_s", lux_vals.get("S")),
            ("lux_n", lux_vals.get("N")),

            ("lux_max", lux_max),
            ("lux_dir", lux_dir),

            ("temp", temperature),
            ("humidity", humidity),

            ("timestamp_str", ts_local_str),
        ])

        # ---- Mongo 저장 (한 번만) ----
        try:
            res = coll.insert_one(doc)
            print(f"[Mongo] inserted -> {DB_NAME}.{COLL_NAME} id={res.inserted_id}")
        except Exception as e:
            print(f"[ERROR] Mongo insert 실패: {e}")

        # ---- CSV 기록(같은 순서) ----
        with csv_path.open("a", newline="") as f:
            writer = csv.writer(f)
            writer.writerow([
                doc["timestamp"].isoformat(),      # CSV에서는 문자열로
                doc["device_id"],
                doc["lux_e"], doc["lux_w"], doc["lux_s"], doc["lux_n"],
                doc["lux_max"], doc["lux_dir"],
                doc["temp"], doc["humidity"],
                doc["timestamp_str"],
            ])

        # ---- 로그 ----
        print(f"[{ts_local_str}] 조도(E/W/S/N): "
              f"{lux_vals.get('E')}, {lux_vals.get('W')}, {lux_vals.get('S')}, {lux_vals.get('N')}  | "
              f"최대: {lux_max} ({lux_dir})  | "
              f"온도: {temperature}°C, 습도: {humidity}%")

        time.sleep(INTERVAL)

except KeyboardInterrupt:
    print("\n종료 요청(Ctrl+C). 프로그램을 마칩니다.")
finally:
    try:
        dht_device.exit()
    except Exception:
        pass
    try:
        # 버스 핸들 정리
        for b in _bus_handles.values():
            try:
                b.close()
            except Exception:
                pass
        if client:
            client.close()
    except Exception:
        pass
