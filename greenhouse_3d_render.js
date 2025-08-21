const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true);
let allCubes = [];
let allLabels = [];
let selectedCubeName = null;
let minimap;
let sensorData;
let uiManager;

const m = 8;
const n = 8;
const spacingX = 1.5;
const spacingZ = 3;

const totalWidth = n * spacingX;
const totalDepth = m * spacingZ;
const centerX = ((n - 1) * spacingX) / 2;
const centerZ = ((m - 1) * spacingZ) / 2;

function handleSelection(cubeName, scene) {
    selectedCubeName = (selectedCubeName === cubeName) ? null : cubeName;

    // 안전하게 문자열인지 확인 후 처리
    const minimapName = (typeof selectedCubeName === 'string') 
        ? selectedCubeName.replace("Cube", "") 
        : null;

    if (minimap) {
        minimap.setSelectedCube(minimapName);
    }

    allCubes.forEach(cube => {
        const isSelected = (cube.name === selectedCubeName);
        const targetAlpha = (selectedCubeName === null) ? 1 : (isSelected ? 1 : 0.2);

        cube.getChildMeshes().forEach(mesh => {
            if (mesh.material) {
                mesh.material.alpha = targetAlpha;
                mesh.material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
            }
        });
    });

    allLabels.forEach(({ label: otherLabel, cube: otherCube }) => {
        otherLabel.alpha = (selectedCubeName === null || otherCube.name === selectedCubeName) ? 1 : 0.2;
    });

    if (selectedCubeName) {
        sensorData.setSelectedCube(selectedCubeName);
        const selectedCube = allCubes.find(cube => cube.name === selectedCubeName);
        if (selectedCube) {
            moveCameraToTarget(scene.activeCamera, selectedCube.position, scene);
        }
    }
}

class Minimap {
    constructor(m, n, spacingX, spacingZ) {
        this.m = m;
        this.n = n;
        this.spacingX = spacingX;
        this.spacingZ = spacingZ;
        this.canvas = document.getElementById('minimap');
        this.ctx = this.canvas.getContext('2d');
        this.selectedCube = null;

        // 비율 1:2 기반 cell 크기 계산
        const baseSize = 30;
        this.cellWidth = baseSize;
        this.cellHeight = baseSize * (spacingZ / spacingX);

        // canvas 사이즈 자동 설정
        this.canvas.width = this.n * this.cellWidth + 2 * 20;
        this.canvas.height = this.m * this.cellHeight + 2 * 20;

        this.offsetX = 20;
        this.offsetY = 20;

        this.update = this.update.bind(this);
    }

    setSelectedCube(cubeName) {
        const parsed = parseInt(cubeName?.replace("Cube", ""));
        this.selectedCube = isNaN(parsed) ? null : parsed;
    }

    start() {
        requestAnimationFrame(this.update);
    }

    update() {
        this.drawGrid();
        if (this.selectedCube) {
            this.drawSelectedCube(this.selectedCube);
        }
        requestAnimationFrame(this.update);
    }

