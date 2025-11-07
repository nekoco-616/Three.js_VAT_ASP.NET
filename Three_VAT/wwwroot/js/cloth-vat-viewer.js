// wwwroot/js/cloth-vat-viewer.js

(function () {
    // Scope variables
    let clock;
    let scene; // Make scene accessible to the switcher function
    let animationFrameId; // To cancel the animation frame

    // The VAT shader patch function
    const patchShader = (shader, uniforms) => {
        shader.uniforms.u_time = uniforms.u_time;
        shader.uniforms.u_posTexture = uniforms.u_posTexture;
        shader.uniforms.u_maxMotion = uniforms.u_maxMotion;
        shader.uniforms.u_fps = uniforms.u_fps;
        shader.uniforms.u_texSize = uniforms.u_texSize;

        shader.vertexShader = `
            uniform float u_time;
            uniform sampler2D u_posTexture;
            uniform float u_maxMotion;
            uniform float u_fps;
            uniform vec2 u_texSize;
            attribute vec2 uv2;
            ${shader.vertexShader}
        `.replace(
            `#include <begin_vertex>`,
            `
            float motion = mod(u_time * u_fps, u_maxMotion);
            float currentFrame = floor(motion);
            vec2 currentUv = uv2;
            float frameHeightInPixels = 4.0 / u_texSize.y;
            currentUv.y += currentFrame * frameHeightInPixels;
            vec3 pos = texture2D(u_posTexture, currentUv).rgb;
            vec3 transformed = pos;
            `
        );
    };

    // Scene initialization
    window.initClothVatViewer = async (canvasId, modelPath, posTexturePath, maxMotion) => {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // --- Scene, Camera, Renderer ---
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x333333);
        const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
        camera.position.z = 5;
        const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
        renderer.setSize(canvas.clientWidth, canvas.clientHeight);

        clock = new THREE.Clock();
        const controls = new THREE.OrbitControls(camera, renderer.domElement);

        // --- Lights (needed for Lambert material) ---
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        directionalLight.position.set(1, 1, 1);
        scene.add(directionalLight);

        // --- Asset Loading ---
        const [fbx, posTexture] = await Promise.all([
            new THREE.FBXLoader().loadAsync(modelPath),
            new THREE.EXRLoader().loadAsync(posTexturePath)
        ]);

        posTexture.magFilter = THREE.NearestFilter;
        posTexture.minFilter = THREE.NearestFilter;

        // --- Uniforms (shared between materials) ---
        const uniforms = {
            u_time: { value: 0.0 },
            u_posTexture: { value: posTexture },
            u_maxMotion: { value: maxMotion },
            u_fps: { value: 30.0 },
            u_texSize: { value: new THREE.Vector2(posTexture.image.width, posTexture.image.height) }
        };

        // --- Materials ---
        const lambertMaterial = new THREE.MeshLambertMaterial({ color: 0xCCCCCC, side: THREE.DoubleSide });
        lambertMaterial.userData.uniforms = uniforms;
        lambertMaterial.onBeforeCompile = (shader) => patchShader(shader, uniforms);

        const wireframeMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, side: THREE.DoubleSide });
        wireframeMaterial.userData.uniforms = uniforms;
        wireframeMaterial.onBeforeCompile = (shader) => patchShader(shader, uniforms);

        // Store materials and model for later access
        scene.userData.materials = {
            lambert: lambertMaterial,
            wireframe: wireframeMaterial
        };
        const model = fbx;
        scene.userData.clothModel = model;

        // --- Apply default material to model ---
        model.traverse((child) => {
            if (child.isMesh) {
                child.material = lambertMaterial; // Default to Lambert
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
            
            // Update shared uniforms
            uniforms.u_time.value += deltaTime;

            controls.update();
            renderer.render(scene, camera);
        };
        animate();
    };

    window.disposeClothVatViewer = () => {
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
    window.setClothVatViewerMaterial = (name) => {
        if (scene && scene.userData.clothModel && scene.userData.materials) {
            const material = scene.userData.materials[name];
            if (material) {
                scene.userData.clothModel.traverse((child) => {
                    if (child.isMesh) {
                        child.material = material;
                    }
                });
            }
        }
    };

})();