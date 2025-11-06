(function() {
    let camera, scene, renderer, clock, controls;

    const vertexShader = `
        // Attributes from the geometry
        attribute vec2 uv2; // Used to identify corners of the quad (TEXCOORD1)

        // Uniforms from JavaScript
        uniform sampler2D posTex;
        uniform sampler2D colorTex;
        uniform float time;
        uniform float timeMultiplier;
        uniform float maxFrame;
        uniform float texelSizeY;
        uniform float quadSize;
        uniform float minSize;
        uniform float height;
        uniform bool isLerp;

        // Varyings to pass to fragment shader
        varying vec2 vUv2;
        varying vec4 vColor;

        // Helper to generate a random number
        float rand(vec2 co){
            return fract(sin(dot(co.xy ,vec2(12.9898, 78.233))) * 43758.5453);
        }

        // LookRotation function translated to GLSL
        mat3 lookRotation(vec3 forward, vec3 up) {
            forward = normalize(forward);
            vec3 right = normalize(cross(up, forward));
            vec3 newUp = cross(forward, right);
            return mat3(right, newUp, forward);
        }

        void main() {
            // Three.js automatically provides 'position' and 'uv' attributes.
            // vUv = uv; // Removed as unused
            vUv2 = uv2; // Pass uv2 to vUv2 for fragment shader

            // --- Time and Frame Calculation ---
            float motion = mod(time * timeMultiplier, maxFrame);
            float motionFrac = fract(motion);

            // --- VAT Texture Sampling ---
            // 'uv' is TEXCOORD0, used for sampling the VAT texture atlas
            vec2 sampleUv = uv;
            sampleUv.y += floor(motion) * texelSizeY;

            vec4 colorData = texture2D(colorTex, sampleUv);
            vec3 pos = texture2D(posTex, sampleUv).rgb;

            // --- Get Previous and Next Positions for calculating direction and lerping ---
            float prevFrame = floor(motion) - 1.0;
            if (prevFrame < 0.0) { prevFrame = maxFrame - 1.0; }
            vec2 prevUv = vec2(uv.x, uv.y + prevFrame * texelSizeY);
            vec3 pos_prev = texture2D(posTex, prevUv).rgb;
            pos_prev = mix(pos_prev, pos, motionFrac);

            if (isLerp) {
                float nextFrame = floor(motion) + 1.0;
                if (nextFrame >= maxFrame) { nextFrame = 0.0; }
                vec2 nextUv = vec2(uv.x, uv.y + nextFrame * texelSizeY);
                
                vec4 colorNext = texture2D(colorTex, nextUv);
                vColor = mix(colorData, colorNext, motionFrac);

                vec3 pos_next = texture2D(posTex, nextUv).rgb;
                pos = mix(pos, pos_next, motionFrac);
            } else {
                vColor = colorData;
            }

            // --- Build the Quad using uv2, ignoring the original 'position' attribute ---
            vec3 vertexPos = vec3(0.0);
            float size = quadSize * mix(minSize, 1.0, colorData.a * 2.0);

            // uv2.x and uv2.y are used to identify the corners of the quad
            if (uv2.x < 0.1) vertexPos.z -= size; // Back
            if (uv2.x > 0.9) vertexPos.z += size; // Front
            if (uv2.y < 0.1) vertexPos.x += size; // Right
            if (uv2.y > 0.9) vertexPos.x -= size; // Left

            // --- Add Flutter ---
            vertexPos.y += abs(uv2.x + uv2.y - 1.0) * sin(time * (1.0 + rand(uv))) * height * size;

            // --- Rotate the Quad to face the direction of movement ---
            vec3 direction = pos - pos_prev;
            if (length(direction) < 0.0001) {
                direction = vec3(0, 0, 1); // Default direction if static
            }
            mat3 rotMat = lookRotation(direction, vec3(0.0, 1.0, 0.0));
            vertexPos = rotMat * vertexPos;

            // --- Final Position: Translate the rotated quad to the VAT center position ---
            vec3 finalPos = pos + vertexPos;

            gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
        }
    `;

    const fragmentShader = `
        varying vec2 vUv2;
        varying vec4 vColor;

        uniform vec4 activeCol;
        uniform vec4 passiveCol;

        void main() {
            // Remap uv from [0,1] to [-1,1] for procedural drawing
            vec2 uv = vUv2 * 2.0 - 1.0;

            // Procedurally draw butterfly shape
            float butterflyShape = sqrt(length(uv));
            float wingPattern = pow(sin(atan(uv.y, uv.x) * 4.0 - 3.141592 / 2.0 * 3.0), 0.2);

            vec4 finalColor = vec4(0.0);
            if (butterflyShape < wingPattern) {
                finalColor = mix(passiveCol, vec4(vColor.rgb, 1.0), vColor.a) * 1.1;
            }

            // Discard transparent pixels
            if (finalColor.a < 0.1) {
                discard;
            }

            gl_FragColor = finalColor;
        }
    `;

    window.initBoidVatViewer = (containerSelector) => {
        const container = document.querySelector(containerSelector);
        if (!container) {
            console.error('Container not found');
            return;
        }

        clock = new THREE.Clock();

        // Scene
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x111111);
        scene.userData.vatMaterials = []; // Initialize array for materials

        // Camera
        camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
        camera.position.set(0, 10, 20); // Adjusted camera for better view of both objects

        // Renderer
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        container.appendChild(renderer.domElement);

        // Controls
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.minDistance = 1;
        controls.maxDistance = 100;

        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 1);
        scene.add(directionalLight);

        // Load assets and initialize
        loadAndCreateObjects();

        // Animation loop
        const animate = () => {
            requestAnimationFrame(animate);
            const time = clock.getElapsedTime();

            if (scene.userData.vatMaterials && scene.userData.vatMaterials.length > 0) {
                for (const material of scene.userData.vatMaterials) {
                    material.uniforms.time.value = time;
                }
            }

            controls.update();
            renderer.render(scene, camera);
        };

        animate();

        // Handle resize
        window.addEventListener('resize', () => {
            camera.aspect = container.clientWidth / container.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(container.clientWidth, container.clientHeight);
        });
    };

    async function createVatObject(paths, position) {
        const fbxLoader = new THREE.FBXLoader();
        const exrLoader = new THREE.EXRLoader();
        const textureLoader = new THREE.TextureLoader();

        try {
            const [modelObject, posTexture, colTex] = await Promise.all([
                fbxLoader.loadAsync(paths.fbx),
                exrLoader.loadAsync(paths.pos),
                textureLoader.loadAsync(paths.col)
            ]);

            posTexture.minFilter = THREE.NearestFilter;
            posTexture.magFilter = THREE.NearestFilter;
            colTex.minFilter = THREE.NearestFilter;
            colTex.magFilter = THREE.NearestFilter;
            posTexture.needsUpdate = true;

            const texHeight = colTex.image.height;

            const uniforms = {
                posTex: { value: posTexture },
                colorTex: { value: colTex },
                time: { value: 0.0 },
                timeMultiplier: { value: 10.0 },
                maxFrame: { value: 240 },
                texelSizeY: { value: 1.0 / texHeight },
                quadSize: { value: 0.15 },
                minSize: { value: 0.4 },
                height: { value: 1.0 },
                isLerp: { value: true },
                activeCol: { value: new THREE.Vector4(0.5, 0.5, 2.0, 1.0) },
                passiveCol: { value: new THREE.Vector4(0.25, 0.25, 0.25, 0.5) },
            };

            const shaderMaterial = new THREE.ShaderMaterial({
                uniforms: uniforms,
                vertexShader: vertexShader,
                fragmentShader: fragmentShader,
                side: THREE.DoubleSide,
                transparent: true,
            });

            scene.userData.vatMaterials.push(shaderMaterial);

            modelObject.traverse((child) => {
                if (child.isMesh) {
                    child.material = shaderMaterial;
                }
            });

            modelObject.position.copy(position);
            scene.add(modelObject);

        } catch (error) {
            console.error(`An error occurred loading assets for ${paths.fbx}:`, error);
        }
    }

    async function loadAndCreateObjects() {
        const object1_paths = {
            fbx: '/models/g15_b5.fbx',
            pos: '/textures/g15_b5_pos_diff.exr',
            col: '/textures/g15_b5_volume.png'
        };
        const object2_paths = {
            fbx: '/models/g15_b5.fbx',
            pos: '/textures/g15_b5_pos_diff 2.exr',
            col: '/textures/g15_b5_volume 2.png'
        }; // Using same assets for now

        await Promise.all([
            createVatObject(object1_paths, new THREE.Vector3(0, 0, 0)),
            //createVatObject(object2_paths, new THREE.Vector3(0, 0, 0))
        ]);
    }

    window.updateTimeMultiplier = (value) => {
        if (scene && scene.userData.vatMaterials) {
            for (const material of scene.userData.vatMaterials) {
                material.uniforms.timeMultiplier.value = value;
            }
        }
    };

    window.updateMinSize = (value) => {
        if (scene && scene.userData.vatMaterials) {
            for (const material of scene.userData.vatMaterials) {
                material.uniforms.minSize.value = value;
            }
        }
    };

    window.updatePassiveCol = (alpha) => {
        if (scene && scene.userData.vatMaterials) {
            for (const material of scene.userData.vatMaterials) {
                const color = new THREE.Color(0.25, 0.25, 0.25);
                material.uniforms.passiveCol.value.set(color.r, color.g, color.b, alpha);
            }
        }
    };

})();