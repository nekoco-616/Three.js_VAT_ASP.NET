Shader "Unlit/test5_b"
{
    Properties
    {
        _MainTex ("Texture", 2D) = "white" {}
        _PosTex ("Position", 2D) = "white" {}

        [Header(Size)]
        _QuadSize ("Quad Size", Float) = 0.1
        _MinSize ("Min Quad Size", Float) = 0.5
        _Height ("Height", Float) = 0

        [Header(Motion)]
        _Frame ("Motion Frame", Float) = 0
        _MaxFrame ("Max Frame", Float) = 0
        [Toggle] _IsLerp("Motion Lerp", Float) = 0
        [Toggle] _TimeMotion("Time Motion", Float) = 0
        
        [Header(Color)]
        _ActiveCol ("Active Color", Color) = (1,1,1,1)
        _PassiveCol ("Passive Color", Color) = (0,0,0,0)
    }
    SubShader
    {
        Tags { "Queue"="AlphaTest" "RenderType"="TransparentCutout" }
        LOD 100
        cull off

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag

            #pragma shader_feature _TIMEMOTION_ON
            #pragma shader_feature _ISLERP_ON

            #include "UnityCG.cginc"

            struct appdata
            {
                float4 vertex : POSITION;
                float2 uv : TEXCOORD0;
                float2 uv2 : TEXCOORD1;
            };

            struct v2f
            {
                float4 vertex : SV_POSITION;
                float2 uv : TEXCOORD0;
                float2 uv2 : TEXCOORD1;
                fixed4 color : TEXCOORD2;
            };

            sampler2D _MainTex, _PosTex;
            float4 _MainTex_TexelSize;
            float _QuadSize, _MinSize, _Height, _Frame, _MaxFrame;
            fixed4 _ActiveCol, _PassiveCol;

            float rand(float2 co)
            {
                return frac(sin(dot(co.xy, float2(12.9898, 78.233))) * 43758.5453);
            }

            float3x3 LookRotation(float3 forwardDir, float3 upApprox)
            {
                // forwardDir は正規化済みと仮定
                float3 right;
                // forwardDir と upApprox がほぼ平行かどうかチェック
                // (dot product の絶対値が 1 に非常に近いか)
                if (abs(dot(forwardDir, upApprox)) > 0.9999f)
                {
                    // 平行な場合、別の軸 (例: ワールドのX軸) を使って right を計算
                    // これにより、ターゲットが真上や真下を向いた場合でも破綻しない
                    right = normalize(cross(float3(1.0, 0.0, 0.0), forwardDir));
                    // もし forwardDir が X軸とも平行だったら Z軸を使う
                    if (length(right) < 0.0001f) {
                        right = normalize(cross(float3(0.0, 0.0, 1.0), forwardDir));
                    }
                }
                else
                {
                    // 通常の場合、upApprox との外積で right を計算
                    right = normalize(cross(upApprox, forwardDir));
                }

                // forward と right は直交しており、正規化されているので、
                // これらから外積で up ベクトルを計算すれば、それも正規化されている
                float3 up = cross(forwardDir, right);

                // 回転行列を構築 (列ベクトルベース)
                // 各列が新しい座標系の基底ベクトル (X, Y, Z) に対応
                return float3x3(
                    right.x, up.x, forwardDir.x,  // 1列目 (新しいX軸)
                    right.y, up.y, forwardDir.y,  // 2列目 (新しいY軸)
                    right.z, up.z, forwardDir.z   // 3列目 (新しいZ軸)
                );
            }

            v2f vert (appdata v)
            {
                float motion;
#ifdef _TIMEMOTION_ON                
                motion = _Time.w * 5 % _MaxFrame;
#else
                motion = _Frame % _MaxFrame;
#endif

                float2 uv = v.uv;
                uv.y += floor(motion) * _MainTex_TexelSize.y;

                fixed4 color = tex2Dlod(_MainTex, float4(uv, 0, 0));
                float3 pos = tex2Dlod(_PosTex, float4(uv, 0, 0));

                float pix_y_offset = _MainTex_TexelSize.y / 2.0;
                float2 uv_prev = float2(uv.x, uv.y - _MainTex_TexelSize.y);
                uv_prev.y = (motion <= 1)
                    ? pix_y_offset + _MainTex_TexelSize.y * (_MaxFrame-1)
                    : uv_prev.y;

                float3 pos_prev = tex2Dlod(_PosTex, float4(uv_prev, 0, 0));
                pos_prev = lerp(pos_prev, pos, frac(motion));
#ifdef _ISLERP_ON
                float2 uv_next = float2(uv.x, uv.y + _MainTex_TexelSize.y);
                uv_next.y = (motion >= _MaxFrame-1.0) 
                    ? pix_y_offset
                    : uv_next.y;

                fixed4 color2 = tex2Dlod(_MainTex, float4(uv_next, 0, 0));
                color = lerp(color, color2, frac(motion));

                float3 pos_next = tex2Dlod(_PosTex, float4(uv_next, 0, 0));
                pos = lerp(pos, pos_next, frac(motion));
#endif
                float4 vertex = float4(0, 0, 0, v.vertex.w);

                float size = _QuadSize * lerp(_MinSize, 1, color.a*2);
                vertex.z += (v.uv2.x < 0.1) ? -size : 0;
                vertex.z += (v.uv2.x > 0.9) ? size : 0;
                vertex.x += (v.uv2.y < 0.1) ? size : 0;
                vertex.x += (v.uv2.y > 0.9) ? -size : 0;

                vertex.y += abs(v.uv2.x + v.uv2.y - 1)
                    * sin(_Time.y * 5 * (1 + rand(v.uv)))
                    * _Height * size;

                vertex.xyz = mul(
                    LookRotation(normalize(float3(-1,0,1)), float3(0.0, 1.0, 0.0)),
                    vertex
                    );

                vertex.xyz = mul(
                    LookRotation(normalize(pos_prev - pos), float3(0.0, 1.0, 0.0)),
                    vertex
                    );

                vertex.xyz += pos;

                v2f o;
                o.vertex = UnityObjectToClipPos(vertex);
                o.uv = uv;
                o.uv2 = v.uv2;
                o.color = color;
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                fixed4 tex = i.color;
                float2 uv = i.uv2 * 2.0 - 1.0;

                fixed4 col = (
                    sqrt(length(uv)) < 
                    pow(sin(atan2(uv.y, uv.x) * 4 - 3.141592 / 2 * 3), 0.2)
                    )
                    //? lerp(fixed4(0,0,0,1), fixed4(0.5, 0.5, 2, 1), tex.r)
                    //? lerp(_PassiveCol, _ActiveCol, tex.r) * 2
                    ? lerp(_PassiveCol, fixed4(i.color.rgb, 1), tex.a) * 1.1
                    : 0;

                clip(col.a - 0.1);
                return col;
            }
            ENDCG
        }
    }
}
