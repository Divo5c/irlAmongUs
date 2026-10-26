/**
 * Pure victory evaluation. Works on a plain snapshot of the room
 * ({ players, tasks }) so it is trivially testable.
 *
 * Rules:
 * 1. All tasks completed (and at least one task exists)  -> CREWMATE wins.
 * 2. No impostor left alive                              -> CREWMATE wins.
 * 3. Alive impostors >= alive crewmates                  -> IMPOSTOR wins.
 * 4. otherwise                                           -> game continues.
 */
function evaluateVictory({ players, tasks }) {
  // Fake tasks (impostors) must never contribute to the crew win condition.
  const realTasks = Array.isArray(tasks) ? tasks.filter((t) => !t.isFake) : [];
  const total = realTasks.length;
  const completed = realTasks.filter((task) => task.completed).length;

  if (total > 0 && completed >= total) {
    return 'CREWMATE';
  }

  let aliveImpostors = 0;
  let aliveCrewmates = 0;
  let impostorsTotal = 0;

  for (const player of players) {
    if (player.role === 'IMPOSTOR') {
      impostorsTotal += 1;
      if (player.isAlive) {
        aliveImpostors += 1;
      }
    } else if (player.role === 'CREWMATE' && player.isAlive) {
      aliveCrewmates += 1;
    }
  }

  if (impostorsTotal > 0 && aliveImpostors === 0) {
    return 'CREWMATE';
  }

  if (aliveImpostors > 0 && aliveImpostors >= aliveCrewmates) {
    return 'IMPOSTOR';
  }

  return null;
}

module.exports = { evaluateVictory };

/**
 * Rich variant for UI: explains WHY the game ended (clients show the
 * reason so a crew win after a kill does not confuse players).
 */
function evaluateVictoryDetailed(sim) {
  const players = sim.players ?? [];
  const realTasks = Array.isArray(sim.tasks) ? sim.tasks.filter((t) => !t.isFake) : [];
  const total = realTasks.length;
  const completed = realTasks.filter((t) => t.completed).length;
  const winner = evaluateVictory({ players, tasks: realTasks });
  if (!winner) return null;
  if (winner === 'CREWMATE') {
    return total > 0 && completed >= total
      ? { winner, reason: 'TASKS_COMPLETE' }
      : { winner, reason: 'IMPOSTORS_DEAD' };
  }
  return { winner, reason: 'IMPOSTOR_PARITY' };
}

module.exports = { evaluateVictory, evaluateVictoryDetailed };
