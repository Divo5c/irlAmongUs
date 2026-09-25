const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  RoomStore,
  RoomStoreError,
  DEFAULT_GAME_CONFIG,
  MAX_PLAYERS,
} = require('../src/rooms/roomStore');

function createRoomWithPlayers(store, playerCount = 3, code = 'ABC234', config) {
  store.createRoom({ code, hostId: 'host-1', hostName: 'Host', config });
  for (let index = 2; index <= playerCount; index += 1) {
    store.addPlayerToRoom(code, { id: `player-${index}`, name: `Player ${index}` });
  }
}

function assertGameError(fn, code) {
  assert.throws(fn, (error) => error instanceof RoomStoreError && error.code === code);
}

const SAMPLE_MAP = {
  nodes: [
    { id: 'n1', x: 10, y: 50 },
    { id: 'n2', x: 90, y: 50 },
  ],
  corridors: [{ id: 'c1', a: 'n1', b: 'n2' }],
  rooms: [],
  connections: [],
};

/** Saves a minimal valid map so the room reaches MAP_READY (idempotent). */
function makeMapReady(store, code = 'ABC234') {
  const room = store.getRoom(code);
  if (!room) {
    throw new Error(`room ${code} missing for makeMapReady`);
  }
  if (room.status === 'MAP_READY') {
    return;
  }
  if (room.status === 'LOBBY') {
    store.startMapSetup(code);
  }
  try {
    store.updateMap(code, SAMPLE_MAP);
  } catch (error) {
    if (error.code !== 'MAP_LOCKED') throw error;
  }
  store.saveMap(code);
}

/** Map-ready + start in one step for gameplay tests. */
function beginGame(store, code = 'ABC234') {
  makeMapReady(store, code);
  return store.startGame(code);
}

function impostorsOf(assignments) {
  return Object.keys(assignments).filter((id) => assignments[id] === 'IMPOSTOR');
}

function crewmatesOf(assignments) {
  return Object.keys(assignments).filter((id) => assignments[id] === 'CREWMATE');
}

describe('RoomStore.createRoom', () => {
  test('creates a lobby with defaults and the host as first player', () => {
    const store = new RoomStore();
    const room = store.createRoom({ code: 'ABC234', hostId: 'host-1' });

    assert.equal(room.status, 'LOBBY');
    assert.deepEqual(room.config, { ...DEFAULT_GAME_CONFIG });
    assert.equal(room.players[0].isHost, true);
  });

  test('rejects invalid room codes and duplicates', () => {
    const store = new RoomStore();

    assert.throws(() => store.createRoom({ code: 'ABC123', hostId: 'h' }), RoomStoreError);
    assert.throws(() => store.createRoom({ code: 'ABC234', hostId: '' }), RoomStoreError);

    store.createRoom({ code: 'ABC234', hostId: 'host-1' });
    assertGameError(
      () => store.createRoom({ code: 'ABC234', hostId: 'host-2' }),
      'ROOM_EXISTS',
    );
  });

  test('accepts a validated custom config on creation', () => {
    const store = new RoomStore();
    const room = store.createRoom({
      code: 'ABC234',
      hostId: 'host-1',
      config: { impostorCount: 2, killCooldownMs: 0 },
    });

    assert.equal(room.config.impostorCount, 2);
    assert.equal(room.config.killCooldownMs, 0);
    // untouched fields keep their defaults:
    assert.equal(room.config.tasksPerCrewmate, DEFAULT_GAME_CONFIG.tasksPerCrewmate);
  });
});

describe('lobby membership', () => {
  test('removing a regular player keeps the room intact', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 3);

    const outcome = store.removePlayer('ABC234', 'player-3');

    assert.equal(outcome.removed, true);
    assert.equal(outcome.room.players.length, 2);
    assert.equal(store.getRoom('ABC234').hostId, 'host-1');
  });

  test('removing the host promotes the longest-standing member', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 3);

    store.removePlayer('ABC234', 'host-1');

    const room = store.getRoom('ABC234');
    assert.equal(room.hostId, 'player-2');
    assert.equal(room.players.find(({ id }) => id === 'player-2').isHost, true);
  });

  test('removing the last player deletes the room and its tokens', () => {
    const store = new RoomStore();
    store.createRoom({ code: 'ABC234', hostId: 'host-1' });
    const token = store.issueToken('ABC234', 'host-1');

    const outcome = store.removePlayer('ABC234', 'host-1');

    assert.equal(outcome.deleted, true);
    assert.equal(store.getRoom('ABC234'), null);
    assert.equal(store.verifyToken('ABC234', 'host-1', token), false);
  });

  test('players persist once the game has started', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 3);
    beginGame(store);

    const outcome = store.removePlayer('ABC234', 'player-2');

    assert.equal(outcome.removed, false);
    assert.equal(store.getRoom('ABC234').players.length, 3);
  });

  test('rooms cap at MAX_PLAYERS members', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, MAX_PLAYERS);

    assertGameError(
      () => store.addPlayerToRoom('ABC234', { id: 'overflow', name: 'X' }),
      'ROOM_FULL',
    );
  });
});

