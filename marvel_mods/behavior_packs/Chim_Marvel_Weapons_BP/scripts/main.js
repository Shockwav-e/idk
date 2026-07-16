import { world, system, ItemStack, EquipmentSlot } from "@minecraft/server";

const NS = "chim_marvel";
const activeThrows = new Map();
const projectileStats = new Map();
const bossTimers = new Map();
const heldWeaponByPlayer = new Map();
const weaponCooldowns = new Map();
const arenaOrigins = new Map(); // bossId -> {x, y, z} spawn center
const ARENA_RADIUS = 20;
const THROW_DAMAGE = {
  [`${NS}:mjolnir_projectile`]: 45,
  [`${NS}:stormbreaker_projectile`]: 65,
  [`${NS}:shield_projectile`]: 32,
  [`${NS}:gungnir_bolt`]: 50,
  [`${NS}:cat_bolt`]: 18,
};
const WEAPON_HELP = {
  [`${NS}:mjolnir`]:
    "§bMjolnir §7— Use: throw (2.5s) | Sneak + use: lightning (3s)",
  [`${NS}:stormbreaker`]:
    "§3Stormbreaker §7— Use: throw | Sneak + use: thunder (3s)",
  [`${NS}:captain_shield`]:
    "§9Captain's Shield §7— Offhand: block | Use: ricochet (2s)",
  [`${NS}:gungnir`]: "§6Gungnir §7— Use: straight 50-damage energy bolt (2s)",
};
const HOLD_BUFFS = {
  [`${NS}:mjolnir`]: [
    { id: "strength", amplifier: 1 },
    { id: "resistance", amplifier: 2 },
    { id: "health_boost", amplifier: 3 },
  ],
  [`${NS}:stormbreaker`]: [
    { id: "strength", amplifier: 2 },
    { id: "resistance", amplifier: 2 },
    { id: "slow_falling", amplifier: 0 },
  ],
  [`${NS}:captain_shield`]: [
    { id: "resistance", amplifier: 3 },
    { id: "fire_resistance", amplifier: 0 },
    { id: "absorption", amplifier: 1 },
  ],
  [`${NS}:gungnir`]: [
    { id: "speed", amplifier: 1 },
    { id: "fire_resistance", amplifier: 0 },
    { id: "night_vision", amplifier: 0 },
  ],
};
const COOLDOWN_TICKS = {
  mjolnir_throw: 50,
  mjolnir_lightning: 60,
  stormbreaker_throw: 60,
  stormbreaker_lightning: 60,
  shield_throw: 40,
  gungnir_bolt: 40,
};
let thunderResetRun = 0;

const length = (v) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
const normalize = (v) => {
  const n = length(v) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
};
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const distance = (a, b) => length(subtract(a, b));
const valid = (entity) => {
  try {
    return entity?.isValid === true;
  } catch {
    return false;
  }
};

function tell(player, text) {
  try {
    player.sendMessage(text);
  } catch {}
}

function tryWeaponCooldown(player, attack) {
  const key = `${player.id}:${attack}`;
  const readyAt = weaponCooldowns.get(key) ?? 0;
  const remaining = readyAt - system.currentTick;
  if (remaining > 0) {
    player.onScreenDisplay.setActionBar(
      `§cAbility cooling down: §f${(remaining / 20).toFixed(1)}s`,
    );
    return false;
  }
  weaponCooldowns.set(key, system.currentTick + COOLDOWN_TICKS[attack]);
  return true;
}

function readEnchantments(itemStack) {
  const stats = {
    damageBonus: 0,
    knockback: 0,
    fire: 0,
    loyalty: 0,
    channeling: false,
  };
  try {
    const component = itemStack?.getComponent("minecraft:enchantable");
    for (const enchantment of component?.getEnchantments() ?? []) {
      const id = enchantment.type.id.replace("minecraft:", "");
      const level = enchantment.level;
      if (id === "sharpness") stats.damageBonus += 1 + level * 1.25;
      if (id === "smite" || id === "bane_of_arthropods")
        stats.damageBonus += level * 1.5;
      if (id === "impaling") stats.damageBonus += level * 2.5;
      if (id === "power") stats.damageBonus += level * 1.75;
      if (id === "knockback" || id === "punch")
        stats.knockback = Math.max(stats.knockback, level);
      if (id === "fire_aspect" || id === "flame")
        stats.fire = Math.max(stats.fire, level);
      if (id === "loyalty") stats.loyalty = level;
      if (id === "channeling") stats.channeling = true;
    }
  } catch {}
  return stats;
}

