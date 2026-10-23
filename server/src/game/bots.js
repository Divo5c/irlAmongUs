'use strict';

/**
 * Bot players for solo testing.
 *
 * Bots are real room players (same events, same rules, no code bypass):
 * they are added via addPlayerToRoom with isBot=true, walk along the
 * room's corridor graph like a human would send position:update, slowly
 * complete tasks as crewmates and cast random votes in meetings. The
 * host therefore can test the full game loop (roles, kill, report,
 * meetings, voting, task progress, victory) without other humans.
 */

const { RoomStoreError } = require('../rooms/roomStore');

// Well under the 8 m/s plausibility cap in positioning.js.
const MOVE_INTERVAL_MS = 2000;
const BOT_SPEED_MPS = 4.0;

// One auto-completed crew task about every TASK_TICKS * MOVE_INTERVAL_MS.
const TASK_TICKS = 15;

const MAX_BOTS = 5;

function createBotEngine(roomStore, { moveIntervalMs = MOVE_INTERVAL_MS, taskTicks = TASK_TICKS } = {}) {
  /** code -> interval */
  const timers = new Map();
  /** code -> Map<botId, {nodeId, x, y, targetId}> */
  const walkers = new Map();
  const tickCounter = new Map();

  function botsOf(room) {
    return room.players.filter((player) => !!player.isBot);
  }

  function aliveIds(room) {
    return room.players
      .filter((player) => player.isAlive !== false)
      .map(({ id }) => id);
  }

  /** Adds `count` bots to a joinable room and starts their engine. */
  function addBots(code, count) {
    const room = roomStore.getRequiredRoom(code);
    const existingBots = botsOf(room).length;
    const wanted = Math.max(1, Math.min(MAX_BOTS - existingBots, count));
    if (wanted <= 0) {
      throw new RoomStoreError(
        'BOTS_MAXED',
        `A room can hold at most ${MAX_BOTS} bots.`,
      );
    }

    let current = room;
    for (let i = 0; i < wanted; i += 1) {
      const index = existingBots + i + 1;
      current = roomStore.addPlayerToRoom(code, {
        id: `bot-${code.toLowerCase()}-${index}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,
        name: `Bot ${index}`,
        isBot: true,
      });
    }
    ensureRunning(code);
    return roomStore.toPublicRoom(current);
  }

  /** Removes the most recently added bot (host convenience button). */
  function removeLastBot(code) {
    const room = roomStore.getRequiredRoom(code);
    const bots = botsOf(room);
    if (!bots.length) {
      throw new RoomStoreError('NO_BOTS', 'There are no bots to remove.');
    }
    const outcome = roomStore.removePlayer(code, bots[bots.length - 1].id);
    return outcome;
  }

  function ensureRunning(code) {
    if (timers.has(code)) return;
    const timer = setInterval(() => safeTick(code), moveIntervalMs);
    // unref: bots must never keep the process alive on their own.
    timer.unref();
    timers.set(code, timer);
  }

  function stop(code) {
    const timer = timers.get(code);
    if (timer) clearInterval(timer);
    timers.delete(code);
    walkers.delete(code);
    tickCounter.delete(code);
  }

  function safeTick(code) {
    try {
      tick(code);
    } catch (error) {
      // Room deleted or hard failure: stop quietly, free the timer.
      stop(code);
    }
  }

  function tick(code) {
    const room = roomStore.getRoom(code);
    if (!room) {
      stop(code);
      return;
    }
    const bots = botsOf(room).filter((bot) => bot.isAlive !== false);
    if (!bots.length) {
      stop(code);
      return;
    }

    if (room.status === 'IN_GAME') {
      const progress = (tickCounter.get(code) ?? 0) + 1;
      tickCounter.set(code, progress);
      for (const bot of bots) {
        try {
          moveBot(code, room, bot);
        } catch (error) {
          // Movement failures are cosmetic; keep the bot alive.
        }
      }
      if (progress % taskTicks === 0) {
        autoCompleteOneTask(code, room, bots);
      }
      if (room.sabotage) {
        botCrewFixSabotage(code, room, bots);
      }
      return;
    }

    if (room.status === 'MEETING' && room.meeting?.phase === 'VOTING') {
      for (const bot of bots) {
        try {
          castBotVote(code, room, bot.id, aliveIds(room));
        } catch (error) {
          // Not our turn / phase changed: ignore this tick.
        }
      }
    }
  }

  /**
   * Random-walk along the map corridor graph: walk toward the current
   * target node, pick a new adjacent node on arrival. Position updates go
   * through the same validate-and-match pipeline humans use.
   */
  function moveBot(code, room, bot) {
    const nodes = room.map?.nodes ?? [];
    const corridors = room.map?.corridors ?? [];
    if (!nodes.length || !corridors.length) return;

    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    let walkMap = walkers.get(code);
    if (!walkMap) {
      walkMap = new Map();
      walkers.set(code, walkMap);
    }

    let walk = walkMap.get(bot.id);
    if (!walk) {
      const start = nodes[Math.floor(Math.random() * nodes.length)];
      walk = { nodeId: start.id, x: start.x, y: start.y, targetId: null };
      walkMap.set(bot.id, walk);
    }

    if (!walk.targetId) {
      const options = corridors
        .filter((corridor) => corridor.a === walk.nodeId || corridor.b === walk.nodeId)
        .map((corridor) => (corridor.a === walk.nodeId ? corridor.b : corridor.a));
      if (!options.length) {
        // Isolated node: teleport to a random other node to keep moving.
        const jump = nodes[Math.floor(Math.random() * nodes.length)];
        walk.nodeId = jump.id;
        walk.x = jump.x;
        walk.y = jump.y;
        return;
      }
      // Route toward the bot's own task spot when it has one (pose as a
      // purposeful worker), otherwise wander.
      const taskTarget = botTaskTarget(code, room, bot);
      if (taskTarget?.id && taskTarget.id !== walk.nodeId && nodeById.has(taskTarget.id)) {
        walk.targetId = taskTarget.id;
      } else {
        walk.targetId = options[Math.floor(Math.random() * options.length)];
      }
    }
    const target = nodeById.get(walk.targetId);
    if (!target) {
      walk.targetId = null;
      return;
    }

    const step = BOT_SPEED_MPS * (moveIntervalMs / 1000);
    const dx = target.x - walk.x;
    const dy = target.y - walk.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= step) {
      walk.x = target.x;
      walk.y = target.y;
      walk.nodeId = target.id;
      walk.targetId = null;
    } else {
      walk.x += (dx / dist) * step;
      walk.y += (dy / dist) * step;
    }

    roomStore.updatePosition(code, bot.id, {
      x: walk.x,
      y: walk.y,
      confidence: 0.9,
      source: 'MANUAL_DEBUG',
    });
  }

  /**
   * Bots keep long games alive by fixing an impostor sabotage quickly
   * (skipping the physical presence gate, same as task completion).
   */
  function botCrewFixSabotage(code, room, bots) {
    const sab = room.sabotage;
    const panel = sab.type === 'REACTOR'
      ? 'REACTOR'
      : !sab.panels?.o2 ? 'o2' : 'admin';
    for (const bot of bots) {
      if (bot.role !== 'CREWMATE') continue;
      try {
        roomStore.fixSabotagePanel(code, bot.id, panel, {
          skipPresenceCheck: true,
        });
        return; // fixed — or one panel done per tick
      } catch {
        // Panel race / dead crew: try the next bot.
      }
    }
  }

  function autoCompleteOneTask(code, room, bots) {    for (const bot of bots) {
      if (bot.role !== 'CREWMATE') continue;
      try {
        const tasks = roomStore
          .getTasksForPlayer(code, bot.id)
          .filter((task) => !task.completed);
        if (!tasks.length) continue;
        roomStore.completeTask(code, bot.id, tasks[0].id, { skipProximity: true });
        return; // one task per cycle keeps the game going long enough
      } catch (error) {
        // Already completed this tick / task race: try next bot.
      }
    }
  }

  /**
   * Bots steer toward their next task spot (room centroid) when they have
   * one, so the proximity gate for task completion can actually pass.
   */
  function botTaskTarget(code, room, bot) {
    if (bot.role !== 'CREWMATE') return null;
    const task = roomStore
      .getTasksForPlayer(code, bot.id)
      .find((entry) => !entry.completed);
    if (!task || task.x == null) return null;
    return { id: findNearestNode(room.map, task.x, task.y)?.id ?? null };
  }

  function findNearestNode(map, x, y) {
    const nodes = map?.nodes ?? [];
    let best = null;
    let bestDist = Infinity;
    for (const node of nodes) {
      const d = Math.hypot(node.x - x, node.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return best;
  }

  function castBotVote(code, room, botId, alive) {
    const votes = room.meeting?.votes ?? {};
    if (botId in votes) return;
    const targets = alive.filter((id) => id !== botId);
    // 30% skip, otherwise vote a random other alive player.
    const skip = targets.length === 0 || Math.random() < 0.3;
    const targetId = skip ? undefined : targets[Math.floor(Math.random() * targets.length)];
    roomStore.castVote(code, botId, { targetId, skip });
  }

  function isRunning(code) {
    return timers.has(code);
  }

  /** Test hook: run one tick synchronously. */
  function tickNow(code) {
    tick(code);
  }

  return { addBots, removeLastBot, ensureRunning, stop, isRunning, tickNow };
}

module.exports = { createBotEngine, MOVE_INTERVAL_MS, TASK_TICKS, MAX_BOTS };