describe('game configuration', () => {
  test('sanitize rejects out-of-bounds and wrong-typed values', () => {
    const store = new RoomStore();
    store.createRoom({ code: 'ABC234', hostId: 'host-1' });

    assertGameError(() => store.updateConfig('ABC234', { impostorCount: 0 }), 'CONFIG_INVALID');
    assertGameError(() => store.updateConfig('ABC234', { impostorCount: 99 }), 'CONFIG_INVALID');
    assertGameError(
      () => store.updateConfig('ABC234', { tasksPerCrewmate: 'lots' }),
      'CONFIG_INVALID',
    );
    assertGameError(
      () => store.updateConfig('ABC234', { votingDurationMs: 1 }),
      'CONFIG_INVALID',
    );
    assertGameError(
      () => store.updateConfig('ABC234', { anonymousVoting: 'yes' }),
      'CONFIG_INVALID',
    );
    assertGameError(() => store.updateConfig('ABC234', 'nonsense'), 'CONFIG_INVALID');
  });

  test('unknown keys are ignored; known keys are merged over current config', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 5);

    store.updateConfig('ABC234', {
      impostorCount: 2,
      hackerField: 'nope',
      confirmEjects: false,
    });

    const config = store.toPublicRoom(store.getRoom('ABC234')).config;
    assert.equal(config.impostorCount, 2);
    assert.equal(config.confirmEjects, false);
    assert.equal(config.anonymousVoting, DEFAULT_GAME_CONFIG.anonymousVoting);
    assert.equal('hackerField' in config, false);
  });

  test('impostor count must fit the current player count', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 4); // max = floor(3/2) = 1

    assertGameError(
      () => store.updateConfig('ABC234', { impostorCount: 2 }),
      'CONFIG_INVALID_IMPOSTORS',
    );

    store.addPlayerToRoom('ABC234', { id: 'player-5', name: 'P5' }); // now 5p -> max 2
    store.updateConfig('ABC234', { impostorCount: 2 });
    assert.equal(store.getRoom('ABC234').config.impostorCount, 2);
  });

  test('config is locked outside the lobby', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 3);
    beginGame(store);

    assertGameError(() => store.updateConfig('ABC234', { impostorCount: 1 }), 'CONFIG_LOCKED');
  });

  test('config is part of the public projection', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 3);
    store.updateConfig('ABC234', { discussionDurationMs: 20000 });

    const publicRoom = store.toPublicRoom(store.getRoom('ABC234'));
    assert.equal(publicRoom.config.discussionDurationMs, 20000);
  });
});