function beginThunder(player, power) {
  const dim = player.dimension;
  let target;
  let targetEntity;
  try {
    const hits = player.getEntitiesFromViewDirection({ maxDistance: 48 });
    targetEntity = hits.find(
      (hit) => hit.entity?.typeId !== "minecraft:item",
    )?.entity;
    target = targetEntity?.location;
  } catch {}
  if (!target) {
    try {
      target = player.getBlockFromViewDirection({ maxDistance: 48 })?.block
        ?.location;
    } catch {}
  }
  if (!target) {
    const eye = player.getHeadLocation();
    const view = player.getViewDirection();
    target = {
      x: eye.x + view.x * 28,
      y: eye.y + view.y * 28,
      z: eye.z + view.z * 28,
    };
  }
  try {
    dim.runCommand("weather thunder 30");
    dim.spawnEntity("minecraft:lightning_bolt", target);
    if (valid(targetEntity)) {
      try {
        targetEntity.applyDamage(power === "stormbreaker" ? 80 : 55);
      } catch {}
    }
    if (power === "stormbreaker") {
      system.runTimeout(() => {
        try {
          dim.spawnEntity("minecraft:lightning_bolt", target);
        } catch {}
      }, 5);
    }
    dim.runCommand(
      `playsound item.trident.thunder @a ${target.x} ${target.y} ${target.z} 1.5 0.8`,
    );
    player.onScreenDisplay.setActionBar(
      power === "stormbreaker"
        ? "§3Stormbreaker thunder: §c80 damage"
        : "§bMjolnir thunder: §c55 damage",
    );
  } catch {}
  if (thunderResetRun) system.clearRun(thunderResetRun);
  thunderResetRun = system.runTimeout(() => {
    try {
      world.getDimension("overworld").runCommand("weather clear");
    } catch {}
    thunderResetRun = 0;
  }, 600);
}

function launch(player, type, itemStack) {
  const ids = {
    mjolnir: `${NS}:mjolnir_projectile`,
    stormbreaker: `${NS}:stormbreaker_projectile`,
    shield: `${NS}:shield_projectile`,
    gungnir: `${NS}:gungnir_bolt`,
  };
  const speeds = { mjolnir: 1.9, stormbreaker: 2.1, shield: 2.2, gungnir: 3.6 };
  const head = player.getHeadLocation();
  const view = player.getViewDirection();
  const start = {
    x: head.x + view.x * 1.2,
    y: head.y + view.y * 1.2,
    z: head.z + view.z * 1.2,
  };
  try {
    const projectile = player.dimension.spawnEntity(ids[type], start);
    const component = projectile.getComponent("minecraft:projectile");
    component.owner = player;
    const speed = speeds[type];
    component.shoot(
      { x: view.x * speed, y: view.y * speed, z: view.z * speed },
      { uncertainty: 0 },
    );
    const stats = readEnchantments(itemStack);
    projectileStats.set(projectile.id, stats);
    if (type !== "gungnir") {
      activeThrows.set(projectile.id, {
        projectile,
        owner: player,
        type,
        age: 0,
        returning: false,
        hits: new Set(),
        loyalty: stats.loyalty,
      });
    }
    const damage = THROW_DAMAGE[projectile.typeId] ?? 0;
    player.onScreenDisplay.setActionBar(
      type === "gungnir"
        ? `§6Gungnir fired an energy bolt §7— §c${damage} damage §8(staff stays in hand)`
        : `§f${type === "shield" ? "Shield" : type[0].toUpperCase() + type.slice(1)} thrown §7— §c${damage} damage`,
    );
    if (type === "gungnir") {
      try {
        player.dimension.playSound(
          "mob.evocation_illager.cast_spell",
          player.location,
          { volume: 1, pitch: 1.6 },
        );
      } catch {}
    }
  } catch (error) {
    tell(player, `§cWeapon failed to launch: ${error}`);
  }
}

