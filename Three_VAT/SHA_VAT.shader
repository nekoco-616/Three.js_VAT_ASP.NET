Shader "nekoya/VAT"
// var 2.1
{
    Properties
    {
        _PosTexture("Position Texture", 2D) = "white"{}
        [Space(20)]
        [Header(Motion)]
        [Space(10)]
        [Toggle] _IsFluid("Is Mock Object", Float) = 0
        _Motion("Motion Parametor", Float) = 0
        [Toggle] _IsLerp("Motion Lerp", Float) = 0
        [Toggle] _IsRand("Random Motion", Float) = 0
        [Toggle] _TimeMotion("Time Motion", Float) = 0
        _FPS("Time Motion FPS", Float) = 15
        [Space(20)]
        [Header(Lighting)]
        [Space(10)]
        _MainTex ("Texture", 2D) = "white" {}
        _Color ("Color", Color) = (1,1,1,1)
        [Toggle] _IsShadow("Is Cast Shadow", Float) = 0
        [Space(10)]
        [Toggle] _IsRimLight("Is Rim Light", Float) = 0
        _RimLightColor("Rim Light Color", Color) = (1,1,1,1)
        _RimLightPower("Rim Light Power", Range(0.5, 8.0)) = 3.0
        [Space(10)]
        _AmbientColor ("Ambient Color", Color) = (0.2,0.2,0.2,1)
        //_Cutoff("Cutoff Alpha", Range(0, 1)) = 0.001
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" }

        //Tags { "Queue" = "Transparent" "RenderType" = "Transparent" }
        //Blend SrcAlpha OneMinusSrcAlpha

        //Tags { "Queue"="AlphaTest" "RenderType"="TransparentCutout" }
        LOD 100
        Cull Off

        CGINCLUDE
        #pragma vertex vert
        #pragma fragment frag
        #pragma multi_compile_instancing
        #pragma shader_feature _ISFLUID_ON
        #pragma shader_feature _ISLERP_ON
        #pragma shader_feature _ISRAND_ON
        #pragma shader_feature _TIMEMOTION_ON

        #include "UnityCG.cginc"
        #include "Lighting.cginc" 
        #include "AutoLight.cginc"

        struct appdata
        {
            float4 vertex : POSITION;
            float2 uv : TEXCOORD0;
            float2 VertexUV : TEXCOORD1;
            UNITY_VERTEX_INPUT_INSTANCE_ID
        };

        void ShortUnpack(float v, out int v1, out int v2)
        {
            uint ix = asuint(v);
            v1 = (ix & 0x3FFF0000) >> 16;
            v2 = (ix & 0x00003FFF);
        }

        half3 NormalUnpack(float v){
            uint ix = asuint(v);
            half3 normal = half3((ix & 0x00FF0000) >> 16, (ix & 0x0000FF00) >> 8, ix & 0x000000FF);
            return normal / 255.0 * 2.0 - 1.0;
        }

        float rand(float2 uv)
        {
            return frac(sin(dot(uv, float2(12.9898, 78.233))) * 43758.5453);
        }

        sampler2D _PosTexture, _MainTex;
        float4 _PosTexture_TexelSize, _MainTex_ST;
        fixed4 _Color;
        float _Motion, _FPS;
        //float _Cutoff;
        ENDCG

        Pass
        {
            Tags { "LightMode" = "ForwardBase" }

            CGPROGRAM
            #pragma multi_compile_fog
            #pragma multi_compile_fwdbase
            #pragma shader_feature _ISRIMLIGHT_ON
            #pragma shader_feature _ISSHADOW_ON

            struct v2f
            {
                float4 pos : SV_POSITION;
                half3 normal : TEXCOORD0;
                float2 uv : TEXCOORD1;
                float3 viewDir : TEXCOORD2;
                half3 ambient : TEXCOORD3;
                UNITY_FOG_COORDS(4)
                SHADOW_COORDS(5)
                UNITY_VERTEX_OUTPUT_STEREO
            };

            float3 Shade4PointLights_Culloff(
                float4 lightPosX, float4 lightPosY, float4 lightPosZ,
                float3 lightColor0, float3 lightColor1, float3 lightColor2, float3 lightColor3,
                float4 lightAttenSq,float3 pos, float3 normal)
            {
                // to light vectors
                float4 toLightX = lightPosX - pos.x;
                float4 toLightY = lightPosY - pos.y;
                float4 toLightZ = lightPosZ - pos.z;

                // squared lengths
                float4 lengthSq = 0;
                lengthSq += toLightX * toLightX;
                lengthSq += toLightY * toLightY;
                lengthSq += toLightZ * toLightZ;

                // don't produce NaNs if some vertex position overlaps with the light
                lengthSq = max(lengthSq, 0.000001);

                // NdotL
                float4 ndotl = 0;
                ndotl += toLightX * normal.x;
                ndotl += toLightY * normal.y;
                ndotl += toLightZ * normal.z;

                // correct NdotL
                float4 corr = rsqrt(lengthSq);
                ndotl = (ndotl < 0) ? -ndotl : ndotl;
                ndotl = max(float4(0,0,0,0), ndotl * corr);

                // attenuation
                float4 atten = 1.0 / (1.0 + lengthSq * lightAttenSq);
                float4 diff = ndotl * atten;

                // final color
                float3 col = 0;
                col += lightColor0 * diff.x;
                col += lightColor1 * diff.y;
                col += lightColor2 * diff.z;
                col += lightColor3 * diff.w;

                return col;
            }
            
            fixed4 _RimLightColor, _AmbientColor;
            float _RimLightPower;

            v2f vert(appdata v, uint vid : SV_VertexID)
            {
                UNITY_SETUP_INSTANCE_ID(v);

                float4 param = tex2Dlod(_PosTexture, 0);
                int column, maxMotion;
                ShortUnpack(param.r, column, maxMotion);

                float motion;
#ifdef _TIMEMOTION_ON
                motion = _Time.y *_FPS;
#else
                motion = _Motion;
#endif
#ifdef _ISRAND_ON
                float4 wpos_object = mul(unity_ObjectToWorld, float4(0.0f, 0.0f, 0.0f, 1.0f));
                motion += rand(float2(rand(float2(wpos_object.x, wpos_object.y)), wpos_object.z)) * maxMotion;
#endif
                motion = motion % maxMotion;

                float2 uv;
#ifdef _ISFLUID_ON
                uv = float2(
                    float(vid) % _PosTexture_TexelSize.z * _PosTexture_TexelSize.x,
                    (int(float(vid) * _PosTexture_TexelSize.x) + 1.0f) * _PosTexture_TexelSize.y
                    );
#else
                uv = v.VertexUV;
#endif
                uv.y += _PosTexture_TexelSize.y * column * floor(motion);

                float4 tex = tex2Dlod(_PosTexture, float4(uv, 0, 0));
                float3 pos = float3(tex.r, tex.b, tex.g);
                half3 normal = NormalUnpack(tex.a);
                normal = normalize(half3(normal.x, normal.z, normal.y));
#ifdef _ISLERP_ON
    #ifdef _ISFLUID_ON
                uv.y = (int(float(vid) * _PosTexture_TexelSize.x) + 1.0f) * _PosTexture_TexelSize.y;
    #else
                uv.y = v.VertexUV.y;
    #endif
                uv.y += (motion >= maxMotion - 1.0f)
                    ? _PosTexture_TexelSize.y * column
                    : _PosTexture_TexelSize.y * column * ceil(motion);

                float4 tex2 = tex2Dlod(_PosTexture, float4(uv, 0, 0));
                float3 pos2 = float3(tex2.r, tex2.b, tex2.g);
                half3 normal2 = NormalUnpack(tex2.a);
                normal2 = normalize(half3(normal2.x, normal2.z, normal2.y));

                pos = lerp(pos, pos2, frac(motion));
                normal = lerp(normal, normal2, frac(motion));
#endif
                v2f o;
                UNITY_INITIALIZE_OUTPUT(v2f, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

                o.pos = UnityObjectToClipPos(float4(pos, v.vertex.w));
                o.normal = UnityObjectToWorldNormal(normalize(normal));
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                UNITY_TRANSFER_FOG(o, o.pos);
                TRANSFER_SHADOW(o)

                float3 wpos = mul(unity_ObjectToWorld, float4(pos, v.vertex.w)).xyz;
                o.viewDir = normalize(_WorldSpaceCameraPos - wpos);
                
                o.ambient = 0;
#if UNITY_SHOULD_SAMPLE_SH
    #if VERTEXLIGHT_ON
                o.ambient = Shade4PointLights_Culloff(
                    unity_4LightPosX0, unity_4LightPosY0, unity_4LightPosZ0,
                    unity_LightColor[0].rgb, unity_LightColor[1].rgb,
                    unity_LightColor[2].rgb, unity_LightColor[3].rgb,
                    unity_4LightAtten0, wpos, o.normal
                    );
    #endif
                o.ambient += max(0, ShadeSH9(float4(o.normal, 1)));
#endif
                return o;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                float3 normal = normalize(i.normal);
                float3 viewDir = normalize(i.viewDir);
                fixed4 texCol = tex2D(_MainTex, i.uv) * _Color;

                float diff = saturate(dot(normal, _WorldSpaceLightPos0.xyz));
                fixed3 diffuse = diff * _LightColor0;
#ifdef _ISRIMLIGHT_ON
                float3 rimNormal = normal;
                if (dot(rimNormal, viewDir) < 0.0) { rimNormal = -rimNormal; }
                float rim = 1.0 - saturate(dot(rimNormal, viewDir));
                rim = pow(rim, _RimLightPower);
                fixed3 rimColor = rim * _RimLightColor.rgb;
#endif

                fixed4 shadow = SHADOW_ATTENUATION(i);

                fixed4 color;
#ifdef _ISRIMLIGHT_ON
                color.rgb = diffuse + rimColor + i.ambient;
#else
                color.rgb = diffuse + i.ambient;
#endif
                color.rgb *= texCol.rgb;
#ifdef _ISSHADOW_ON
                color.rgb *= clamp(pow(shadow.rgb, 0.8), 0.1, 1.0);
#endif
                color.rgb += _AmbientColor.rgb * _Color.rgb;
                UNITY_APPLY_FOG(i.fogCoord, color);

                color.a = texCol.a;
                //clip(color.a - _Cutoff);
                return color;
            }
            ENDCG
        }
        
        Pass
        {
            Tags { "LightMode"="ForwardAdd" }
            Blend One One

            CGPROGRAM
            #pragma multi_compile_fwdadd_fullshadows

            struct v2f
            {
                float4 pos : SV_POSITION;
                half3 normal : NORMAL;
                float2 uv : TEXCOORD0;
                float3 wpos : TEXCOORD1;
                SHADOW_COORDS(2)
                UNITY_VERTEX_OUTPUT_STEREO
            };

            v2f vert(appdata v, uint vid : SV_VertexID)
            {
                UNITY_SETUP_INSTANCE_ID(v);

                float4 param = tex2Dlod(_PosTexture, 0);
                int column, maxMotion;
                ShortUnpack(param.r, column, maxMotion);

                float motion;
#ifdef _TIMEMOTION_ON
                motion = _Time.y *_FPS;
#else
                motion = _Motion;
#endif
#ifdef _ISRAND_ON
                float4 wpos_object = mul(unity_ObjectToWorld, float4(0.0f, 0.0f, 0.0f, 1.0f));
                motion += rand(float2(rand(float2(wpos_object.x, wpos_object.y)), wpos_object.z)) * maxMotion;
#endif
                motion = motion % maxMotion;

                float2 uv;
#ifdef _ISFLUID_ON
                uv = float2(
                    float(vid) % _PosTexture_TexelSize.z * _PosTexture_TexelSize.x,
                    (int(float(vid) * _PosTexture_TexelSize.x) + 1.0f) * _PosTexture_TexelSize.y
                    );
#else
                uv = v.VertexUV;
#endif
                uv.y += _PosTexture_TexelSize.y * column * floor(motion);

                float4 tex = tex2Dlod(_PosTexture, float4(uv, 0, 0));
                float3 pos = float3(tex.r, tex.b, tex.g);
                half3 normal = NormalUnpack(tex.a);
                normal = normalize(half3(normal.x, normal.z, normal.y));
#ifdef _ISLERP_ON
    #ifdef _ISFLUID_ON
                uv.y = (int(float(vid) * _PosTexture_TexelSize.x) + 1.0f) * _PosTexture_TexelSize.y;
    #else
                uv.y = v.VertexUV.y;
    #endif
                uv.y += (motion >= maxMotion - 1.0f)
                    ? _PosTexture_TexelSize.y * column
                    : _PosTexture_TexelSize.y * column * ceil(motion);

                float4 tex2 = tex2Dlod(_PosTexture, float4(uv, 0, 0));
                float3 pos2 = float3(tex2.r, tex2.b, tex2.g);
                half3 normal2 = NormalUnpack(tex2.a);
                normal2 = normalize(half3(normal2.x, normal2.z, normal2.y));

                pos = lerp(pos, pos2, frac(motion));
                normal = lerp(normal, normal2, frac(motion));
#endif
                v2f o;
                UNITY_INITIALIZE_OUTPUT(v2f, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

                o.pos = UnityObjectToClipPos(float4(pos, v.vertex.w));
                o.normal = UnityObjectToWorldNormal(normalize(normal));
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                o.wpos = mul(unity_ObjectToWorld, float4(pos, v.vertex.w)).xyz;
                TRANSFER_SHADOW(o)
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                UNITY_LIGHT_ATTENUATION(attenuation, i, i.wpos);

                fixed4 texCol = tex2D(_MainTex, i.uv) * _Color;
                fixed4 shadowAtten = SHADOW_ATTENUATION(i);
                //clip(texCol.a - _Cutoff);
                return texCol * _LightColor0 * attenuation * shadowAtten;
            }
            ENDCG
        }

        Pass
        {
            Tags { "LightMode"="ShadowCaster" }

            CGPROGRAM
            #pragma multi_compile_shadowcaster
            
            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            v2f vert (appdata v, uint vid : SV_VertexID)
            {
                UNITY_SETUP_INSTANCE_ID(v);

                float4 param = tex2Dlod(_PosTexture, 0);
                int column, maxMotion;
                ShortUnpack(param.r, column, maxMotion);

                float motion;
#ifdef _TIMEMOTION_ON
                motion = _Time.y *_FPS;
#else
                motion = _Motion;
#endif
#ifdef _ISRAND_ON
                float4 wpos_object = mul(unity_ObjectToWorld, float4(0.0f, 0.0f, 0.0f, 1.0f));
                motion += rand(float2(rand(float2(wpos_object.x, wpos_object.y)), wpos_object.z)) * maxMotion;
#endif
                motion = motion % maxMotion;

                float2 uv;
#ifdef _ISFLUID_ON
                uv = float2(
                    float(vid) % _PosTexture_TexelSize.z * _PosTexture_TexelSize.x,
                    (int(float(vid) * _PosTexture_TexelSize.x) + 1.0f) * _PosTexture_TexelSize.y
                    );
#else
                uv = v.VertexUV;
#endif
                uv.y += _PosTexture_TexelSize.y * column * floor(motion);

                float4 tex = tex2Dlod(_PosTexture, float4(uv, 0, 0));
                float3 pos = float3(tex.r, tex.b, tex.g);
#ifdef _ISLERP_ON
    #ifdef _ISFLUID_ON
                uv.y = (int(float(vid) * _PosTexture_TexelSize.x) + 1.0f) * _PosTexture_TexelSize.y;
    #else
                uv.y = v.VertexUV.y;
    #endif
                uv.y += (motion >= maxMotion - 1.0f)
                    ? _PosTexture_TexelSize.y * column
                    : _PosTexture_TexelSize.y * column * ceil(motion);

                float4 tex2 = tex2Dlod(_PosTexture, float4(uv, 0, 0));
                float3 pos2 = float3(tex2.r, tex2.b, tex2.g);

                pos = lerp(pos, pos2, frac(motion));
#endif
                v2f o;
                UNITY_INITIALIZE_OUTPUT(v2f, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

                o.pos = UnityObjectToClipPos(float4(pos, v.vertex.w));
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                fixed4 color = tex2D(_MainTex, i.uv) * _Color;
                //clip(color.a - _Cutoff);
                return color;
            }
            ENDCG
        }
    }
}
