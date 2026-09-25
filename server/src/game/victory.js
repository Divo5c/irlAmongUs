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
  const total = Array.isArray(tasks) ? tasks.length : 0;
  const completed = Array.isArray(tasks)
    ? tasks.filter((task) => task.completed).length
    : 0;

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