function useWeapon(event) {
  const player = event.source;
  const id = event.itemStack?.typeId;
  if (!player || !id) return;
  if (id === `${NS}:mjolnir`) {
    const attack = player.isSneaking ? "mjolnir_lightning" : "mjolnir_throw";
    if (!tryWeaponCooldown(player, attack)) return;
    if (player.isSneaking) beginThunder(player, "mjolnir");
    else launch(player, "mjolnir", event.itemStack);
  } else if (id === `${NS}:stormbreaker`) {
    const attack = player.isSneaking
      ? "stormbreaker_lightning"
      : "stormbreaker_throw";
    if (!tryWeaponCooldown(player, attack)) return;
    if (player.isSneaking) beginThunder(player, "stormbreaker");
    else launch(player, "stormbreaker", event.itemStack);
  } else if (id === `${NS}:captain_shield`) {
    if (!tryWeaponCooldown(player, "shield_throw")) return;
    launch(player, "shield", event.itemStack);
  } else if (id === `${NS}:gungnir`) {
    if (!tryWeaponCooldown(player, "gungnir_bolt")) return;
    // Clear any lingering thunder weather before Gungnir fires
    try {
      world.getDimension("overworld").runCommand("weather clear");
    } catch {}
    launch(player, "gungnir", event.itemStack);
  }
}

world.afterEvents.itemUse.subscribe(useWeapon);

function nextShieldTarget(state, origin) {
  try {
    return state.owner.dimension
      .getEntities({
        location: origin,
        maxDistance: 20,
        families: ["monster"],
        excludeTypes: [`${NS}:shield_projectile`],
      })
      .filter((e) => valid(e) && !state.hits.has(e.id))
      .sort(
        (a, b) => distance(a.location, origin) - distance(b.location, origin),
      )[0];
  } catch {
    return undefined;
  }
}

world.afterEvents.projectileHitEntity.subscribe((event) => {
  const state = activeThrows.get(event.projectile?.id);
  const hit = event.getEntityHit()?.entity;
  const stats = projectileStats.get(event.projectile?.id);
  if (hit) {
    try {
      const baseDamage = THROW_DAMAGE[event.projectile.typeId] ?? 0;
      const totalDamage = baseDamage + (stats?.damageBonus ?? 0);
      const owner =
        state?.owner ??
        event.projectile.getComponent("minecraft:projectile")?.owner;
      if (totalDamage > 0) {
        try {
          if (valid(owner))
            hit.applyDamage(totalDamage, {
              damagingEntity: owner,
              damagingProjectile: event.projectile,
            });
          else hit.applyDamage(totalDamage);
        } catch {
          hit.applyDamage(totalDamage);
        }
      }
      if ((stats?.fire ?? 0) > 0) hit.setOnFire(stats.fire * 4, true);
      if ((stats?.knockback ?? 0) > 0) {
        const push = normalize(
          subtract(hit.location, event.projectile.location),
        );
        hit.applyKnockback(
          {
            x: push.x * stats.knockback * 0.7,
            z: push.z * stats.knockback * 0.7,
          },
          0.18 * stats.knockback,
        );
      }
      if (stats?.channeling)
        hit.dimension.spawnEntity("minecraft:lightning_bolt", hit.location);
    } catch {}
  }
  if (!state) {
    projectileStats.delete(event.projectile?.id);
    return;
  }
  if (hit) state.hits.add(hit.id);
  if (state.type === "shield" && state.hits.size < 3) {
    const next = nextShieldTarget(state, event.projectile.location);
    if (next) {
      try {
        const aim = normalize(
          subtract(
            {
              x: next.location.x,
              y: next.location.y + 0.6,
              z: next.location.z,
            },
            event.projectile.location,
          ),
        );
        event.projectile
          .getComponent("minecraft:projectile")
          .shoot(
            { x: aim.x * 2.4, y: aim.y * 2.4, z: aim.z * 2.4 },
            { uncertainty: 0 },
          );
        return;
      } catch {}
    }
  }
  state.returning = true;
});

