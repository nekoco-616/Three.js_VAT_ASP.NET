// wwwroot/js/vat-minimal-fbx.js

// グローバルスコープで変数を宣言し、関数間で共有できるようにする
let vatMaterial;
let clock;

// シーンを初期化する
window.initClothVatViewer = async (canvasId, modelPath, posTexturePath, maxMotion) => {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    // --- シーンとカメラ、レンダラー ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x333333);
    const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    camera.position.z = 5;
    const renderer = new THREE.WebGLRenderer({ canvas: canvas });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    // グローバル変数を初期化
    clock = new THREE.Clock();

    // OrbitControlsの初期化
    const controls = new THREE.OrbitControls(camera, renderer.domElement);

    // --- アセットの読み込み ---
    const [fbx, posTexture] = await Promise.all([
        new THREE.FBXLoader().loadAsync(modelPath),
        new THREE.EXRLoader().loadAsync(posTexturePath)
    ]);

    // ★★★ フィルタリング設定（歪み防止） ★★★
    posTexture.magFilter = THREE.NearestFilter;
    posTexture.minFilter = THREE.NearestFilter;

    // --- カスタムマテリアルの作成 ---
    // グローバル変数にマテリアルを代入
    vatMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        wireframe: true
    });

    // Uniform変数を定義
    vatMaterial.userData.uniforms = {
        u_time: { value: 0.0 },
        u_posTexture: { value: posTexture },
        u_maxMotion: { value: maxMotion },
        u_fps: { value: 30.0 },
        u_texSize: { value: new THREE.Vector2(posTexture.image.width, posTexture.image.height) }
    };

    // onBeforeCompileで頂点シェーダーを書き換える
    vatMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.u_time = vatMaterial.userData.uniforms.u_time;
        shader.uniforms.u_posTexture = vatMaterial.userData.uniforms.u_posTexture;
        shader.uniforms.u_maxMotion = vatMaterial.userData.uniforms.u_maxMotion;
        shader.uniforms.u_fps = vatMaterial.userData.uniforms.u_fps;
        shader.uniforms.u_texSize = vatMaterial.userData.uniforms.u_texSize;

        shader.vertexShader = `
            uniform float u_time;
            uniform sampler2D u_posTexture;
            uniform float u_maxMotion;
            uniform float u_fps;
            uniform vec2 u_texSize;

            attribute vec2 uv2; // 追加

            ${shader.vertexShader}
        `.replace(
            `#include <begin_vertex>`,
            `
            float motion = mod(u_time * u_fps, u_maxMotion);
            float currentFrame = floor(motion);
            vec2 currentUv = uv2; // 変更

            // Houdini VAT標準のUV計算 (1フレームの高さ=テクスチャ幅)
            float frameHeightInPixels = 4.0f / u_texSize.y;
            currentUv.y += currentFrame * frameHeightInPixels;

            vec3 pos = texture2D(u_posTexture, currentUv).rgb;
            vec3 transformed = pos;
            `
        );
    };

    // --- モデルにマテリアルを適用 ---
    const model = fbx;
    model.traverse((child) => {
        if (child.isMesh) {
            child.material = vatMaterial;
        }
    });

    // モデルが中央に来るように調整
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    scene.add(model);

    // カメラをモデル全体が映るように自動調整
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    camera.position.z = Math.abs(maxDim / Math.tan(fov / 2));
    camera.position.z *= 1.5; // 少し離れる
    camera.lookAt(model.position);
    controls.target.copy(model.position); // 注視点も合わせる
    controls.update();

    // --- アニメーションループを開始 ---
    animate(renderer, scene, camera, controls);
};

// ★★★ animate関数を分離し、必要なものを引数で渡す ★★★
function animate(renderer, scene, camera, controls) {
    requestAnimationFrame(() => animate(renderer, scene, camera, controls));

    // vatMaterialが初期化済みかチェックしてからアクセスする
    if (vatMaterial && clock) {
        vatMaterial.userData.uniforms.u_time.value += clock.getDelta();
    }

    controls.update();
    renderer.render(scene, camera);
}