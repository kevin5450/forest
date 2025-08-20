import serial
import json
import time
import os
from datetime import datetime

ser = serial.Serial('COM5', 9600, timeout=1)  # 포트명은 환경에 따라 수정

json_filename = "received_sensor_data.json"

# 기존 파일 있으면 불러오기 (이전 기록 유지)
#if os.path.exists(jsoGename, "r", encoding="utf-8") as f:
     #   try:
      #      data_list = json.load(f)
       # except json.JSONDecodeError:
        #    data_list = []
#else:

data_list = []

print("✅ JSON 수신 시작")

while True:
    try:
        line = ser.readline().decode().strip()
        if line:
            print(f"수신 데이터: {line}")

            parts = line.split("|")
            if len(parts) == 3:
                timestamp_now = datetime.now()
                formatted_timestamp = timestamp_now.strftime("%Y-%m-%d %H:%M:%S")
                
                device = parts[1].strip()
                sensor_data_raw = parts[2]

                # 데이터 파싱
                temp = float(sensor_data_raw.split("Temp: ")[1].split("°C")[0])
                hum = float(sensor_data_raw.split("Hum: ")[1].split("%")[0])
                lux = float(sensor_data_raw.split("Lux: ")[1].split("lx")[0])

                entry = {
                    "timestamp": formatted_timestamp,
                    "device": device.strip(),
                    "temperature": temp,
                    "humidity": hum,
                    "lux": lux
                }

                data_list.append(entry)

                # 최신 리스트 저장
                with open(json_filename, "w", encoding="utf-8") as f:
                    json.dump(data_list, f, ensure_ascii=False, indent=2)

                print("📁 JSON 저장 완료")

    except Exception as e:
        print("🚨 오류:", e)

    time.sleep(1)