world.afterEvents.projectileHitBlock.subscribe((event) => {
  const state = activeThrows.get(event.projectile?.id);
  if (state) state.returning = true;
  else projectileStats.delete(event.projectile?.id);
});

system.runInterval(() => {
  for (const [id, state] of activeThrows) {
    state.age++;
    if (!valid(state.projectile) || !valid(state.owner)) {
      activeThrows.delete(id);
      projectileStats.delete(id);
      continue;
    }
    if (state.age > (state.type === "shield" ? 22 : 16)) state.returning = true;
    if (state.returning) {
      try {
        const target = state.owner.getHeadLocation();
        const pos = state.projectile.location;
        const delta = subtract(target, pos);
        const dist = length(delta);
        if (dist < 1.6 || state.age > 100) {
          state.projectile.remove();
          activeThrows.delete(id);
          projectileStats.delete(id);
          continue;
        }
        const dir = normalize(delta);
        const step = Math.min(1.6 + state.loyalty * 0.35, dist);
        state.projectile.teleport(
          {
            x: pos.x + dir.x * step,
            y: pos.y + dir.y * step,
            z: pos.z + dir.z * step,
          },
          { facingLocation: target },
        );
      } catch {
        activeThrows.delete(id);
      }
    }
  }
}, 1);

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      const equipment = player.getComponent("minecraft:equippable");
      const mainHand = equipment?.getEquipment(EquipmentSlot.Mainhand);
      const heldId = mainHand?.typeId ?? "";
      if (heldWeaponByPlayer.get(player.id) !== heldId) {
        heldWeaponByPlayer.set(player.id, heldId);
        if (WEAPON_HELP[heldId])
          player.onScreenDisplay.setActionBar(WEAPON_HELP[heldId]);
      }
      for (const effect of HOLD_BUFFS[heldId] ?? []) {
        const current = player.getEffect(effect.id);
        if (
          !current ||
          current.amplifier < effect.amplifier ||
          (current.amplifier === effect.amplifier && current.duration < 25)
        ) {
          player.addEffect(effect.id, 35, {
            amplifier: effect.amplifier,
            showParticles: false,
          });
        }
      }
      const shield = equipment?.getEquipment(EquipmentSlot.Offhand);
      if (shield?.typeId !== `${NS}:captain_shield`) continue;
      const durability = shield.getComponent("minecraft:durability");
      if (durability && durability.damage > 0) {
        durability.damage = 0;
        equipment.setEquipment(EquipmentSlot.Offhand, shield);
      }
    } catch {}
  }
}, 10);

function nearestPlayer(entity, maxDistance = 48) {
  let best;
  let bestDistance = maxDistance;
  for (const player of world.getAllPlayers()) {
    if (player.dimension.id !== entity.dimension.id) continue;
    const d = distance(player.location, entity.location);
    if (d < bestDistance) {
      best = player;
      bestDistance = d;
    }
  }
  return best;
}