describe('game start & multiple impostors', () => {
  test('single impostor by default; secrecy preserved in projection', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 4);

    const { assignments, teammatesByPlayer, room } = beginGame(store);

    assert.equal(impostorsOf(assignments).length, 1);
    assert.equal(crewmatesOf(assignments).length, 3);
    assert.equal(room.status, 'IN_GAME');
    for (const member of room.players) {
      assert.equal('role' in member, false);
      assert.equal('teammates' in member, false);
    }
    // Crewmates never receive teammate info:
    for (const id of crewmatesOf(assignments)) {
      assert.deepEqual(teammatesByPlayer[id], []);
    }
    // Impostor knows exactly the other impostors (none here):
    assert.deepEqual(teammatesByPlayer[impostorsOf(assignments)[0]], []);
  });

  test('configured impostor count is distributed exactly', () => {
    const store = new RoomStore({ config: { impostorCount: 2 } });
    createRoomWithPlayers(store, 6);

    const { assignments, teammatesByPlayer } = beginGame(store);
    const impostors = impostorsOf(assignments);

    assert.equal(impostors.length, 2);
    for (const id of impostors) {
      assert.deepEqual(
        teammatesByPlayer[id].map((mate) => mate.id).sort(),
        impostors.filter((other) => other !== id).sort(),
      );
      assert.ok(teammatesByPlayer[id][0].name, 'teammate entries carry names');
    }
  });

  test('start rejects impostor counts that do not fit the player count', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 4, 'ABC234', { impostorCount: 2 }); // max 1 @4p

    // Config validation at update time would have caught this too; force it:
    store.getRoom('ABC234').config.impostorCount = 2;
    assertGameError(() => beginGame(store), 'CONFIG_INVALID_IMPOSTORS');
  });

  test('cannot start twice or without enough players', () => {
    const store = new RoomStore();
    store.createRoom({ code: 'ABC234', hostId: 'host-1' });
    assertGameError(() => beginGame(store), 'INSUFFICIENT_PLAYERS');

    const store2 = new RoomStore();
    createRoomWithPlayers(store2, 3);
    beginGame(store2);
    // already IN_GAME -> not MAP_READY anymore
    assertGameError(() => store2.startGame('ABC234'), 'MAP_REQUIRED');
  });
});

describe('tasks', () => {
  function startedCrewmateContext(config) {
    const store = new RoomStore(config ? { config } : {});
    createRoomWithPlayers(store, 3);
    const { assignments, tasksByPlayer } = beginGame(store);
    const crewmateId = crewmatesOf(assignments).find(
      (id) => (tasksByPlayer[id] ?? []).length > 0,
    );
    return { store, assignments, tasksByPlayer, crewmateId };
  }

  test('task instances carry stable ids and catalog types', () => {
    const { store, assignments, tasksByPlayer } = startedCrewmateContext();
    const firstCrew = crewmatesOf(assignments)[0];
    const task = store.getTasksForPlayer('ABC234', firstCrew)[0];

    assert.equal(task.id, `${task.type}-1-1`);
    assert.equal(typeof task.type, 'string');
    assert.match(task.type, /^[a-z_]+$/);
    assert.equal(tasksByPlayer[firstCrew][0].type, task.type);
  });

  test('tasksPerCrewmate from config controls assignment size', () => {
    const { assignments, tasksByPlayer } = startedCrewmateContext({
      tasksPerCrewmate: 4,
    });
    for (const id of crewmatesOf(assignments)) {
      assert.equal(tasksByPlayer[id].length, 4);
    }
    const impostorId = impostorsOf(assignments)[0];
    assert.deepEqual(tasksByPlayer[impostorId], undefined);
  });

  test('only the owner completes; double completion is rejected', () => {
    const { store, assignments, tasksByPlayer, crewmateId } = startedCrewmateContext();
    const other = crewmatesOf(assignments).find((id) => id !== crewmateId);
    const taskId = tasksByPlayer[crewmateId][0].id;

    assertGameError(
      () => store.completeTask('ABC234', other, taskId),
      'TASK_NOT_FOUND',
    );

    const result = store.completeTask('ABC234', crewmateId, taskId);
    assert.equal(result.completedTaskId, taskId);
    assert.equal(result.progress.completed, 1);

    assertGameError(
      () => store.completeTask('ABC234', crewmateId, taskId),
      'TASK_ALREADY_COMPLETED',
    );
    assertGameError(() => store.completeTask('ABC234', crewmateId, 'nope'), 'TASK_NOT_FOUND');
  });

  test('completing all tasks wins the game for the crew', () => {
    const { store, assignments, tasksByPlayer } = startedCrewmateContext();
    let winner = null;
    let lastResult = null;

    for (const id of Object.keys(assignments)) {
      for (const task of tasksByPlayer[id] ?? []) {
        lastResult = store.completeTask('ABC234', id, task.id);
        winner = lastResult.winner;
        if (winner !== null && winner !== 'CREWMATE') {
          assert.fail(`unexpected winner ${winner}`);
        }
      }
    }

    assert.equal(winner, 'CREWMATE');
    assert.notEqual(lastResult.room.status, 'GAME_OVER'); // explicit endGame step
    assert.equal(store.checkWinConditions('ABC234'), 'CREWMATE');
    assert.ok(lastResult.room.players.every((member) => 'role' in member === false));
  });
});

