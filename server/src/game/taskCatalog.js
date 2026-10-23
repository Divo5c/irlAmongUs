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
]);

/**
 * Creates fresh task instances for every player of the given player list.
 * Each task links to a spot on the map: centroid of a room polygon or a
 * map node, so clients can render markers and require proximity via the
 * Use button. Impostors receive fake instances (isFake: true).
 *
 * Locations cycle through rooms first, then fall back to street nodes.
 */
function createTasks(players, tasksPerCrewmate, map = null) {
  if (!Number.isInteger(tasksPerCrewmate) || tasksPerCrewmate < 1 || tasksPerCrewmate > TASK_CATALOG.length) {
    throw new GameError(
      'CONFIG_INVALID',
      `tasksPerCrewmate must be between 1 and ${TASK_CATALOG.length}.`,
      { field: 'tasksPerCrewmate' },
    );
  }

  const spots = collectTaskSpots(map);
  let playerNr = 0;
  const tasks = [];
  let spotNr = 0;

  for (const player of players) {
    playerNr += 1;
    // Impostors receive the same amount of FAKE tasks (like Among Us):
    // they show up in their task list but never count toward progress.
    const isFake = player.role !== 'CREWMATE';
    for (let i = 0; i < tasksPerCrewmate; i += 1) {
      // Catalog is at least as large as the max tasks-per-crewmate bound,
      // so titles never repeat within one player's task list.
      const entry = TASK_CATALOG[(playerNr - 1 + i) % TASK_CATALOG.length];
      const spot = spots[spotNr % spots.length] ?? null;
      spotNr += 1;
      tasks.push({
        id: `${entry.id}-${playerNr}-${i + 1}${isFake ? '-fake' : ''}`,
        type: entry.id,
        assignedTo: player.id,
        title: entry.title,
        isFake,
        roomId: spot?.roomId ?? null,
        roomName: spot?.roomName ?? null,
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
      spots.push({ roomId: room.id, roomName: room.name, x: node.x, y: node.y });
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

module.exports = { TASK_CATALOG, createTasks, groupTasksByPlayer };
