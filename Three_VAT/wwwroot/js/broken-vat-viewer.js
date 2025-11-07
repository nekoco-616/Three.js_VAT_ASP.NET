// wwwroot/js/broken-vat-viewer.js

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
        shader.uniforms.u_column = uniforms.u_column;
        shader.uniforms.u_isLerp = uniforms.u_isLerp;

        shader.vertexShader = `
            uniform float u_time;
            uniform sampler2D u_posTexture;
            uniform float u_maxMotion;
            uniform float u_fps;
            uniform vec2 u_texSize;
            uniform float u_column;
            uniform bool u_isLerp;

            // HLSL's NormalUnpack in GLSL for WebGL 2.0
            vec3 normalUnpack(float v) {
                uint ix = floatBitsToUint(v);
                float r = float((ix >> 16) & 0xFFu) / 255.0;
                float g = float((ix >> 8)  & 0xFFu) / 255.0;
                float b = float( ix        & 0xFFu) / 255.0;
                return vec3(r, g, b) * 2.0 - 1.0;
            }

            ${shader.vertexShader}
        `.replace(
            `#include <begin_vertex>`,
            `
            float motion = mod(u_time * u_fps, u_maxMotion);
            float currentFrame = floor(motion);
            float motionLerp = fract(motion);

            float vertexId = float(gl_VertexID);
            float texelWidth = 1.0 / u_texSize.x;
            float texelHeight = 1.0 / u_texSize.y;

            float u = mod(vertexId, u_texSize.x) * texelWidth;
            float v_base = floor(vertexId / u_texSize.x) * texelHeight;

            float v_offset = floor(motion) * u_column * texelHeight;
            vec2 uv1 = vec2(u, v_base + v_offset + texelHeight);

            vec4 tex1 = texture2D(u_posTexture, uv1);
            vec3 pos = tex1.rgb;
            vec3 unpacked_normal = normalUnpack(tex1.a);
            vec3 normal = normalize(vec3(unpacked_normal.x, unpacked_normal.z, unpacked_normal.y));

            if (u_isLerp) {
                float nextFrame = ceil(motion);
                if (nextFrame >= u_maxMotion) {
                    nextFrame = 0.0; // Loop back
                }
                float v_offset_next = nextFrame * u_column * texelHeight;
                vec2 uv2 = vec2(u, v_base + v_offset_next + texelHeight);

                vec4 tex2 = texture2D(u_posTexture, uv2);
                vec3 pos2 = tex2.rgb;
                vec3 unpacked_normal2 = normalUnpack(tex2.a);
                vec3 normal2 = normalize(vec3(unpacked_normal2.x, unpacked_normal2.z, unpacked_normal2.y));

                pos = mix(pos, pos2, motionLerp);
                normal = normalize(mix(normal, normal2, motionLerp));
            }

            vec3 transformed = pos;
            `
        ).replace(
            `#include <defaultnormal_vertex>`,
            `
            #include <defaultnormal_vertex>
            // Overwrite the calculated normal with the one from the VAT texture
            transformedNormal = normal;
            `
        );
    };

    // Scene initialization
    window.initBrokenVatViewer = async (canvasId) => {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // --- Scene, Camera, Renderer ---
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x333333);
        const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
        camera.position.z = 5;
        const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
        console.log("Is WebGL 2 available?", renderer.capabilities.isWebGL2);
        renderer.setSize(canvas.clientWidth, canvas.clientHeight);

        clock = new THREE.Clock();
        const controls = new THREE.OrbitControls(camera, renderer.domElement);

        // --- Lights ---
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        directionalLight.position.set(1, 1, 1);
        scene.add(directionalLight);

        // --- Asset Loading ---
        const [fbx, posTexture] = await Promise.all([
            new THREE.FBXLoader().loadAsync("models/cell.fbx"),
            new THREE.EXRLoader().loadAsync("textures/cell_pos.exr")
        ]);

        posTexture.magFilter = THREE.NearestFilter;
        posTexture.minFilter = THREE.NearestFilter;

        // --- Uniforms ---
        const uniforms = {
            u_time: { value: 0.0 },
            u_posTexture: { value: posTexture },
            u_maxMotion: { value: 75.0 },
            u_fps: { value: 30.0 },
            u_texSize: { value: new THREE.Vector2(posTexture.image.width, posTexture.image.height) },
            u_column: { value: 10 },
            u_isLerp: { value: true }
        };

        // --- Materials ---
        const standardMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xCCCCCC, 
            side: THREE.DoubleSide,
            metalness: 0.1, // Slightly metallic
            roughness: 0.8  // A bit rough
        });
        standardMaterial.onBeforeCompile = (shader) => patchShader(shader, uniforms);

        const wireframeMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, side: THREE.DoubleSide });
        wireframeMaterial.onBeforeCompile = (shader) => patchShader(shader, uniforms);

        // Store materials and model for later access
        scene.userData.materials = {
            lambert: standardMaterial, // Use 'lambert' key for compatibility with existing UI
            wireframe: wireframeMaterial
        };
        const model = fbx;
        scene.userData.brokenModel = model;

        // --- Apply default material to model ---
        model.traverse((child) => {
            if (child.isMesh) {
                child.material = standardMaterial;
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