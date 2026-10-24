const { GameError } = require('./errors');

/**
 * Central task catalog. Every task instance references a catalog entry via
 * its `type`, so clients can later render a dedicated UI per task type
 * without any server change.
 */
const TASK_CATALOG = Object.freeze([
  { id: 'fix_wiring', title: 'Fix Wiring' },
  { id: 'swipe_card', title: 'Swipe Card' },
  { id: 'upload_data', title: 'Upload Data' },
  { id: 'inspect_sample', title: 'Inspect Sample' },
  { id: 'calibrate_distributor', title: 'Calibrate Distributor' },
  { id: 'start_reactor', title: 'Start Reactor' },
  { id: 'fuel_engines', title: 'Fuel Engines' },
  { id: 'chart_course', title: 'Chart Course' },
  { id: 'clean_o2_filter', title: 'Clean O2 Filter' },
  { id: 'empty_garbage', title: 'Empty Garbage' },
  { id: 'divert_power', title: 'Divert Power' },
  { id: 'align_engine', title: 'Align Engine Output' },
  { id: 'stabilize_steering', title: 'Stabilize Steering' },
  { id: 'clear_asteroids', title: 'Clear Asteroids' },
  { id: 'prime_shields', title: 'Prime Shields' },
  { id: 'submit_scan', title: 'Submit Scan' },
  { id: 'unlock_manifolds', title: 'Unlock Manifolds' },
  { id: 'enter_id_code', title: 'Enter ID Code' },
  { id: 'reset_breakers', title: 'Reset Breakers' },
]);

/**
 * Which tasks CAN happen in which room type (Among Us logic): the mapper
 * decides the rooms, the store picks fitting task types for them.
 * Room types missing here fall back to the general pool.
 */
const ROOM_TASKS = Object.freeze({
  CAFETERIA: ['empty_garbage', 'fix_wiring', 'divert_power'],
  ADMIN: ['swipe_card', 'upload_data', 'enter_id_code'],
  REACTOR: ['start_reactor', 'unlock_manifolds', 'fix_wiring'],
  O2: ['clean_o2_filter', 'empty_garbage'],
  ELECTRICAL: ['calibrate_distributor', 'divert_power', 'reset_breakers', 'fix_wiring'],
  MEDBAY: ['inspect_sample', 'submit_scan'],
  SECURITY: ['reset_breakers', 'fix_wiring'],
  NAVIGATION: ['chart_course', 'stabilize_steering'],
  WEAPONS: ['clear_asteroids', 'divert_power'],
  SHIELDS: ['prime_shields', 'fix_wiring'],
  STORAGE: ['fuel_engines', 'align_engine', 'empty_garbage', 'fix_wiring'],
});

/** Fallback pool for normal/custom rooms and unmapped street spots. */
const GENERAL_POOL = Object.freeze(['fix_wiring', 'upload_data', 'chart_course', 'empty_garbage']);

/**
 * Creates fresh task instances for every player of the given player list.
 * Each task links to a spot on the map: centroid of a room polygon or a
 * map node, so clients can render markers and require proximity via the
 * Use button. Impostors receive fake instances (isFake: true).
 *
 * Locations cycle through rooms first, then fall back to street nodes.
 */
function createTasks(players, tasksPerCrewmate, map = null) {
  if (!Number.isInteger(tasksPerCrewmate) || tasksPerCrewmate < 1 || tasksPerCrewmate > 6) {
    throw new GameError(
      'CONFIG_INVALID',
      'tasksPerCrewmate must be between 1 and 6.',
      { field: 'tasksPerCrewmate' },
    );
  }

  const titleOf = new Map(TASK_CATALOG.map((entry) => [entry.id, entry.title]));
  const generalTitle = (type) => titleOf.get(type) ??
    type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ');

  const spots = collectTaskSpots(map);
  const tasks = [];

  for (let playerNr = 1; playerNr <= players.length; playerNr += 1) {
    const player = players[playerNr - 1];
    // Impostors receive the same amount of FAKE tasks (like Among Us):
    // they show up in their task list but never count toward progress.
    const isFake = player.role !== 'CREWMATE';
    const usedTypes = new Set();

    for (let i = 0; i < tasksPerCrewmate; i += 1) {
      const spot = spots[(playerNr - 1 + i * players.length) % spots.length] ?? null;
      const pool = ROOM_TASKS[spot?.roomType ?? 'NORMAL'] ?? GENERAL_POOL;
      // Rotate through the room's pool; skip types the player already has
      // (room pools can be smaller than tasksPerCrewmate \u2014 then repeats
      // of DIFFERENT spots are fine, Among Us does the same).
      let type = null;
      for (let attempt = 0; attempt < pool.length * 2; attempt += 1) {
        const candidate = pool[(playerNr + i + attempt) % pool.length];
        if (!usedTypes.has(candidate)) {
          type = candidate;
          break;
        }
      }
      type ??= GENERAL_POOL[(playerNr + i) % GENERAL_POOL.length];
      usedTypes.add(type);

      tasks.push({
        id: `${type}-${playerNr}-${i + 1}${isFake ? '-fake' : ''}`,
        type: type === 'general' ? 'fix_wiring' : type,
        assignedTo: player.id,
        title: type === 'general' ? 'Stra\u00dfen-Check' : generalTitle(type),
        isFake,
        roomId: spot?.roomId ?? null,
        roomName: spot?.roomName ?? null,
        roomType: spot?.roomType ?? null,
        x: spot?.x ?? null,
        y: spot?.y ?? null,
        completed: false,
        completedAt: null,
      });
    }
  }

  return tasks;
}

/** Indoor room centroids first, then street nodes as outdoor spots. */
function collectTaskSpots(map) {
  const spots = [];
  const rooms = map?.rooms ?? [];
  for (const room of rooms) {
    const pts = room.polygon ?? [];
    if (pts.length < 3) continue;
    spots.push({
      roomId: room.id,
      roomName: room.name,
      roomType: room.type ?? 'NORMAL',
      x: pts.reduce((sum, p) => sum + p.x, 0) / pts.length,
      y: pts.reduce((sum, p) => sum + p.y, 0) / pts.length,
    });
  }
  const anchor = new Set();
  for (const room of rooms) {
    for (const conn of map?.connections ?? []) {
      if (conn.roomId === room.id) anchor.add(conn.nodeId);
    }
    for (const node of map?.nodes ?? []) {
      if (!anchor.has(node.id)) continue;
      anchor.delete(node.id);
      spots.push({
        roomId: room.id,
        roomName: room.name,
        roomType: room.type ?? 'NORMAL',
        x: node.x,
        y: node.y,
      });
    }
  }
  return spots;
}

function groupTasksByPlayer(tasks) {
  const grouped = {};
  for (const task of tasks) {
    grouped[task.assignedTo] ??= [];
    grouped[task.assignedTo].push({
      id: task.id,
      type: task.type,
      title: task.title,
      isFake: !!task.isFake,
      roomId: task.roomId ?? null,
      roomName: task.roomName ?? null,
      x: task.x ?? null,
      y: task.y ?? null,
    });
  }
  return grouped;
}

module.exports = { TASK_CATALOG, ROOM_TASKS, createTasks, groupTasksByPlayer };
