/* Generates the production mcstructure. Requires prismarine-nbt at build time only. */
const fs = require("fs");
const path = require("path");
const nbt = require("prismarine-nbt");

const SIZE = [63, 32, 63];
const [SX, SY, SZ] = SIZE;
const C = 31;
const VERSION = 18168865;
const paletteNames = [
  "minecraft:air",
  "minecraft:polished_blackstone_bricks",
  "minecraft:cracked_polished_blackstone_bricks",
  "minecraft:chiseled_polished_blackstone",
  "minecraft:smooth_quartz",
  "minecraft:gold_block",
  "minecraft:sea_lantern",
  "minecraft:red_nether_brick",
  "minecraft:iron_bars",
  "minecraft:obsidian",
  "minecraft:crying_obsidian",
  "minecraft:chest",
  "minecraft:blackstone",
  "minecraft:polished_basalt",
];
const P = Object.fromEntries(paletteNames.map((name, index) => [name.slice(10), index]));
const blocks = new Int32Array(SX * SY * SZ);
const positionData = {};
const index = (x, y, z) => x * SY * SZ + y * SZ + z;
const set = (x, y, z, block) => {
  if (x >= 0 && x < SX && y >= 0 && y < SY && z >= 0 && z < SZ) blocks[index(x, y, z)] = block;
};
const dist = (x, z) => Math.hypot(x - C, z - C);
const entrance = (x, z) => Math.abs(x - C) <= 3 || Math.abs(z - C) <= 3;

// Foundation and underground shell.
for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) {
  const r = dist(x, z);
  if (r <= 30.5) set(x, 0, z, P.blackstone);
  for (let y = 1; y <= 9; y++) {
    if (r >= 28.2 && r <= 30.5) set(x, y, z, entrance(x, z) && y <= 5 ? P.air : P.polished_blackstone_bricks);
    if (r <= 27.8 && y === 1) set(x, y, z, P.polished_blackstone_bricks);
  }
}

// Underground ring tunnel and four radial access tunnels.
for (let x = 2; x < 61; x++) for (let z = 2; z < 61; z++) {
  const r = dist(x, z);
  const tunnel = (r >= 20 && r <= 24) || Math.abs(x - C) <= 2 || Math.abs(z - C) <= 2;
  if (!tunnel) continue;
  for (let y = 2; y <= 7; y++) set(x, y, z, P.air);
  set(x, 2, z, (x + z) % 9 === 0 ? P.chiseled_polished_blackstone : P.polished_blackstone_bricks);
  if ((x + z) % 13 === 0) set(x, 7, z, P.sea_lantern);
}

// Central underground boss vault.
for (let x = C - 9; x <= C + 9; x++) for (let z = C - 9; z <= C + 9; z++) {
  const r = dist(x, z);
  if (r <= 9) {
    set(x, 2, z, r > 7.5 ? P.crying_obsidian : P.obsidian);
    for (let y = 3; y <= 8; y++) set(x, y, z, r > 7.5 ? P.polished_blackstone_bricks : P.air);
    if (r > 7.5) set(x, 9, z, P.chiseled_polished_blackstone);
  }
}

// Four treasure rooms hidden off the ring tunnel.
const rooms = [[14,14], [48,14], [14,48], [48,48]];
for (const [cx, cz] of rooms) {
  for (let x = cx - 4; x <= cx + 4; x++) for (let z = cz - 4; z <= cz + 4; z++) {
    for (let y = 2; y <= 7; y++) {
      const edge = x === cx - 4 || x === cx + 4 || z === cz - 4 || z === cz + 4;
      set(x, y, z, edge ? P.red_nether_brick : P.air);
    }
    set(x, 2, z, (x + z) % 5 === 0 ? P.gold_block : P.polished_blackstone_bricks);
    set(x, 7, z, (x === cx && z === cz) ? P.sea_lantern : P.polished_blackstone_bricks);
  }
  set(cx, 3, cz, P.chest);
  const i = index(cx, 3, cz);
  positionData[String(i)] = {
    type: "compound",
    value: { block_entity_data: { type: "compound", value: {
      id: { type: "string", value: "Chest" },
      isMovable: { type: "byte", value: 1 },
      x: { type: "int", value: cx }, y: { type: "int", value: 3 }, z: { type: "int", value: cz },
      LootTable: { type: "string", value: "loot_tables/chests/marvel_arena.json" },
      LootTableSeed: { type: "long", value: [0, 0] }
    } } }
  };
}

