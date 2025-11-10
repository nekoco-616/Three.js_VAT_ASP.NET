// wwwroot/js/broken-vat-viewer.js

(function () {
    // Scope variables
    let clock;
    let scene; // Make scene accessible to the switcher function
    let animationFrameId; // To cancel the animation frame

    // HLSL's NormalUnpack in GLSL for WebGL 2.0
    const normalUnpack = () => {
        // This function will be inlined into the shader string
        return `
            vec3 normalUnpack(float v) {
                uint ix = floatBitsToUint(v);
                float r = float((ix >> 16) & 0xFFu) / 255.0;
                float g = float((ix >> 8)  & 0xFFu) / 255.0;
                float b = float( ix        & 0xFFu) / 255.0;
                return vec3(r, g, b) * 2.0 - 1.0;
            }
        `;
    };

    // Custom Vertex Shader (VAT位置と法線アニメーション版)
    const customVertexShader = () => `
        uniform float u_time;
        uniform sampler2D u_posTexture;
        uniform float u_maxMotion;
        uniform float u_fps;
        uniform vec2 u_texSize;
        uniform float u_column;
        uniform bool u_isLerp;

        varying vec3 vNormal;
        varying vec3 vViewPosition;
        varying vec2 vUv;

        ${normalUnpack()}

        void main() {
            float motion = mod(u_time * u_fps, u_maxMotion);
            float currentFrame = floor(motion);
            float motionLerp = fract(motion);

            float vertexId = float(gl_VertexID);
            float texelWidth = 1.0 / u_texSize.x;
            float texelHeight = 1.0 / u_texSize.y;

            float u = mod(vertexId, u_texSize.x) * texelWidth;
            float v_base = floor(vertexId / u_texSize.x) * texelHeight;

            float v_offset = floor(motion) * u_column * texelHeight;
            vec2 uv1 = vec2(u, v_base + v_offset + texelHeight); // +texelHeight はテクセル中央を指すため

            vec4 tex1 = texture2D(u_posTexture, uv1);
            vec3 vatPos = tex1.rgb;
            vec3 unpacked_normal = normalUnpack(tex1.a);
            vec3 vatNormal = normalize(vec3(unpacked_normal.x, unpacked_normal.z, unpacked_normal.y));

            if (u_isLerp) {
                float nextFrame = ceil(motion);
                if (nextFrame >= u_maxMotion) {
                    nextFrame = 0.0; // Loop back
                }
                float v_offset_next = nextFrame * u_column * texelHeight;
                vec2 uv2 = vec2(u, v_base + v_offset_next + texelHeight);

                vec4 tex2 = texture2D(u_posTexture, uv2);
                vec3 vatPos2 = tex2.rgb;
                vec3 unpacked_normal2 = normalUnpack(tex2.a);
                vec3 vatNormal2 = normalize(vec3(unpacked_normal2.x, unpacked_normal2.z, unpacked_normal2.y));

                vatPos = mix(vatPos, vatPos2, motionLerp);
                vatNormal = normalize(mix(vatNormal, vatNormal2, motionLerp));
            }

            // ワールド空間での位置と法線を計算
            vec4 worldPosition = modelMatrix * vec4(vatPos, 1.0);
            vec3 worldNormal = normalize(mat3(modelMatrix) * vatNormal);

            gl_Position = projectionMatrix * viewMatrix * worldPosition;

            vNormal = worldNormal;
            vViewPosition = -worldPosition.xyz; // カメラから頂点へのベクトル
            vUv = uv; // 標準のUVも渡しておく
        }
    `;

    // Custom Fragment Shader (ランバート反射版)
    const customFragmentShader = () => `
        uniform vec3 u_lightDirection; // ライトの方向 (ワールド空間)
        uniform vec3 u_lightColor;     // ライトの色
        uniform vec3 u_ambientColor;   // 環境光の色
        uniform vec3 u_diffuseColor;   // マテリアルの拡散色

        varying vec3 vNormal;
        varying vec3 vViewPosition;
        varying vec2 vUv;

        void main() {
            // 法線を正規化 (補間された法線は長さが1ではない可能性があるため)
            vec3 normal = normalize(vNormal);

            // ライトの方向を正規化
            vec3 lightDirection = normalize(-u_lightDirection);

            // 拡散反射 (Lambertian)
            float diff = max(dot(normal, lightDirection), 0.0);
            vec3 diffuse = u_lightColor * u_diffuseColor * diff;

            // 環境光
            vec3 ambient = u_ambientColor * u_diffuseColor;

            // 最終的な色
            vec3 finalColor = ambient + diffuse;

            gl_FragColor = vec4(finalColor, 1.0);
        }
    `;

    // Custom Fragment Shader (ワイヤーフレーム用)
    const customWireframeFragmentShader = () => `
        void main() {
            gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); // 緑色で表示
        }
    `;

    // Scene initialization
    window.initBrokenVatViewer = async (canvasId) => {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // --- Scene, Camera, Renderer ---
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0);
        const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 3000);
        camera.position.z = 5;
        const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
        console.log("Is WebGL 2 available?", renderer.capabilities.isWebGL2);
        renderer.setSize(canvas.clientWidth, canvas.clientHeight);

        clock = new THREE.Clock();
        const controls = new THREE.OrbitControls(camera, renderer.domElement);

        // --- Lights ---
        // カスタムシェーダーで使うライトの情報をuniformsに渡すため、Three.jsのライトはダミーで追加
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        directionalLight.position.set(0, 1, 0);
        scene.add(directionalLight);

        // --- Asset Loading ---
        const [fbx, posTexture] = await Promise.all([
            new THREE.FBXLoader().loadAsync("models/cell.fbx"),
            new THREE.EXRLoader().loadAsync("textures/cell_pos.exr")
        ]);

        posTexture.magFilter = THREE.NearestFilter;
        posTexture.minFilter = THREE.NearestFilter;

        // --- Uniforms (Custom Shader) ---
        const uniforms = {
            u_time: { value: 0.0 },
            u_posTexture: { value: posTexture },
            u_maxMotion: { value: 75.0 },
            u_fps: { value: 30.0 },
            u_texSize: { value: new THREE.Vector2(posTexture.image.width, posTexture.image.height) },
            u_column: { value: 10 },
            u_isLerp: { value: true },
            // カスタムシェーダー用のライト情報
            u_lightDirection: { value: new THREE.Vector3(1, 1, 1).normalize() },
            u_lightColor: { value: new THREE.Color(0xffffff) },
            u_ambientColor: { value: new THREE.Color(0x404040) }, // Three.jsのAmbientLightのデフォルトに近い値
            u_diffuseColor: { value: new THREE.Color(0xCCCCCC) }
        };

        // --- Materials (Custom Shader) ---
        const customShaderMaterial = new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: customVertexShader(),
            fragmentShader: customFragmentShader(),
            side: THREE.DoubleSide,
            lights: false // Three.jsの標準ライティングを無効にする
        });

        // ワイヤーフレームマテリアルもカスタムシェーダーにする
        const customWireframeMaterial = new THREE.ShaderMaterial({
            uniforms: uniforms, // 同じuniformsを共有
            vertexShader: customVertexShader(), // ★ここを通常のcustomVertexShader()に修正★
            fragmentShader: customWireframeFragmentShader(),
            side: THREE.DoubleSide,
            wireframe: true, // ワイヤーフレームを有効にする
            lights: false
        });

        // Store materials and model for later access
        scene.userData.materials = {
            lambert: customShaderMaterial, // カスタムシェーダーを割り当てる
            wireframe: customWireframeMaterial // カスタムワイヤーフレームシェーダーを割り当てる
        };
        const model = fbx;
        scene.userData.brokenModel = model;

        // --- Apply default material to model ---
        model.traverse((child) => {
            if (child.isMesh) {
                child.material = customShaderMaterial;
            }
        });

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        scene.add(model);

        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = camera.fov * (Math.PI / 180);
        camera.position.z = Math.abs(maxDim / Math.tan(fov / 2));
        camera.position.z *= 1.5;
        camera.lookAt(model.position);
        controls.target.copy(model.position);
        controls.update();

        // --- Animation Loop ---
        const animate = () => {
            animationFrameId = requestAnimationFrame(animate);
            const deltaTime = clock.getDelta();
            
            uniforms.u_time.value += deltaTime;

            controls.update();
            renderer.render(scene, camera);
        };
        animate();
    };

    window.disposeBrokenVatViewer = () => {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        if (scene) {
            scene.traverse(object => {
                if (object.isMesh) {
                    if (object.geometry) {
                        object.geometry.dispose();
                    }
                    if (object.material) {
                        if (Array.isArray(object.material)) {
                            object.material.forEach(material => material.dispose());
                        } else {
                            object.material.dispose();
                        }
                    }
                }
            });
            scene = null;
        }
    };

    // --- Material Switcher Function ---
    window.setBrokenVatViewerMaterial = (name) => {
        if (scene && scene.userData.brokenModel && scene.userData.materials) {
            const material = scene.userData.materials[name];
            if (material) {
                scene.userData.brokenModel.traverse((child) => {
                    if (child.isMesh) {
                        child.material = material;
                    }
                });
            }
        }
    };

})();