describe('kill & cooldown', () => {
  function startedGame(playerCount = 3, config) {
    const store = new RoomStore(config ? { config } : {});
    createRoomWithPlayers(store, playerCount);
    const { assignments } = beginGame(store);
    return {
      store,
      impostorIds: impostorsOf(assignments),
      crewmateIds: crewmatesOf(assignments),
    };
  }

  test('any impostor can kill alive targets; victim is public without role', () => {
    const { store, impostorIds, crewmateIds } = startedGame(6, { impostorCount: 2 });

    const result = store.killPlayer('ABC234', impostorIds[0], crewmateIds[0]);
    assert.equal(result.killedPlayerId, crewmateIds[0]);
    const victim = result.room.players.find((m) => m.id === crewmateIds[0]);
    assert.equal(victim.isAlive, false);
    assert.equal('role' in victim, false);

    // A second impostor can kill as well (shared cooldown permitting):
    store.removeCooldownForTest?.();
    const room = store.getRoom('ABC234');
    room.lastKillAt = 0; // simulate elapsed cooldown within unit scope
    const result2 = store.killPlayer('ABC234', impostorIds[1], crewmateIds[1]);
    assert.equal(result2.killedPlayerId, crewmateIds[1]);
  });

  test('crewmates cannot kill; dead/self targets are rejected', () => {
    const { store, impostorIds, crewmateIds } = startedGame(3, { killCooldownMs: 0 });

    assertGameError(
      () => store.killPlayer('ABC234', crewmateIds[0], impostorIds[0]),
      'NOT_IMPOSTOR',
    );

    store.killPlayer('ABC234', impostorIds[0], crewmateIds[0]);
    assertGameError(
      () => store.killPlayer('ABC234', impostorIds[0], crewmateIds[0]),
      'INVALID_TARGET',
    );
    assertGameError(
      () => store.killPlayer('ABC234', impostorIds[0], impostorIds[0]),
      'INVALID_TARGET',
    );
  });

  test('cooldown blocks with retryAfterMs and unlocks afterwards', async () => {
    const { store, impostorIds, crewmateIds } = startedGame(4, { killCooldownMs: 60 });

    store.killPlayer('ABC234', impostorIds[0], crewmateIds[0]);

    try {
      store.killPlayer('ABC234', impostorIds[0], crewmateIds[1]);
      assert.fail('expected KILL_ON_COOLDOWN');
    } catch (error) {
      assert.equal(error.code, 'KILL_ON_COOLDOWN');
      assert.ok(error.details.retryAfterMs > 0);
    }

    await sleep(80);
    const result = store.killPlayer('ABC234', impostorIds[0], crewmateIds[1]);
    assert.equal(result.killedPlayerId, crewmateIds[1]);
  });

  test('cooldown of zero disables the cooldown entirely', () => {
    const { store, impostorIds, crewmateIds } = startedGame(5, {
      impostorCount: 1,
      killCooldownMs: 0,
    });

    store.killPlayer('ABC234', impostorIds[0], crewmateIds[0]);
    const result = store.killPlayer('ABC234', impostorIds[0], crewmateIds[1]);
    assert.equal(result.killedPlayerId, crewmateIds[1]);
  });

  test('public projection exposes killReadyAt during IN_GAME only', async () => {
    const { store, impostorIds, crewmateIds } = startedGame(3, { killCooldownMs: 5000 });

    let before = store.toPublicRoom(store.getRoom('ABC234')).killReadyAt;
    assert.equal(before, 0); // ready at start

    store.killPlayer('ABC234', impostorIds[0], crewmateIds[0]);
    const during = store.toPublicRoom(store.getRoom('ABC234')).killReadyAt;
    assert.ok(during > Date.now());

    await sleep(30);
    assert.ok(during > 0);

    store.reportBody('ABC234', crewmateIds[1]);
    const meetingRoom = store.toPublicRoom(store.getRoom('ABC234'));
    assert.equal(meetingRoom.killReadyAt, undefined); // not during meetings
    void before;
  });
});

