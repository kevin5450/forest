const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const chokidar = require("chokidar");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(__dirname)); // index.html, main.js, models 폴더 등 제공

wss.on("connection", (ws) => {
    console.log("Client connected");
    ws.send(JSON.stringify({ type: "connected", message: "WebSocket 연결 완료" }));
});

// JSON 파일 변경 감지 및 브로드캐스트
const jsonPath = path.join(__dirname, "received_sensor_data.json");

chokidar.watch(jsonPath).on("change", () => {
    const json = fs.readFileSync(jsonPath, "utf-8");
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(json);
        }
    });
});

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

//npm install chokidar