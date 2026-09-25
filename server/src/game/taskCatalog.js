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
 * Creates fresh task instances for every crewmate of the given player list.
 * Instance IDs are stable within a round: `<type>-<playerNr>-<taskNr>`.
 */
function createTasks(players, tasksPerCrewmate) {
  if (!Number.isInteger(tasksPerCrewmate) || tasksPerCrewmate < 1 || tasksPerCrewmate > TASK_CATALOG.length) {
    throw new GameError(
      'CONFIG_INVALID',
      `tasksPerCrewmate must be between 1 and ${TASK_CATALOG.length}.`,
      { field: 'tasksPerCrewmate' },
    );
  }

  let playerNr = 0;
  const tasks = [];

  for (const player of players) {
    if (player.role !== 'CREWMATE') {
      continue;
    }
    playerNr += 1;
    for (let i = 0; i < tasksPerCrewmate; i += 1) {
      // Catalog is at least as large as the max tasks-per-crewmate bound,
      // so titles never repeat within one player's task list.
      const entry = TASK_CATALOG[(playerNr - 1 + i) % TASK_CATALOG.length];
      tasks.push({
        id: `${entry.id}-${playerNr}-${i + 1}`,
        type: entry.id,
        assignedTo: player.id,
        title: entry.title,
        completed: false,
        completedAt: null,
      });
    }
  }

  return tasks;
}

function groupTasksByPlayer(tasks) {
  const grouped = {};
  for (const task of tasks) {
    grouped[task.assignedTo] ??= [];
    grouped[task.assignedTo].push({ id: task.id, type: task.type, title: task.title });
  }
  return grouped;
}

module.exports = { TASK_CATALOG, createTasks, groupTasksByPlayer };
