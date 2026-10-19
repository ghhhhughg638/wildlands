/* Deterministic procedural world. All coordinates are in meters (approx.).
 * Babylon.js is loaded globally from the official CDN in index.html.
 */
const B = globalThis.BABYLON;
export const CHUNK_SIZE = 88;
export const WATER_LEVEL = 1.5;
const SEED = 731982;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
function hash(x, z) {
  let n = Math.imul(x ^ 0x27d4eb2d, 374761393) + Math.imul(z, 668265263) + SEED;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function noise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = smooth(x - ix), fz = smooth(z - iz);
  return lerp(lerp(hash(ix, iz), hash(ix + 1, iz), fx), lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), fx), fz);
}
function fbm(x, z, octaves = 4) {
  let sum = 0, amplitude = .5, frequency = 1, normalization = 0;
  for (let k = 0; k < octaves; k++) { sum += amplitude * noise(x * frequency, z * frequency); normalization += amplitude; amplitude *= .49; frequency *= 2.02; }
  return sum / normalization;
}
export function heightAt(x, z) {
  const rolling = fbm(x * .009 + 18.1, z * .009 - 8.1, 5);
  const rugged = fbm(x * .0028 - 12, z * .0028 + 18, 4);
  const detail = fbm(x * .047, z * .047, 3);
  const mountain = Math.pow(clamp((rugged - .42) * 2.55, 0, 1), 2);
  const spawnFlatten = clamp((Math.hypot(x, z) - 12) / 45, 0, 1);
  return 5.1 + (rolling - .48) * (11 + spawnFlatten * 14) + mountain * 57 * spawnFlatten + (detail - .5) * 3 * spawnFlatten;
}
function slopeAt(x, z) { return Math.hypot(heightAt(x + 2, z) - heightAt(x - 2, z), heightAt(x, z + 2) - heightAt(x, z - 2)) / 4; }
function seededRandom(a, b) {
  let seed = (Math.imul(a + 4001, 16807) ^ Math.imul(b + 9001, 48271) ^ SEED) | 0;
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
}
export function regionAt(x, z) {
  const h = heightAt(x, z), s = slopeAt(x, z);
  if (h < WATER_LEVEL + 2.3) return '琉璃湖畔';
  if (h > 36) return '苍岚山脊';
  if (h > 22 || s > .85) return '云杉高地';
  if (fbm(x * .013, z * .013) > .54) return '雾杉林';
  return '晨风草原';
}
function color(r, g, b, alpha = 1) { return new B.Color4(r, g, b, alpha); }
function grassColor(h, slope, variance) {
  if (h < WATER_LEVEL + 2) return color(.54 + variance, .64 + variance, .45 + variance);
  if (h > 43) return color(.66 + variance, .69 + variance, .65 + variance);
  if (slope > 1.2) return color(.47 + variance, .50 + variance, .44 + variance);
  if (h > 24) return color(.43 + variance, .58 + variance, .42 + variance);
  return color(.33 + variance, .55 + variance, .35 + variance);
}
export class World {
  constructor(scene, mobile) {
    this.scene = scene;
    this.mobile = mobile;
    this.range = mobile ? 1 : 2;
    this.chunks = new Map();
    this.pending = [];
    this.collectibleMeshes = [];
    this.colliders = new Map();
    this.taken = new Set();
    try { this.taken = new Set(JSON.parse(localStorage.getItem('wildlands-gathered-v2') || '[]')); } catch (_) {}
    this.totalCollected = this.taken.size;
    this.createMaterials();
    this.createSources();
    this.createWater();
  }
  createMaterials() {
    const standard = (name, hex) => { const m = new B.StandardMaterial(name, this.scene); m.diffuseColor = B.Color3.FromHexString(hex); m.specularColor = new B.Color3(.055, .065, .05); return m; };
    this.terrainMat = standard('terrain-vertex-colors', '#ffffff');
    this.terrainMat.useVertexColors = true;
    this.pineMat = standard('deep-pine', '#467c64');
    this.pineTopMat = standard('pine-tops', '#72a67d');
    this.oakMat = standard('oak-leaves', '#7ca66f');
    this.trunkMat = standard('warm-bark', '#645746');
    this.stoneMat = standard('scattered-stone', '#879994');
    this.crystalMat = standard('luminous-crystal', '#b5f0e1');
    this.crystalMat.emissiveColor = new B.Color3(.12, .34, .34);
  }
  createSources() {
    const scene = this.scene;
    const trunk = B.MeshBuilder.CreateCylinder('tree-source-trunk', {height: 3.5, diameterTop: .25, diameterBottom: .7, tessellation: 5}, scene);
    const pine = B.MeshBuilder.CreateCylinder('tree-source-pine', {height: 6.4, diameterTop: 0, diameterBottom: 4.2, tessellation: 6}, scene);
    const pineTop = B.MeshBuilder.CreateCylinder('tree-source-pine-top', {height: 4.6, diameterTop: 0, diameterBottom: 3.0, tessellation: 6}, scene);
    const oak = B.MeshBuilder.CreateSphere('tree-source-oak', {diameter: 4.8, segments: 4}, scene);
    const rock = B.MeshBuilder.CreateSphere('rock-source', {diameter: 1.8, segments: 2}, scene);
    trunk.material = this.trunkMat; pine.material = this.pineMat; pineTop.material = this.pineTopMat; oak.material = this.oakMat; rock.material = this.stoneMat;
    this.sources = {trunk, pine, pineTop, oak, rock};
    // Put prototype meshes well outside the visible world, while their instances retain independent transforms.
    for (const mesh of Object.values(this.sources)) mesh.position.y = -5000;
  }
  createWater() {
    this.water = B.MeshBuilder.CreateGround('lake-surface', {width: 1900, height: 1900, subdivisions: 1}, this.scene);
    const m = new B.StandardMaterial('lake-mat', this.scene);
    m.diffuseColor = new B.Color3(.39, .67, .72);
    m.emissiveColor = new B.Color3(.04, .11, .13);
    m.alpha = .77; m.specularPower = 64; m.backFaceCulling = false;
    this.water.material = m; this.water.position.y = WATER_LEVEL;
    this.water.isPickable = false;
  }
  createGround(cx, cz) {
    const steps = this.mobile ? 18 : 23, N = steps + 1;
    const positions = [], indices = [], normals = [], colors = [];
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
    for (let z = 0; z <= steps; z++) for (let x = 0; x <= steps; x++) {
      const wx = x0 + x * CHUNK_SIZE / steps, wz = z0 + z * CHUNK_SIZE / steps;
      const h = heightAt(wx, wz), s = slopeAt(wx, wz), variance = (noise(wx * .08, wz * .08) - .5) * .07;
      positions.push(wx, h, wz);
      const c = grassColor(h, s, variance); colors.push(c.r, c.g, c.b, c.a);
    }
    for (let z = 0; z < steps; z++) for (let x = 0; x < steps; x++) {
      const a = z * N + x, b = a + 1, c = a + N, d = c + 1;
      // Babylon's default front-face winding, viewed from above.
      indices.push(a, c, b, b, c, d);
    }
    B.VertexData.ComputeNormals(positions, indices, normals);
    const mesh = new B.Mesh(`land-${cx},${cz}`, this.scene);
    const data = new B.VertexData();
    data.positions = positions; data.indices = indices; data.normals = normals; data.colors = colors;
    data.applyToMesh(mesh);
    mesh.material = this.terrainMat;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    return mesh;
  }
  populate(cx, cz, chunk) {
    const rand = seededRandom(cx, cz), instances = chunk.instances, collectibles = chunk.collectibles;
    const baseX = cx * CHUNK_SIZE, baseZ = cz * CHUNK_SIZE;
    const place = (source, id, x, y, z, sx, sy, sz, yaw = 0) => {
      const m = source.createInstance(`${id}-${cx},${cz}-${instances.length}`);
      m.position.set(x, y, z); m.scaling.set(sx, sy, sz); m.rotation.y = yaw;
      m.isPickable = false; instances.push(m); return m;
    };
    for (let i = 0; i < (this.mobile ? 14 : 24); i++) {
      const x = baseX + rand() * CHUNK_SIZE, z = baseZ + rand() * CHUNK_SIZE, h = heightAt(x, z), s = slopeAt(x, z);
      if (h < WATER_LEVEL + 1.4 || h > 46 || s > .82 || Math.hypot(x, z) < 20) continue;
      const size = .66 + rand() * .75, yaw = rand() * TAU;
      place(this.sources.trunk, 'trunk', x, h + 1.75 * size, z, size, size, size, yaw);
      if (rand() < (h > 22 ? .86 : .62)) {
        place(this.sources.pine, 'pine', x, h + 5.4 * size, z, size, size, size, yaw);
        place(this.sources.pineTop, 'pine-top', x, h + 7.8 * size, z, size, size, size, yaw + .2);
      } else {
        place(this.sources.oak, 'oak', x, h + 4.5 * size, z, 1.2 * size, .95 * size, 1.2 * size, yaw);
      }
      chunk.colliders.push({x, z, r: .55 * size});
    }
    for (let i = 0; i < (this.mobile ? 8 : 12); i++) {
      const x = baseX + rand() * CHUNK_SIZE, z = baseZ + rand() * CHUNK_SIZE, h = heightAt(x, z);
      if (h < WATER_LEVEL - 1 || Math.hypot(x, z) < 12) continue;
      const size = .3 + rand() * .9;
      place(this.sources.rock, 'rock', x, h + .45 * size, z, size * 1.2, size * .55, size * .9, rand() * TAU);
    }
    for (let i = 0; i < 3; i++) {
      const x = baseX + 8 + rand() * (CHUNK_SIZE - 16), z = baseZ + 8 + rand() * (CHUNK_SIZE - 16), h = heightAt(x, z);
      if (h < WATER_LEVEL + 1.0 || slopeAt(x, z) > .85) continue;
      const id = `${cx},${cz}:${i}`;
      if (this.taken.has(id)) continue;
      const gem = B.MeshBuilder.CreatePolyhedron(`gem-${id}`, {type: 1, size: .75}, this.scene);
      gem.material = this.crystalMat; gem.position.set(x, h + 1, z);
      gem.rotation.set(rand() * .4, rand() * TAU, rand() * .4);
      gem.isPickable = false;
      gem.metadata = {id, chunkKey: `${cx},${cz}`, baseY: h + 1};
      collectibles.push(gem); this.collectibleMeshes.push(gem);
    }
  }
  createChunk(cx, cz) {
    const key = `${cx},${cz}`; if (this.chunks.has(key)) return;
    const chunk = {key, ground: this.createGround(cx, cz), instances: [], collectibles: [], colliders: []};
    this.chunks.set(key, chunk); this.populate(cx, cz, chunk);
  }
  removeChunk(key) {
    const chunk = this.chunks.get(key); if (!chunk) return;
    chunk.ground.dispose();
    for (const m of chunk.instances) m.dispose();
    for (const m of chunk.collectibles) { const index = this.collectibleMeshes.indexOf(m); if (index !== -1) this.collectibleMeshes.splice(index, 1); m.dispose(); }
    this.chunks.delete(key);
  }
  update(x, z, maxBuild = 2) {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const want = [];
    for (let dz = -this.range; dz <= this.range; dz++) for (let dx = -this.range; dx <= this.range; dx++) {
      if (dx * dx + dz * dz <= (this.range + .34) ** 2) want.push({x: cx + dx, z: cz + dz, d: dx * dx + dz * dz});
    }
    want.sort((a, b) => a.d - b.d);
    const required = new Set(want.map(c => `${c.x},${c.z}`));
    for (const key of this.chunks.keys()) if (!required.has(key)) this.removeChunk(key);
    let made = 0;
    for (const p of want) if (!this.chunks.has(`${p.x},${p.z}`) && made < maxBuild) { this.createChunk(p.x, p.z); made++; }
    this.water.position.x = x; this.water.position.z = z;
    return this.chunks.size;
  }
  collides(x, z, radius = .55) {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const chunk = this.chunks.get(`${cx + dx},${cz + dz}`); if (!chunk) continue;
      for (const c of chunk.colliders) if ((x-c.x) ** 2 + (z-c.z) ** 2 < (radius + c.r) ** 2) return true;
    }
    return false;
  }
  nearestGem(x, y, z, reach = 3.7) {
    let result = null, nearest = reach * reach;
    for (const gem of this.collectibleMeshes) {
      const d = (gem.position.x-x) ** 2 + (gem.position.y-y-1) ** 2 + (gem.position.z-z) ** 2;
      if (d < nearest) { nearest = d; result = gem; }
    }
    return result;
  }
  gather(gem) {
    if (!gem) return false;
    const {id, chunkKey} = gem.metadata;
    if (this.taken.has(id)) return false;
    this.taken.add(id); this.totalCollected = this.taken.size;
    try { localStorage.setItem('wildlands-gathered-v2', JSON.stringify([...this.taken])); } catch (_) {}
    const chunk = this.chunks.get(chunkKey);
    if (chunk) chunk.collectibles = chunk.collectibles.filter(m => m !== gem);
    this.collectibleMeshes = this.collectibleMeshes.filter(m => m !== gem);
    gem.dispose();
    return true;
  }
  animateGems(t) {
    for (const gem of this.collectibleMeshes) {
      gem.position.y = gem.metadata.baseY + Math.sin(t * 2.1 + gem.position.x) * .20;
      gem.rotation.y += .006;
    }
  }
}