    drawGrid() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.strokeStyle = "#888";
        ctx.fillStyle = "#000";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        let counter = 1;
        for (let row = 0; row < this.m; row++) {
            for (let col = 0; col < this.n; col++) {
                const x = this.offsetX + col * this.cellWidth;
                const y = this.offsetY + (this.m - 1 - row) * this.cellHeight;

                ctx.strokeRect(x, y, this.cellWidth, this.cellHeight);
                ctx.fillText(counter.toString(), x + this.cellWidth / 2, y + this.cellHeight / 2);
                counter++;
            }
        }
    }

    drawSelectedCube(num) {
        const ctx = this.ctx;
        const index = num - 1;
        const row = index / this.n | 0;
        const col = index % this.n;

        const x = this.offsetX + col * this.cellWidth;
        const y = this.offsetY + (this.m - 1 - row) * this.cellHeight;

        ctx.beginPath();
        ctx.fillStyle = "red";
        ctx.arc(x + this.cellWidth / 2, y + this.cellHeight / 2, 6, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ✅ SensorData 클래스 정의
class SensorData {
    constructor() {
        this.dataMap = new Map();
        this.currentMode = 'temperature';
        this.selectedCube = null;
        this.displayElement = document.querySelector('.current-value-display');
        
    }

    generateRandomData() {
        return {
            temperature: 30,
            humidity: (Math.random() * (80 - 40) + 40).toFixed(1),
            illuminance: Math.floor(Math.random() * (1000 - 100) + 100)
        };
    }

    updateCubeData(cubeName) {
        this.dataMap.set(cubeName, this.generateRandomData());
        if (this.selectedCube === cubeName) {
            this.updateSelectedCubeInfo(cubeName);
        }
    }

    setSelectedCube(cubeName) {
        this.selectedCube = cubeName;
        this.updateSelectedCubeInfo(cubeName);
    }

    updateSelectedCubeInfo(cubeName) {
        const data = this.dataMap.get(cubeName);
        if (!data) return;

        const cubeNameElement = document.getElementById('cube-name');
    if (cubeNameElement) {
        cubeNameElement.textContent = `${cubeName}`;
    }

        document.getElementById('temp-value').textContent = data.temperature;
        document.getElementById('humidity-value').textContent = data.humidity;
        document.getElementById('illuminance-value').textContent = data.illuminance;

        let color;
        switch(this.currentMode) {
            case 'temperature':
                color = this.getColorByTemperature(data.temperature);
                break;
            case 'humidity':
                color = this.getColorByHumidity(data.humidity);
                break;
            case 'illuminance':
                color = this.getColorByIlluminance(data.illuminance);
                break;
        }

        if (this.displayElement && color) {
            try {
                const backgroundColor = `rgb(${Math.floor(color.r * 255)}, ${Math.floor(color.g * 255)}, ${Math.floor(color.b * 255)})`;
                
                // 직접 스타일 설정
                this.displayElement.style.cssText = `background-color: ${backgroundColor} !important`;
                
                // 밝기 계산
                const brightness = (color.r * 255 * 299 + color.g * 255 * 587 + color.b * 255 * 114) / 1000;
                const textColor = brightness > 128 ? 'black' : 'white';
                
                // 현재 값과 단위 업데이트
                const currentValue = document.getElementById('current-value');
                const currentUnit = document.getElementById('current-unit');
                
                if (currentValue && currentUnit) {
                    currentValue.style.color = textColor;
                    currentUnit.style.color = textColor;
                    
                    switch(this.currentMode) {
                        case 'temperature':
                            currentValue.textContent = data.temperature;
                            currentUnit.textContent = '°C';
                            break;
                        case 'humidity':
                            currentValue.textContent = data.humidity;
                            currentUnit.textContent = '%';
                            break;
                        case 'illuminance':
                            currentValue.textContent = data.illuminance;
                            currentUnit.textContent = 'lux';
                            break;
                    }
                }
            } catch (error) {
                console.error('Error applying styles:', error);
            }
        }
    }

    setMode(mode) {
        this.currentMode = mode;
        // 선택된 큐브가 있다면 디스플레이 업데이트
        if (this.selectedCube) {
            this.updateSelectedCubeInfo(this.selectedCube);
        }
    }

    getColorByTemperature(temp) {
        temp = parseFloat(temp);
        if (temp >= 27) return new BABYLON.Color3(1, 0, 0);
        if (temp >= 24) return new BABYLON.Color3(1, 0.4, 0.4);
        return new BABYLON.Color3(1, 0.7, 0.7);
    }

    getColorByHumidity(humidity) {
        humidity = parseFloat(humidity);
        if (humidity >= 70) return new BABYLON.Color3(0, 0, 1);
        if (humidity >= 50) return new BABYLON.Color3(0.4, 0.4, 1);
        return new BABYLON.Color3(0.7, 0.7, 1);
    }

    getColorByIlluminance(illuminance) {
        illuminance = parseFloat(illuminance);
        if (illuminance >= 800) return new BABYLON.Color3(1, 1, 0);
        if (illuminance >= 500) return new BABYLON.Color3(1, 1, 0.4);
        return new BABYLON.Color3(1, 1, 0.7);
    }

    getEnvironmentEmoji(value, type) {
        switch(type) {
            case 'temperature':
                if (value >= 27) return '🔥';
                if (value >= 24) return '😊';
                return '🥶';
            
            case 'humidity':
                if (value >= 70) return '💦';
                if (value >= 50) return '😊';
                return '💧';
                
            case 'illuminance':
                if (value >= 800) return '☀️';
                if (value >= 500) return '😊';
                return '🔅';
                
            default:
                return '';
        }
    }
}

// ✅ UIManager 클래스 정의
class UIManager {
    constructor(sensorData) {
        this.sensorData = sensorData;
        this.setupEventListeners();
        this.updateReferenceGuide('temperature');
    }

    setupEventListeners() {
        const buttons = document.querySelectorAll('.control-button');
        buttons.forEach(button => {
            button.addEventListener('click', (e) => {
                buttons.forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                this.sensorData.currentMode = e.target.dataset.type;
                this.updateReferenceGuide(this.sensorData.currentMode);
                this.updateAllCubeColors();
                if (this.sensorData.selectedCube) {
                    this.sensorData.updateSelectedCubeInfo(this.sensorData.selectedCube);
                }
            });
        });
    }

    updateReferenceGuide(mode) {
        const guideContent = {
            temperature: `
                <h4>온도 기준표</h4>
                <p><span style="display: inline-block; width: 20px; height: 20px; background-color: rgb(255, 0, 0); margin-right: 5px;"></span> 27°C 이상: 높음</p>
                <p><span style="display: inline-block; width: 20px; height: 20px; background-color: rgb(255, 102, 102); margin-right: 5px;"></span> 24°C ~ 26°C: 적정</p>
                <p><span style="display: inline-block; width: 20px; height: 20px; background-color: rgb(255, 179, 179); margin-right: 5px;"></span> 23°C 이하: 낮음</p>
            `,
            humidity: `
                <h4>습도 기준표</h4>
                <p><span style="display: inline-block; width: 20px; height: 20px; background-color: rgb(0, 0, 255); margin-right: 5px;"></span> 70% 이상: 높음</p>
                <p><span style="display: inline-block; width: 20px; height: 20px; background-color: rgb(102, 102, 255); margin-right: 5px;"></span> 50% ~ 69%: 적정</p>
                <p><span style="display: inline-block; width: 20px; height: 20px; background-color: rgb(179, 179, 255); margin-right: 5px;"></span> 49% 이하: 낮음</p>
            `,
            illuminance: `
                <h4>조도 기준표</h4>
                <p><span style="display: inline-block; width: 20px; height: 20px; background-color: rgb(255, 255, 0); margin-right: 5px;"></span> 800lux 이상: 높음</p>
                <p><span style="display: inline-block; width: 20px; height: 20px; background-color: rgb(255, 255, 102); margin-right: 5px;"></span> 500lux ~ 799lux: 적정</p>
                <p><span style="display: inline-block; width: 20px; height: 20px; background-color: rgb(255, 255, 179); margin-right: 5px;"></span> 499lux 이하: 낮음</p>
            `
        };
        document.querySelector('.reference-guide').innerHTML = guideContent[mode];
    }

    updateCubeInfo(cubeName) {
        const data = this.sensorData.dataMap.get(cubeName);
        if (data) {
            document.getElementById('temp-value').textContent = data.temperature;
            document.getElementById('humidity-value').textContent = data.humidity;
            document.getElementById('illuminance-value').textContent = data.illuminance;
        }
    }

    updateAllCubeColors() {
        allCubes.forEach(cube => this.updateCubeColor(cube));
        this.updateCubeLabels();
    }

    updateCubeColor(cube) {
        const data = this.sensorData.dataMap.get(cube.name);
        if (!data) return;

        let color;
        switch (this.sensorData.currentMode) {
            case 'temperature':
                color = this.sensorData.getColorByTemperature(data.temperature);
                break;
            case 'humidity':
                color = this.sensorData.getColorByHumidity(data.humidity);
                break;
            case 'illuminance':
                color = this.sensorData.getColorByIlluminance(data.illuminance);
                break;
        }

        // 1. 부모 메시 재질이 있다면 설정
        if (cube.material) {
            cube.material.diffuseColor = color;
            cube.material.emissiveColor = color.scale(0.5);
        }

        // 2. 자식 메시에도 설정 (여기 핵심)
        cube.getChildMeshes().forEach(mesh => {
            if (mesh.material) {
                mesh.material.diffuseColor = color;
                mesh.material.emissiveColor = color.scale(0.5);
            }
        });
    }


    updateLabelEmojis(cubeName) {
        const labelInfo = allLabels.find(info => info.cube.name === cubeName);
        if (!labelInfo) return;

        this.updateSingleLabelText(labelInfo);
    }

    updateCubeLabels() {
        allLabels.forEach(labelInfo => {
            this.updateSingleLabelText(labelInfo);
        });
    }

    updateSingleLabelText(labelInfo) {
        const cubeName = labelInfo.cube.name;
        const data = this.sensorData.dataMap.get(cubeName);
        if (!data) return;

        const tempEmoji = this.sensorData.getEnvironmentEmoji(data.temperature, 'temperature');
        const humidityEmoji = this.sensorData.getEnvironmentEmoji(data.humidity, 'humidity');
        const illumEmoji = this.sensorData.getEnvironmentEmoji(data.illuminance, 'illuminance');

        const textBlock = labelInfo.label.children[0];
        if (textBlock) {
            const displayName = cubeName.replace("Cube", "");  // Cube 제거
            textBlock.text = `${displayName}${tempEmoji}${humidityEmoji}${illumEmoji}`;
        }
    }
}

function moveCameraToTarget(camera, targetPosition, scene) {
    const currentPos = camera.position.clone();
    const currentTarget = camera.target.clone();

    const newPosition = new BABYLON.Vector3(
        targetPosition.x,
        targetPosition.y + 0.6,
        targetPosition.z + 1
    );

    const lookAt = new BABYLON.Vector3(
        targetPosition.x,
        targetPosition.y + 0.2,
        targetPosition.z
    );

    scene.stopAnimation(camera);

    const posAnim = new BABYLON.Animation("posAnim", "position", 60,
        BABYLON.Animation.ANIMATIONTYPE_VECTOR3, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
    const targetAnim = new BABYLON.Animation("targetAnim", "target", 60,
        BABYLON.Animation.ANIMATIONTYPE_VECTOR3, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);

    posAnim.setKeys([
        { frame: 0, value: currentPos },
        { frame: 30, value: newPosition }
    ]);

    targetAnim.setKeys([
        { frame: 0, value: currentTarget },
        { frame: 30, value: lookAt }
    ]);

    const easing = new BABYLON.CubicEase();
    easing.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);
    posAnim.setEasingFunction(easing);
    targetAnim.setEasingFunction(easing);

    camera.animations = [posAnim, targetAnim];
    scene.beginAnimation(camera, 0, 30, false);
}

sensorData = new SensorData();
uiManager = new UIManager(sensorData);

function centerHoverPopup() {
    const popup = document.getElementById("hover-popup");
    const canvas = document.getElementById("renderCanvas");
    const rect = canvas.getBoundingClientRect();
    const popupWidth = popup.offsetWidth;

    // canvas 중앙 위치 계산
    const centerX = rect.left + rect.width / 2;
    popup.style.left = `${centerX - popupWidth / 2}px`;
}


const createScene = async function () {
    const scene = new BABYLON.Scene(engine);

    // 스카이박스 생성
    const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: 1000 }, scene);
    const skyboxMaterial = new BABYLON.StandardMaterial("skyBox", scene);
    skyboxMaterial.backFaceCulling = false;
    skyboxMaterial.disableLighting = true;
    skyboxMaterial.diffuseColor = new BABYLON.Color3(0, 0, 0);
    skyboxMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
    skyboxMaterial.emissiveColor = new BABYLON.Color3(0.53, 0.81, 0.98);
    skybox.material = skyboxMaterial;

    // 카메라 생성 및 설정
    const camera = new BABYLON.ArcRotateCamera("Camera",
        Math.PI / 2,
        Math.PI / 2.2,
        20,
        new BABYLON.Vector3(centerX, 0, centerZ), scene);
    camera.attachControl(canvas, true);
    camera.inertia = 0;
    camera.panningInertia = 0;
    camera.wheelPrecision = 30;
    camera.angularSensibilityX = 1000;
    camera.angularSensibilityY = 1000;
    camera.lowerRadiusLimit = 1.5;
    camera.upperRadiusLimit = 100;
    camera.lowerBetaLimit = 0.3;
    camera.upperBetaLimit = Math.PI / 2.05;
    camera.setTarget(new BABYLON.Vector3(centerX, 0.5, centerZ));

    // 마우스 휠 줌 제어
    const zoomRangeLimit = 50;
    canvas.addEventListener("wheel", function (evt) {
        evt.preventDefault();
        const pickResult = scene.pick(evt.clientX, evt.clientY);
        if (!pickResult.hit || !pickResult.pickedPoint) return;

        const pickPoint = pickResult.pickedPoint;
        const dx = pickPoint.x - centerX;
        const dz = pickPoint.z - centerZ;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance > zoomRangeLimit) return;

        const zoomDirection = evt.deltaY > 0 ? 1 : -1;
        const zoomAmount = 2.5;
        const targetRadius = BABYLON.Scalar.Clamp(
            camera.radius + zoomDirection * zoomAmount,
            camera.lowerRadiusLimit,
            camera.upperRadiusLimit
        );

        const adjustedTarget = BABYLON.Vector3.Lerp(
            camera.target,
            pickPoint,
            0.4
        );

        scene.stopAnimation(camera);

        BABYLON.Animation.CreateAndStartAnimation("zoomTarget", camera, "target",
            60, 20, camera.target.clone(), adjustedTarget, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);

        BABYLON.Animation.CreateAndStartAnimation("zoomRadius", camera, "radius",
            60, 20, camera.radius, targetRadius, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
    }, { passive: false });

    new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);

    // 땅 생성 및 재질 적용
    const ground = BABYLON.MeshBuilder.CreateGround("ground", {
        width: totalWidth + spacingX,
        height: totalDepth + spacingZ
    }, scene);
    ground.position.x = centerX;
    ground.position.z = centerZ;
    ground.position.y = -0.01;

    const underGround = BABYLON.MeshBuilder.CreateGround("underGround", {
        width: 1000,
        height: 1000
    }, scene);
    underGround.position.y = -0.2;

    const dirtPBR = new BABYLON.PBRMaterial("dirtPBR", scene);
    const basePath = "models/";
    dirtPBR.albedoTexture = new BABYLON.Texture(basePath + "Ground048_2K-JPG_Color.jpg", scene);
    dirtPBR.bumpTexture = new BABYLON.Texture(basePath + "Ground048_2K-JPG_NormalGL.jpg", scene);
    dirtPBR.metallicTexture = new BABYLON.Texture(basePath + "Ground048_2K-JPG_Roughness.jpg", scene);
    dirtPBR.useRoughnessFromMetallicTextureAlpha = false;
    dirtPBR.roughness = 1;
    dirtPBR.metallic = 0;
    dirtPBR.albedoTexture.uScale = 10;
    dirtPBR.albedoTexture.vScale = 10;
    dirtPBR.bumpTexture.uScale = 10;
    dirtPBR.bumpTexture.vScale = 10;
    dirtPBR.metallicTexture.uScale = 10;
    dirtPBR.metallicTexture.vScale = 10;
    underGround.material = dirtPBR;

    const groundMat = new BABYLON.StandardMaterial("groundMat", scene);
    const groundTex = new BABYLON.Texture("models/brown_mud_dry_diff_2k.jpg", scene);
    groundTex.uScale = n + 1;
    groundTex.vScale = m + 1;
    groundMat.diffuseTexture = groundTex;
    ground.material = groundMat;

    const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI");

    // ----- 큐브 모델 로딩 및 큐브, 라벨 생성 부분 -----
    BABYLON.SceneLoader.ImportMesh(null, "models/", "cube.gltf", scene, function (meshes) {
        const original = meshes[0];
        original.setEnabled(false);

        let labelCounter = 1;
        for (let i = m - 1; i >= 0; i--) {
            for (let j = n - 1; j >= 0; j--) {
                const x = j * spacingX;
                const z = i * spacingZ;

                // 큐브 복제 및 이름 설정 ("Cube" + labelCounter)
                const clone = original.clone(`Cube${labelCounter}`);
                clone.position.x = x;
                clone.position.z = z;
                clone.setEnabled(true);
                clone.name = `Cube${labelCounter}`;
                allCubes.push(clone);

                // 모든 하위 메시를 클릭 가능 + 개별 재질로 복사
                clone.getChildMeshes().forEach((mesh, index) => {
                    mesh.isPickable = true;

                    const newMat = new BABYLON.StandardMaterial(`mat_${labelCounter}_${index}`, scene);
                    newMat.diffuseColor = new BABYLON.Color3(1, 1, 1);
                    newMat.alpha = 1;
                    newMat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
                    newMat.needDepthPrePass = true;
                    mesh.material = newMat;

                    mesh.actionManager = new BABYLON.ActionManager(scene);
                    mesh.actionManager.registerAction(
                        new BABYLON.ExecuteCodeAction(
                            BABYLON.ActionManager.OnPickTrigger,
                            () => {
                                handleSelection(clone.name, scene);
                            }
                        )
                    );
                });

                // 큐브의 이름을 라벨 텍스트와 동일하게 설정
                const cubeName = "Cube" + labelCounter;
                clone.name = cubeName;
                allCubes.push(clone);

                // 라벨 생성 (텍스트도 "Cube" + labelCounter)
                const label = new BABYLON.GUI.Rectangle("label_" + labelCounter);
                label.background = "black";
                label.height = "25px";
                label.width = "80px";
                label.cornerRadius = 5;
                label.thickness = 0;
                label.alpha = 0.7;

                const text = new BABYLON.GUI.TextBlock();
                text.text = clone.name.replace("Cube", "");
                text.color = "white";
                text.fontSize = 15;
                label.addControl(text);

                const labelNode = new BABYLON.TransformNode("labelNode_" + labelCounter, scene);
                labelNode.position = new BABYLON.Vector3(x, 0.35, z);
                advancedTexture.addControl(label);
                label.linkWithMesh(labelNode);
                label.linkOffsetY = -10;

                label.onPointerEnterObservable.add(() => {
                    const popup = document.getElementById('hover-popup');
                    if (!popup) return;
                    popup.style.display = 'block';

                    const data = sensorData.dataMap.get(cubeName);
                    if (data) {
                        document.getElementById('hover-name').textContent = cubeName;
                        document.getElementById('hover-temp').textContent = 
                            data.temperature ? Number(data.temperature).toFixed(1) : '-';
                        document.getElementById('hover-humidity').textContent = 
                            data.humidity ? Number(data.humidity).toFixed(1) : '-';
                        document.getElementById('hover-illuminance').textContent = 
                            data.illuminance ? Number(data.illuminance).toFixed(1) : '-';
                    }
                });

                label.onPointerOutObservable.add(() => {
                    const popup = document.getElementById('hover-popup');
                    if (popup) popup.style.display = 'none';
                });

                label.onPointerEnterObservable.add(() => {
                    const popup = document.getElementById('hover-popup');
                    if (!popup) return;

                        popup.style.display = 'block';
                        centerHoverPopup();  // ← 위치 갱신

                        // 센서 데이터 세팅
                        const data = sensorData.dataMap.get(cubeName);
                        if (data) {
                        document.getElementById('hover-name').textContent = cubeName;

                        const temp = Number(data.temperature);
                        document.getElementById('hover-temp').textContent = isNaN(temp) ? '-' : temp.toFixed(1);

                        const humidity = Number(data.humidity);
                        document.getElementById('hover-humidity').textContent = isNaN(humidity) ? '-' : humidity.toFixed(1);

                        const illuminance = Number(data.illuminance);
                        document.getElementById('hover-illuminance').textContent = isNaN(illuminance) ? '-' : illuminance.toFixed(1);
                    }
                });

                allLabels.push({ label, cube: clone });

                // 라벨 클릭 이벤트: 라벨의 텍스트와 일치하는 큐브만 불투명하게 처리
                label.isPointerBlocker = true;  // 라벨 자체가 클릭 대상이 되도록 설정
                label.onPointerUpObservable.add(() => {
                    const isAlreadySelected = (selectedCubeName === clone.name);
                    handleSelection(isAlreadySelected ? null : clone.name, scene);
                });

                labelCounter++;
            }
        }

                // 초기 데이터 생성 및 업데이트 시작
        allCubes.forEach(cube => {
            sensorData.updateCubeData(cube.name);
            uiManager.updateCubeColor(cube);
            uiManager.updateLabelEmojis(cube.name);
        });

        // 5초마다 데이터 업데이트
        setInterval(() => {
            allCubes.forEach(cube => {
                sensorData.updateCubeData(cube.name);
                uiManager.updateCubeColor(cube);
                uiManager.updateLabelEmojis(cube.name);
            });
        }, 5000);
        
    });
    // ---------------------------------------------------------

    scene.onPointerObservable.add((pointerInfo) => {
        if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
            const pick = pointerInfo.pickInfo;

            // 아무것도 선택되지 않았거나, 선택된 것이 큐브나 라벨이 아닐 경우
            const pickedMesh = pick.pickedMesh;
            const isCube = allCubes.some(cube => cube.getChildMeshes().includes(pickedMesh));
            const isLabelNode = allLabels.some(({ label }) => label._linkedMesh === pickedMesh);

            if (!isCube && !isLabelNode) {
                // 빈 공간 클릭 → 선택 해제
                handleSelection(null, scene);
            }
        }
    });

    // ----- 온실 모델 로딩 -----
    BABYLON.SceneLoader.ImportMesh(
        null,
        "models/",
        "greenhouse.gltf",
        scene,
        function (meshes) {
            meshes.forEach(mesh => {
                mesh.isPickable = false;
            });
            const greenhouse = meshes[0];
            const groundWidth = totalWidth + spacingX;
            const groundDepth = totalDepth + spacingZ;
            const originalWidth = 10;
            const originalDepth = 10;
            const scaleX = groundWidth / originalWidth;
            const scaleZ = groundDepth / originalDepth;
            greenhouse.scaling = new BABYLON.Vector3(scaleX, 1, scaleZ);
            greenhouse.position.x = centerX;
            greenhouse.position.z = centerZ;
            greenhouse.position.y = 0;
        }
    );
    // -----------------------

    return scene;
};

