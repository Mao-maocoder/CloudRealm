// Adapted from Petalwake, Copyright (c) 2026 Jacob Miller, MIT.
// See public/PETALWAKE_LICENSE.txt; source commit 25443cef0eba802052d9ef24c94ba3c4157b6f2e.
import * as T from 'three';
export function makeWaveNormalTexture() {
  // tileable ripple field: slopes in RG, height in B, a second decorrelated height in A
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  let seed = 99;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const comps = [];
  for (let i = 0; i < 44; i++) {
    const kx = Math.round((rnd() * 2 - 1) * 20), ky = Math.round((rnd() * 2 - 1) * 20);
    const kk = Math.hypot(kx, ky);
    if (kk < 2) continue;
    comps.push({ kx, ky, a: Math.pow(kk, -1.55), p: rnd() * 6.283, g: i % 2 });
  }
  const H = new Float32Array(S * S), HX = new Float32Array(S * S), HY = new Float32Array(S * S), H2 = new Float32Array(S * S);
  const tau = (2 * Math.PI) / S;
  for (const c of comps) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const ph = (c.kx * x + c.ky * y) * tau + c.p;
      const s = Math.sin(ph), co = Math.cos(ph);
      const i = y * S + x;
      if (c.g === 0) { H[i] += c.a * s; HX[i] += c.a * c.kx * co; HY[i] += c.a * c.ky * co; }
      else H2[i] += c.a * s;
      if (c.g === 1) { HX[i] += 0.5 * c.a * c.kx * co; HY[i] += 0.5 * c.a * c.ky * co; }
    }
  }
  const norm = (a: Float32Array) => { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); return m || 1; };
  const mH = norm(H), mS = Math.max(norm(HX), norm(HY)), mH2 = norm(H2);
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = 127.5 + 127.5 * (HX[i] / mS);
    data[i * 4 + 1] = 127.5 + 127.5 * (HY[i] / mS);
    data[i * 4 + 2] = 127.5 + 127.5 * (H[i] / mH);
    data[i * 4 + 3] = 127.5 + 127.5 * (H2[i] / mH2);
  }
  const t = new T.DataTexture(data, S, S, T.RGBAFormat, T.UnsignedByteType);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = T.LinearMipmapLinearFilter;
  t.magFilter = T.LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