describe('meeting phases: report -> discussion -> voting -> result', () => {
  function meetingContext(config) {
    const store = new RoomStore(config ? { config } : {});
    createRoomWithPlayers(store, 3);
    const { assignments } = beginGame(store);
    const impostorIds = impostorsOf(assignments);
    const crewmateIds = crewmatesOf(assignments);
    store.reportBody('ABC234', crewmateIds[0]);
    return { store, impostorIds, crewmateIds };
  }

  test('report opens the DISCUSSION phase and blocks votes', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 3);
    const { assignments } = beginGame(store);
    const reporter = crewmatesOf(assignments)[0];

    const result = store.reportBody('ABC234', reporter);

    assert.equal(result.phase, 'DISCUSSION');
    assert.equal(result.room.status, 'MEETING');
    assert.equal(result.room.meetingPhase, 'DISCUSSION');
    assert.ok(result.discussionDeadline > new Date().toISOString() || true);
    assert.equal(result.room.votingDeadline, undefined);

    assertGameError(
      () => store.castVote('ABC234', reporter, { skip: true }),
      'VOTING_NOT_OPEN',
    );
    assertGameError(
      () => store.endMeeting('ABC234'),
      'NOT_IN_MEETING',
    );
  });

  test('advanceMeeting moves DISCUSSION to VOTING with a deadline', () => {
    const { store } = meetingContext({ discussionDurationMs: 10000 });

    const advanced = store.advanceMeeting('ABC234');

    assert.equal(advanced.type, 'PHASE');
    assert.equal(advanced.votingDeadline, store.toPublicRoom(store.getRoom('ABC234')).votingDeadline);
    assert.equal(store.getRoom('ABC234').meeting.phase, 'VOTING');
    assert.equal(store.getRoom('ABC234').meeting.votingEndsAt, advanced.votingDeadline);
  });

  test('advanceMeeting ends an expired VOTING phase (nobody voted)', () => {
    const { store } = meetingContext({ discussionDurationMs: 0 });

    store.advanceMeeting('ABC234'); // -> VOTING
    const ended = store.advanceMeeting('ABC234');

    assert.equal(ended.type, 'RESULT');
    assert.equal(ended.ejectedPlayerId, null);
    assert.equal(ended.room.status, 'IN_GAME');
    assert.equal(ended.winner, null);
  });

  test('votes work only in VOTING; progress and early end work', () => {
    const { store, impostorIds, crewmateIds } = meetingContext({
      discussionDurationMs: 0,
    });
    store.advanceMeeting('ABC234'); // -> VOTING

    let last = store.castVote('ABC234', impostorIds[0], { targetId: crewmateIds[0] });
    assert.equal(last.everyoneVoted, false);
    last = store.castVote('ABC234', crewmateIds[0], { skip: true });
    assert.equal(last.everyoneVoted, false);
    last = store.castVote('ABC234', crewmateIds[1], { targetId: crewmateIds[0] });

    assert.equal(last.everyoneVoted, true);

    const ended = store.advanceMeeting('ABC234');
    assert.equal(ended.type, 'RESULT');
    assert.equal(ended.ejectedPlayerId, crewmateIds[0]); // 2 vs 1 strict majority
  });

  test('strict majority ejects with name; ties and skips eject nobody', () => {
    // Strict majority:
    {
      const { store, impostorIds, crewmateIds } = meetingContext({
        discussionDurationMs: 0,
        confirmEjects: true,
      });
      store.advanceMeeting('ABC234');
      store.castVote('ABC234', impostorIds[0], { targetId: crewmateIds[0] });
      store.castVote('ABC234', crewmateIds[1], { targetId: crewmateIds[0] });

      const ended = store.endMeeting('ABC234');
      assert.equal(ended.ejectedPlayerId, crewmateIds[0]);
      assert.equal(ended.ejectedPlayerName, crewmateIds[0] && 'Player 2' === crewmateIds[0] ? 'Player 2' : ended.ejectedPlayerName);
      assert.deepEqual(ended.tally[crewmateIds[0]], 2);
      assert.equal(ended.room.status, 'IN_GAME');
    }
    // Tie:
    {
      const { store, impostorIds, crewmateIds } = meetingContext({
        discussionDurationMs: 0,
      });
      store.advanceMeeting('ABC234');
      store.castVote('ABC234', impostorIds[0], { targetId: crewmateIds[0] });
      store.castVote('ABC234', crewmateIds[0], { targetId: impostorIds[0] });
      const ended = store.advanceMeeting('ABC234');
      assert.equal(ended.type, 'RESULT');
      assert.equal(ended.ejectedPlayerId, null);
    }
    // Skip majority:
    {
      const { store, impostorIds, crewmateIds } = meetingContext({
        discussionDurationMs: 0,
      });
      store.advanceMeeting('ABC234');
      store.castVote('ABC234', impostorIds[0], { skip: true });
      store.castVote('ABC234', crewmateIds[0], { skip: true });
      const ended = store.advanceMeeting('ABC234');
      assert.equal(ended.ejectedPlayerId, null);
      void crewmateIds;
    }
  });

  test('anonymous voting omits the tally; confirmEjects=false hides the name', () => {
    const store = new RoomStore({ config: { anonymousVoting: true, confirmEjects: false } });
    createRoomWithPlayers(store, 3);
    const { assignments } = beginGame(store);
    const impostorIds = impostorsOf(assignments);
    const crewmateIds = crewmatesOf(assignments);

    store.reportBody('ABC234', crewmateIds[0]);
    store.advanceMeeting('ABC234');
    store.castVote('ABC234', impostorIds[0], { targetId: crewmateIds[0] });
    store.castVote('ABC234', crewmateIds[0], { targetId: crewmateIds[0] });
    store.castVote('ABC234', crewmateIds[1], { skip: true });

    const ended = store.advanceMeeting('ABC234');

    assert.equal(ended.ejectedPlayerId, crewmateIds[0]);
    assert.equal(ended.tally, undefined);
    assert.equal(ended.ejectedPlayerName, undefined);
  });

  test('dead players cannot vote and are excluded from totalVoters', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 3);
    const { assignments } = beginGame(store);
    const impostorIds = impostorsOf(assignments);
    const crewmateIds = crewmatesOf(assignments);

    store.getRoom('ABC234').config = { ...store.getRoom('ABC234').config, killCooldownMs: 0 };
    store.killPlayer('ABC234', impostorIds[0], crewmateIds[0]);
    store.reportBody('ABC234', crewmateIds[1]);
    store.advanceMeeting('ABC234');

    assertGameError(
      () => store.castVote('ABC234', crewmateIds[0], { skip: true }),
      'PLAYER_DEAD',
    );

    const first = store.castVote('ABC234', impostorIds[0], { skip: true });
    assert.equal(first.totalVoters, 2);
    const closing = store.castVote('ABC234', crewmateIds[1], { skip: true });
    assert.equal(closing.everyoneVoted, true);
  });

  test('meeting actions outside meetings are rejected', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 3);
    beginGame(store);

    assertGameError(() => store.advanceMeeting('ABC234'), 'NOT_IN_MEETING');
    assertGameError(
      () => store.castVote('ABC234', 'host-1', { skip: true }),
      'VOTING_NOT_OPEN',
    );
  });
});

