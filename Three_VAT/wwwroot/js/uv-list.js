// wwwroot/js/uv-list.js

let uv1, uv2;

// モデルを読み込み、UVデータをキャッシュする
export function init(modelPath) {
    return new Promise((resolve, reject) => {
        const loader = new THREE.FBXLoader();
        loader.load(modelPath, (fbx) => {
            let meshFound = false;
            fbx.traverse((child) => {
                if (child.isMesh) {
                    meshFound = true;
                    console.log(`Mesh found in ${modelPath}:`, child.name);

                    // UVデータを取得・キャッシュ
                    const geometry = child.geometry;
                    uv1 = geometry.attributes.uv ? geometry.attributes.uv.array : new Float32Array();
                    uv2 = geometry.attributes.uv2 ? geometry.attributes.uv2.array : new Float32Array();

                    console.log(`UVMap (uv) found: ${uv1.length / 2} vertices`);
                    console.log(`VertexUV (uv2) found: ${uv2.length / 2} vertices`);
                }
            });

            if (!meshFound) {
                console.warn(`No mesh found in ${modelPath}`);
                uv1 = new Float32Array();
                uv2 = new Float32Array();
            }
            resolve();
        }, undefined, (error) => {
            console.error(`Error loading ${modelPath}:`, error);
            uv1 = new Float32Array();
            uv2 = new Float32Array();
            reject(error);
        });
    });
}

// 要求されたUVセットのデータをBlazorが受け取れる形式で返す
export function getUvData(uvSetIndex) {
    const sourceArray = (uvSetIndex === 1) ? uv2 : uv1;
    if (!sourceArray || sourceArray.length === 0) {
        return [];
    }

    const result = [];
    for (let i = 0; i < sourceArray.length; i += 2) {
        result.push([sourceArray[i], sourceArray[i + 1]]);
    }
    return result;
}
