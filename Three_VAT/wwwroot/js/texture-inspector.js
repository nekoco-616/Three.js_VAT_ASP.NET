// wwwroot/js/texture-inspector.js

let textureData = null;
let textureWidth = 0;
let textureHeight = 0;
let dotNetHelper = null;

// テクスチャを読み込み、プレーンに貼り付けて表示する
export function initTextureInspector(canvasId, texturePath, helper) {
    dotNetHelper = helper;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
    camera.position.z = 1;

    const renderer = new THREE.WebGLRenderer({ canvas: canvas });

    const loader = new THREE.EXRLoader();
    loader.load(texturePath, (texture) => {
        // テクスチャのフィルタリングをNearestに設定して、ピクセルがぼやけないようにする
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;

        // テクスチャのデータを保持
        textureData = texture.image.data;
        textureWidth = texture.image.width;
        textureHeight = texture.image.height;

        console.log(`Texture loaded: ${textureWidth} x ${textureHeight}`);

        // レンダラーのサイズはテクスチャの解像度に合わせる
        renderer.setSize(textureWidth, textureHeight);
        // キャンバスの表示サイズを5倍にする
        const displayWidth = textureWidth * 5;
        const displayHeight = textureHeight * 5;
        canvas.style.width = `${displayWidth}px`;
        canvas.style.height = `${displayHeight}px`;

        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.MeshBasicMaterial({ map: texture });
        const plane = new THREE.Mesh(geometry, material);
        scene.add(plane);

        renderer.render(scene, camera);
    });

    // キャンバスのクリックイベント
    canvas.addEventListener('click', (event) => {
        if (!textureData) return;

        const rect = canvas.getBoundingClientRect();
        // 表示上のクリック座標
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        // 表示サイズとテクスチャ解像度の比率を計算
        const scaleX = textureWidth / rect.width;
        const scaleY = textureHeight / rect.height;

        // テクスチャ座標に変換
        const uvX = Math.floor(x * scaleX);
        const uvY = Math.floor(y * scaleY);

        if (uvX >= 0 && uvX < textureWidth && uvY >= 0 && uvY < textureHeight) {
            getPixelValue(uvX, uvY);
        }
    });
}

// 指定された座標のピクセル値を取得して.NETに渡す
function getPixelValue(x, y) {
    if (!textureData || !dotNetHelper) return;

    // Y座標を反転させる（テクスチャの原点は左下）
    const invertedY = textureHeight - 1 - y;
    const index = (invertedY * textureWidth + x) * 4;

    const r = textureData[index];
    const g = textureData[index + 1];
    const b = textureData[index + 2];
    const a = textureData[index + 3];

    // .NET側のメソッドを呼び出す
    dotNetHelper.invokeMethodAsync('SetPixelValue', x, y, r, g, b, a);
}