createScene().then(scene => {
    window._sceneRef = scene;
    minimap = new Minimap(m, n, spacingX, spacingZ);
    minimap.start();

    engine.runRenderLoop(() => {
        scene.render();
    });
});

window.addEventListener("resize", () => {
    engine.resize();
});
// === [추가] 모든 큐브 클릭 시 forestsubpage.html 오픈 + 큐브별 데이터 전달 ===
(function bindAllCubesOpenWithData() {
  function tryBind() {
    const scene = window._sceneRef;
    if (!scene || !BABYLON || !BABYLON.PointerEventTypes) {
      setTimeout(tryBind, 100);
      return;
    }

    if (scene.__cubeOpenAllBound) return; // 중복 방지
    scene.__cubeOpenAllBound = true;

    // 짧은 시간에 중복 오픈 방지 (기존 Cube1 바인더와의 충돌도 흡수)
    let lastOpen = 0;

    scene.onPointerObservable.add((pi) => {
      if (pi.type !== BABYLON.PointerEventTypes.POINTERUP) return;

      const now = Date.now();
      if (now - lastOpen < 250) return; // 250ms 이내 중복 방지

      const pick = pi.pickInfo;
      if (!pick || !pick.hit || !pick.pickedMesh) return;

      // 클릭된 파츠에서 루트 메시까지 올라가서 이름 확인
      let node = pick.pickedMesh;
      while (node && node.parent) node = node.parent;

      // 이름이 "Cube숫자" 패턴인지 확인 (예: Cube1 ~ Cube64)
      if (!node || typeof node.name !== "string") return;
      const m = /^Cube(\d+)$/.exec(node.name);
      if (!m) return;

      const cubeName = node.name; // "Cube12" 같은 원본 이름
      const cubeNum  = m[1];      // "12" (숫자 부분)

      // sensorData에 있는 해당 큐브 데이터 스냅샷 만들기
      // (없으면 빈 객체)
      let data = {};
      try {
        if (window.sensorData && sensorData.dataMap) {
          data = sensorData.dataMap.get(cubeName) || {};
        }
      } catch (_) {}

      // 원하면 추가 메타도 포함 가능 (현재 모드, 타임스탬프 등)
      const payload = {
        cubeName,             // "Cube12"
        cubeNum,              // "12"
        mode: (window.sensorData && sensorData.currentMode) || null,
        data,                 // { temperature, humidity, illuminance } 등
        ts: Date.now()
      };

      // ★ 데이터 전달 방식: localStorage에 저장 + URL로 cube 파라미터 전달
      //   새 탭에서도 같은 origin이면 localStorage 접근 가능.
      //   subpage에서 `localStorage.getItem('cubeData:Cube12')`로 읽으면 됨.
      try {
        localStorage.setItem(`cubeData:${cubeName}`, JSON.stringify(payload));
      } catch (e) {
        console.warn("localStorage 저장 실패:", e);
      }

      // forestsubpage.html?cube=Cube12 형태로 오픈
      const url = `forestsubpage.html?cube=${encodeURIComponent(cubeName)}`;
      window.open(url, "_blank");

      lastOpen = now;
    });
  }
  tryBind();
})();
