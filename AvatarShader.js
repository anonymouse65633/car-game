/**
 * PART 5 — Avatar Customization
 * AvatarShader.js — Custom Three.js ShaderMaterial for tintable clothing.
 *
 * Each clothing mesh uses a base texture + a color-mask texture.
 * The mask uses RGB channels to define up to 3 independent colour zones:
 *   R channel → primary color (body)
 *   G channel → secondary color (trim/collar)
 *   B channel → tertiary color (accent/logo)
 * Unmasked pixels show the base texture colour unchanged.
 *
 * Usage:
 *   import { createClothingMaterial } from './AvatarShader.js';
 *   mesh.material = createClothingMaterial(baseTexture, maskTexture, THREE);
 *   material.uniforms.uColorPrimary.value.set('#E94560');
 */

// ── GLSL ─────────────────────────────────────────────────────────────────────

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uBaseMap;
  uniform sampler2D uMaskMap;
  uniform vec3  uColorPrimary;     // R channel zones
  uniform vec3  uColorSecondary;   // G channel zones
  uniform vec3  uColorAccent;      // B channel zones
  uniform float uMetallic;
  uniform float uRoughness;
  uniform vec3  uLightDir;
  uniform vec3  uLightColor;
  uniform vec3  uAmbient;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    vec4 base = texture2D(uBaseMap, vUv);
    vec4 mask = texture2D(uMaskMap, vUv);

    // Blend colour zones by mask channel intensity
    vec3 tinted = base.rgb;
    tinted = mix(tinted, uColorPrimary   * base.rgb, mask.r);
    tinted = mix(tinted, uColorSecondary * base.rgb, mask.g);
    tinted = mix(tinted, uColorAccent    * base.rgb, mask.b);

    // Simple Lambertian + ambient lighting
    float NdotL = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0);
    vec3 diffuse  = tinted * uLightColor * NdotL;
    vec3 ambient  = tinted * uAmbient;

    // Micro specular for metallic areas
    vec3 viewDir  = normalize(cameraPosition - vWorldPos);
    vec3 halfVec  = normalize(normalize(uLightDir) + viewDir);
    float spec    = pow(max(dot(normalize(vNormal), halfVec), 0.0), 32.0 * (1.0 - uRoughness));
    float metalMask = uMetallic * (mask.r * 0.4 + mask.g * 0.3 + mask.b * 0.3);
    vec3 specular = uLightColor * spec * metalMask;

    gl_FragColor = vec4(ambient + diffuse + specular, base.a);
  }
`;

// ── Skin shader ───────────────────────────────────────────────────────────────

const SKIN_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const SKIN_FRAG = /* glsl */ `
  uniform sampler2D uBaseMap;   // base skin detail texture (wrinkles, pores)
  uniform vec3  uSkinColor;
  uniform vec3  uLightDir;
  uniform vec3  uLightColor;
  uniform vec3  uAmbient;
  uniform float uSubsurface;   // SSS approximation intensity

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    vec4 base = texture2D(uBaseMap, vUv);

    // Blend skin color with detail texture
    vec3 skinCol = uSkinColor * (base.rgb * 1.4 + 0.2);

    float NdotL = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0);

    // Subsurface scatter approximation: warm back-lit glow
    float sssWrap  = max(dot(normalize(vNormal), -normalize(uLightDir)) * 0.5 + 0.5, 0.0);
    vec3  sssColor = skinCol * uSubsurface * sssWrap * vec3(1.0, 0.5, 0.3);

    vec3 diffuse = skinCol * uLightColor * NdotL;
    vec3 ambient = skinCol * uAmbient;

    gl_FragColor = vec4(ambient + diffuse + sssColor, 1.0);
  }
`;

// ── Factory functions ─────────────────────────────────────────────────────────

/**
 * Create a tintable clothing material.
 * @param {THREE.Texture} baseTexture
 * @param {THREE.Texture} maskTexture
 * @param {THREE}         THREE
 * @returns {THREE.ShaderMaterial}
 */
export function createClothingMaterial(baseTexture, maskTexture, THREE) {
  return new THREE.ShaderMaterial({
    vertexShader:   VERT,
    fragmentShader: FRAG,
    uniforms: {
      uBaseMap:        { value: baseTexture },
      uMaskMap:        { value: maskTexture },
      uColorPrimary:   { value: new THREE.Color('#888888') },
      uColorSecondary: { value: new THREE.Color('#444444') },
      uColorAccent:    { value: new THREE.Color('#E94560') },
      uMetallic:       { value: 0.1 },
      uRoughness:      { value: 0.7 },
      uLightDir:       { value: new THREE.Vector3(1, 2, 1).normalize() },
      uLightColor:     { value: new THREE.Color('#ffffff').multiplyScalar(0.9) },
      uAmbient:        { value: new THREE.Color('#ffffff').multiplyScalar(0.25) },
    },
    transparent: false,
    side: THREE.FrontSide,
  });
}

/**
 * Create the skin material.
 * @param {THREE.Texture} detailTexture  Tileable pore/wrinkle map (greyscale)
 * @param {string}        skinHex        Initial skin hex color
 * @param {THREE}         THREE
 * @returns {THREE.ShaderMaterial}
 */
export function createSkinMaterial(detailTexture, skinHex, THREE) {
  return new THREE.ShaderMaterial({
    vertexShader:   SKIN_VERT,
    fragmentShader: SKIN_FRAG,
    uniforms: {
      uBaseMap:   { value: detailTexture },
      uSkinColor: { value: new THREE.Color(skinHex ?? '#D4956A') },
      uLightDir:  { value: new THREE.Vector3(1, 2, 1).normalize() },
      uLightColor:{ value: new THREE.Color('#ffffff').multiplyScalar(0.85) },
      uAmbient:   { value: new THREE.Color('#ffffff').multiplyScalar(0.3) },
      uSubsurface:{ value: 0.35 },
    },
    transparent: false,
    side: THREE.FrontSide,
  });
}

/**
 * Update a clothing material's colour zone from a hex string.
 * zone: 'primary' | 'secondary' | 'accent'
 */
export function setMaterialColor(material, zone, hexColor, THREE) {
  const zoneMap = {
    primary:   'uColorPrimary',
    secondary: 'uColorSecondary',
    accent:    'uColorAccent',
  };
  const uniform = zoneMap[zone];
  if (uniform && material.uniforms[uniform]) {
    material.uniforms[uniform].value.set(hexColor);
  }
}