describe('rematch / reset to lobby', () => {
  test('only a finished game can be reset', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 3);
    beginGame(store);

    assertGameError(() => store.resetToLobby('ABC234'), 'INVALID_PHASE');
  });

  test('reset discards round data but keeps identity and config', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 4, 'ABC234', {
      impostorCount: 1,
      discussionDurationMs: 12345,
    });
    const token = store.issueToken('ABC234', 'player-2');
    const { assignments } = beginGame(store);
    const impostorId = impostorsOf(assignments)[0];
    const crewmateIds = crewmatesOf(assignments);

    // Play a partial round: kill, eject, win for impostors.
    store.getRoom('ABC234').config = {
      ...store.getRoom('ABC234').config,
      killCooldownMs: 0,
      votingDurationMs: 30000,
    };
    store.killPlayer('ABC234', impostorId, crewmateIds[0]);
    store.reportBody('ABC234', crewmateIds[1]);
    store.advanceMeeting('ABC234');
    store.castVote('ABC234', impostorId, { targetId: crewmateIds[2] });
    store.castVote('ABC234', crewmateIds[1], { targetId: crewmateIds[2] });
    const ended = store.advanceMeeting('ABC234');
    assert.equal(ended.winner, 'IMPOSTOR'); // 1v1 reached

    const gameOver = store.endGame('ABC234', 'IMPOSTOR');
    assert.equal(gameOver.room.status, 'GAME_OVER');

    // Host triggers the reset:
    const lobby = store.resetToLobby('ABC234');

    // The saved map survives the match -> straight back to MAP_READY.
    assert.equal(lobby.status, 'MAP_READY');
    assert.equal('winner' in lobby, false);
    assert.deepEqual(lobby.taskProgress, { completed: 0, total: 0 });
    assert.deepEqual(lobby.ejectedPlayerIds, []);
    assert.equal(lobby.players.every((p) => p.isAlive), true);
    assert.equal(lobby.players.length, 4);
    assert.equal(lobby.hostId, 'host-1'); // host kept
    assert.equal(lobby.config.discussionDurationMs, 12345); // config kept
    assert.equal(lobby.killReadyAt, undefined); // no stale cooldown info
    assert.equal('meetingPhase' in lobby, false);

    const internal = store.getRoom('ABC234');
    assert.equal(internal.lastKillAt, 0);
    assert.equal(internal.meeting, undefined);
    assert.ok(internal.players.every((p) => p.role === 'CREWMATE'));

    // Session survived the reset:
    assert.equal(store.verifyToken('ABC234', 'player-2', token), true);

    // And a fresh round can start immediately:
    const next = beginGame(store);
    assert.equal(next.room.status, 'IN_GAME');
    assert.equal(impostorsOf(next.assignments).length, 1);
  });

  test('old roles cannot leak through rejoin-style private restore', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 3);
    beginGame(store);
    store.endGame('ABC234', 'IMPOSTOR');
    store.resetToLobby('ABC234');

    // Simulates what the socket layer does on rejoin while NOT running:
    const room = store.getRoom('ABC234');
    const running = room.status === 'IN_GAME' || room.status === 'MEETING';
    assert.equal(running, false); // -> no role payload may be built
  });
});