// Arena floor, central dais, and Marvel gold/black motif.
for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) {
  const r = dist(x, z);
  if (r <= 30.5) set(x, 10, z, r <= 20 ? P.smooth_quartz : P.polished_blackstone_bricks);
  if (r <= 7) set(x, 11, z, r >= 5.5 ? P.gold_block : P.obsidian);
  if ((Math.abs(x - C) <= 1 || Math.abs(z - C) <= 1) && r <= 19) set(x, 10, z, P.gold_block);
}

// Tiered circular spectator stands and high colonnade.
for (let x = 0; x < SX; x++) for (let z = 0; z < SZ; z++) {
  const r = dist(x, z);
  for (let tier = 0; tier < 5; tier++) {
    if (r >= 21 + tier * 1.7 && r < 22.8 + tier * 1.7) {
      for (let y = 11; y <= 11 + tier; y++) set(x, y, z, tier % 2 ? P.cracked_polished_blackstone_bricks : P.polished_blackstone_bricks);
    }
  }
  if (r >= 29.2 && r <= 30.5 && !entrance(x, z)) {
    for (let y = 11; y <= 26; y++) set(x, y, z, y % 5 === 0 ? P.chiseled_polished_blackstone : P.polished_blackstone_bricks);
  }
}

// Pillars, arches, lights, and four grand entrances.
for (let n = 0; n < 24; n++) {
  const a = n * Math.PI * 2 / 24;
  const x = Math.round(C + Math.cos(a) * 27.5);
  const z = Math.round(C + Math.sin(a) * 27.5);
  for (let y = 12; y <= 25; y++) set(x, y, z, y === 12 || y === 25 ? P.gold_block : P.polished_basalt);
  set(x, 26, z, P.sea_lantern);
}
for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
  for (let depth = 20; depth <= 31; depth++) for (let side = -3; side <= 3; side++) {
    const x = C + dx * depth + dz * side;
    const z = C + dz * depth + dx * side;
    for (let y = 11; y <= 17; y++) set(x, y, z, P.air);
    set(x, 10, z, P.red_nether_brick);
    if (Math.abs(side) === 3) for (let y = 11; y <= 18; y++) set(x, y, z, y === 18 ? P.gold_block : P.polished_blackstone_bricks);
  }
}

const blockPalette = paletteNames.map(name => ({
  name: { type: "string", value: name },
  states: { type: "compound", value: {} },
  version: { type: "int", value: VERSION }
}));
const root = { type: "compound", name: "", value: {
  format_version: { type: "int", value: 1 },
  size: { type: "list", value: { type: "int", value: SIZE } },
  structure: { type: "compound", value: {
    block_indices: { type: "list", value: { type: "list", value: [
      { type: "int", value: Array.from(blocks) },
      { type: "int", value: new Array(blocks.length).fill(-1) }
    ] } },
    entities: { type: "list", value: { type: "compound", value: [] } },
    palette: { type: "compound", value: { default: { type: "compound", value: {
      block_palette: { type: "list", value: { type: "compound", value: blockPalette } },
      block_position_data: { type: "compound", value: positionData }
    } } } }
  } },
  structure_world_origin: { type: "list", value: { type: "int", value: [0, 0, 0] } }
} };

const output = path.resolve(__dirname, "../behavior_packs/Chim_Marvel_Weapons_BP/structures/chim_marvel_arena/structure.mcstructure");
fs.writeFileSync(output, nbt.writeUncompressed(root, "little"));
console.log(`Generated ${SIZE.join("x")} arena at ${output}`);