function bossPulse(boss) {
  const player = nearestPlayer(boss);
  if (!player) return;
  const timer = bossTimers.get(boss.id) ?? { shot: 0, summon: 80 };
  timer.shot += 20;
  timer.summon += 20;
  if (timer.shot >= 60) {
    timer.shot = 0;
    try {
      const start = boss.getHeadLocation();
      const bolt = boss.dimension.spawnEntity(`${NS}:cat_bolt`, start);
      const aim = normalize(
        subtract(
          {
            x: player.location.x,
            y: player.location.y + 1,
            z: player.location.z,
          },
          start,
        ),
      );
      const component = bolt.getComponent("minecraft:projectile");
      component.owner = boss;
      component.shoot(
        { x: aim.x * 1.35, y: aim.y * 1.35, z: aim.z * 1.35 },
        { uncertainty: 1.5 },
      );
      boss.dimension.runCommand(
        `playsound mob.warden.sonic_boom @a[r=48] ${start.x} ${start.y} ${start.z} 0.7 1.25`,
      );
    } catch {}
  }
  if (timer.summon >= 220) {
    timer.summon = 0;
    try {
      const cats = boss.dimension.getEntities({
        type: `${NS}:war_cat`,
        location: boss.location,
        maxDistance: 48,
      });
      const amount = Math.min(3, Math.max(0, 8 - cats.length));
      for (let i = 0; i < amount; i++) {
        boss.dimension.spawnEntity(`${NS}:war_cat`, {
          x: boss.location.x + (i - 1) * 2,
          y: boss.location.y,
          z: boss.location.z + 2,
        });
      }
      boss.dimension.runCommand(
        `playsound mob.warden.roar @a[r=64] ${boss.location.x} ${boss.location.y} ${boss.location.z} 1 1.4`,
      );
    } catch {}
  }
  bossTimers.set(boss.id, timer);

  // Arena confinement - if boss wanders outside the arena, teleport back
  const origin = arenaOrigins.get(boss.id);
  if (origin) {
    const dist = distance(boss.location, origin);
    if (dist > ARENA_RADIUS) {
      try {
        boss.teleport(origin, { dimension: boss.dimension });
        boss.dimension.runCommand(
          `playsound mob.warden.sonic_boom @a[r=64] ${origin.x} ${origin.y} ${origin.z} 0.5 1.5`,
        );
      } catch {}
    }
  }
}

system.runInterval(() => {
  const alive = new Set();
  for (const dimName of ["overworld", "nether", "the_end"]) {
    try {
      for (const boss of world
        .getDimension(dimName)
        .getEntities({ type: `${NS}:hai_sieu_xau_quac` })) {
        alive.add(boss.id);
        bossPulse(boss);
      }
    } catch {}
  }
  for (const id of bossTimers.keys())
    if (!alive.has(id)) {
      bossTimers.delete(id);
      arenaOrigins.delete(id);
    }
}, 20);

function spawnBossInArena(dimension, center) {
  try {
    const { x, y, z } = center;
    
    // Check if boss already exists here
    const existing = dimension.getEntities({ type: `${NS}:hai_sieu_xau_quac`, location: center, maxDistance: 30 });
    if (existing.length > 0) return;
    
    // Spawn the boss
    const boss = dimension.spawnEntity(`${NS}:hai_sieu_xau_quac`, { x, y: y, z });
    try { boss.nameTag = "§5Hai Sieu Xau Quac"; } catch {}
    
    // Register the arena origin for confinement
    arenaOrigins.set(boss.id, { x, y, z });
    
    // Spawn guard cats
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      const cx = x + Math.cos(angle) * 6;
      const cz = z + Math.sin(angle) * 6;
      dimension.spawnEntity(`${NS}:war_cat`, { x: cx, y, z: cz });
    }
    
    // Notify nearby players
    try {
      dimension.runCommand(
        `tellraw @a[r=128] {"rawtext":[{"text":"§5Hai Sieu Xau Quac has awakened in a hidden arena! §7(${x}, ${y}, ${z})"}]}`,
      );
    } catch {}
  } catch (error) {
    console.warn(`Failed to spawn boss in arena: ${error}`);
  }
}

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  system.runTimeout(
    () =>
      tell(
        event.player,
        "§bMythic weapons: §fHold a weapon to see controls. Use/right-click to throw or fire. Sneak + use either hammer for aimed lightning.",
      ),
    60,
  );
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== `${NS}:spawn_dungeon`) return;
  const player = event.sourceEntity;
  if (player?.typeId === "minecraft:player") {
    const loc = player.location;
    const x = Math.floor(loc.x);
    const y = Math.floor(loc.y) - 2;
    const z = Math.floor(loc.z);
    // Load the arena structure as a fallback
    try { player.dimension.runCommand(`structure load chim_marvel_arena/structure ${x} ${y} ${z}`); } catch {}
    spawnBossInArena(player.dimension, { x, y: y + 1, z });
  }
});