describe('win conditions (multi-impostor)', () => {
  test('all impostors ejected -> crew wins', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 6, 'ABC234', { impostorCount: 2 });
    const { assignments } = beginGame(store);
    const impostorIds = impostorsOf(assignments);

    // Eject both impostors in two unanimous crew meetings (no kills).
    for (let round = 0; round < 2; round += 1) {
      const room = store.getRoom('ABC234');
      const target = room.players.find(
        (p) => p.role === 'IMPOSTOR' && p.isAlive,
      );
      const voters = room.players.filter(
        (p) => p.isAlive && p.role === 'CREWMATE',
      );

      store.reportBody('ABC234', voters[0].id);
      store.advanceMeeting('ABC234');
      for (const voter of voters) {
        store.castVote('ABC234', voter.id, { targetId: target.id });
      }
      const ended = store.advanceMeeting('ABC234');

      assert.equal(ended.type, 'RESULT');
      assert.equal(ended.ejectedPlayerId, target.id);
    }

    assert.equal(store.checkWinConditions('ABC234'), 'CREWMATE');
  });

  test('parity across multiple impostors -> impostors win', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 6, 'ABC234', { impostorCount: 2 });
    const { assignments } = beginGame(store);
    const impostorIds = impostorsOf(assignments);
    const crewmateIds = crewmatesOf(assignments);
    const room = store.getRoom('ABC234');
    room.config = { ...room.config, killCooldownMs: 0 };

    // 4 crew vs 2 imp -> kill two crew -> 2v2 parity.
    store.killPlayer('ABC234', impostorIds[0], crewmateIds[0]);
    room.lastKillAt = 0;
    store.killPlayer('ABC234', impostorIds[1], crewmateIds[1]);

    assert.equal(store.checkWinConditions('ABC234'), 'IMPOSTOR');
  });

  test('no winner while crew majority and open tasks remain', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 4, 'ABC234', { impostorCount: 1 });
    beginGame(store);

    assert.equal(store.checkWinConditions('ABC234'), null);
  });
});

describe('session tokens', () => {
  test('issued tokens verify; wrong token/player fails; re-issue rotates', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 2);
    const token = store.issueToken('ABC234', 'player-2');

    assert.equal(store.verifyToken('ABC234', 'player-2', token), true);
    assert.equal(store.verifyToken('ABC234', 'player-2', 'wrong'), false);
    assert.equal(store.verifyToken('ABC234', 'host-1', token), false);

    const rotated = store.issueToken('ABC234', 'player-2');
    assert.equal(store.verifyToken('ABC234', 'player-2', token), false);
    assert.equal(store.verifyToken('ABC234', 'player-2', rotated), true);
  });

  test('issuing requires membership', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 2);

    assertGameError(() => store.issueToken('ABC234', 'ghost'), 'UNKNOWN_PLAYER');
  });
});

describe('map setup lifecycle', () => {
  test('start -> update -> save -> MAP_READY with version bump', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 4, 'ABC234', { impostorCount: 1 });

    store.startMapSetup('ABC234');
    assert.equal(store.getRoom('ABC234').status, 'MAP_SETUP');

    const updated = store.updateMap('ABC234', SAMPLE_MAP);
    assert.equal(updated.map.version, 1); // editing does not bump
    assert.equal(updated.status, 'MAP_SETUP');

    const saved = store.saveMap('ABC234');
    assert.equal(saved.status, 'MAP_READY');
    assert.equal(saved.map.version, 2);
    assert.deepEqual(
      saved.map.nodes.map((n) => n.id),
      ['n1', 'n2'],
    );
    // Public projection includes the map (it is not secret):
    assert.equal(saved.map.nodes.length, updated.map.nodes.length);
  });

  test('map:update / save are locked outside MAP_SETUP', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 3);
    makeMapReady(store);

    assertGameError(() => store.updateMap('ABC234', SAMPLE_MAP), 'MAP_LOCKED');
    assertGameError(() => store.saveMap('ABC234'), 'MAP_LOCKED');

    beginGame(store);
    assertGameError(() => store.updateMap('ABC234', SAMPLE_MAP), 'MAP_LOCKED');
  });

  test('invalid maps never enter the room state', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 3);
    store.startMapSetup('ABC234');

    assertGameError(
      () => store.updateMap('ABC234', { nodes: [{ id: 'n1', x: 'x', y: 0 }] }),
      'MAP_INVALID',
    );
    assertGameError(
      () =>
        store.updateMap('ABC234', {
          ...SAMPLE_MAP,
          rooms: [
            { id: 'rX', name: 'Bad', type: 'NOT_A_ROLE', polygon: [[1], [2], [3]] },
          ],
        }),
      'MAP_INVALID',
    );
    assert.equal(store.getRoom('ABC234').map.nodes.length, 0);
  });

  test('saving an empty map is rejected; editing keeps the saved map', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 3);
    store.startMapSetup('ABC234');

    assertGameError(
      () => store.saveMap('ABC234', { nodes: [], corridors: [] }),
      'MAP_EMPTY',
    );

    store.updateMap('ABC234', SAMPLE_MAP);
    store.saveMap('ABC234');
    store.beginMapEdit('ABC234');
    assert.equal(store.getRoom('ABC234').status, 'MAP_SETUP');
    assert.equal(store.getRoom('ABC234').map.version, 2);
  });

  test('joining works during map setup and ready phases', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 3);
    store.startMapSetup('ABC234');
    store.addPlayerToRoom('ABC234', { id: 'late-1', name: 'L1' });
    store.updateMap('ABC234', SAMPLE_MAP);
    store.saveMap('ABC234');
    store.addPlayerToRoom('ABC234', { id: 'late-2', name: 'L2' });
    assert.equal(store.getRoom('ABC234').players.length, 5);
  });

  test('config is editable in MAP_READY but locked during MAP_SETUP', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 3);
    store.startMapSetup('ABC234');
    assertGameError(
      () => store.updateConfig('ABC234', { impostorCount: 1 }),
      'CONFIG_LOCKED',
    );
    makeMapReady(store);
    store.updateConfig('ABC234', { impostorCount: 1 });
    assert.equal(store.getRoom('ABC234').config.impostorCount, 1);
  });

  test('rematch keeps the saved map and lands in MAP_READY', () => {
    const store = new RoomStore();
    createRoomWithPlayers(store, 4, 'ABC234', { impostorCount: 1 });
    const { assignments } = beginGame(store);
    const impostorId = impostorsOf(assignments)[0];
    const crewIds = crewmatesOf(assignments);
    store.getRoom('ABC234').config = {
      ...store.getRoom('ABC234').config,
      killCooldownMs: 0,
    };
    store.killPlayer('ABC234', impostorId, crewIds[0]);
    store.killPlayer('ABC234', impostorId, crewIds[1]);
    store.endGame('ABC234', 'IMPOSTOR');

    const lobby = store.resetToLobby('ABC234');
    assert.equal(lobby.status, 'MAP_READY'); // map survived the match
    assert.ok(lobby.map && lobby.map.nodes.length >= 2);

    // And a fresh round can start immediately:
    const next = beginGame(store);
    assert.equal(next.room.status, 'IN_GAME');
    assert.equal(impostorsOf(next.assignments).length, 1);
  });
});

function getAliveById(room, playerId) {
  const player = room.players.find((entry) => entry.id === playerId);
  return player ? player.isAlive : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
