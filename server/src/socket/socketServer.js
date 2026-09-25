const { Server } = require('socket.io');

const { RoomStoreError } = require('../rooms/roomStore');

function createSocketServer(httpServer, roomStore, { disconnectGraceMs = 30_000 } = {}) {
  const io = new Server(httpServer);
  const meetingTimers = new Map();
  const pendingDisconnects = new Map();

  /**
   * Tracks the primary socket per room/player pair. Rejoins take the entry
   * over (and kick the old socket), so a stale disconnect can never remove
   * the player that just took the identity over.
   */
  const primarySockets = new Map();

  function primaryKey(code, playerId) {
    return `${code}|${playerId}`;
  }

  function bindSocketToPlayer(socket, code, playerId) {
    const key = primaryKey(code, playerId);
    const pendingDisconnect = pendingDisconnects.get(key);
    if (pendingDisconnect) {
      clearTimeout(pendingDisconnect);
      pendingDisconnects.delete(key);
    }
    for (const existing of io.of('/').sockets.values()) {
      if (
        existing.id !== socket.id &&
        existing.data.roomCode === code &&
        existing.data.playerId === playerId
      ) {
        // Takeover: drop the previous socket for this identity.
        primarySockets.delete(key);
        existing.data.roomCode = null;
        existing.data.playerId = null;
        existing.disconnect(true);
      }
    }
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = playerId;
    primarySockets.set(key, socket.id);
  }

  io.on('connection', (socket) => {

    socket.on('room:create', (payload) => {
      try {
        const room = roomStore.createRoom(payload ?? {});
        bindSocketToPlayer(socket, room.code, room.hostId);
        socket.emit('room:created', roomStore.toPublicRoom(room));
        emitSessionCreated(socket, room.code, room.hostId);
      } catch (error) {
        emitRoomError(socket, error);
      }
    });

    socket.on('room:join', (payload) => {
      try {
        const { code, playerId, playerName } = payload ?? {};
        const room = roomStore.addPlayerToRoom(code, {
          id: playerId,
          name: playerName,
        });
        bindSocketToPlayer(socket, code, playerId);
        io.to(code).emit('room:updated', roomStore.toPublicRoom(room));
        emitSessionCreated(socket, code, playerId);
      } catch (error) {
        emitRoomError(socket, error);
      }
    });

    /**
     * Re-attaches a client to its game after a reconnect or app restart.
     * Public state (config, meeting phase/deadlines, killReadyAt) arrives
     * via the public projection; roles/tasks are restored privately while
     * the game is running.
     */
    socket.on('room:rejoin', (payload) => {
      try {
        const { code, playerId, token } = payload ?? {};

        if (!roomStore.verifyToken(code, playerId, token)) {
          throw new RoomStoreError(
            'AUTH_FAILED',
            'Rejoin was rejected; the session is no longer valid.',
          );
        }

        const room = roomStore.getRoom(code);
        if (!room || !room.players.some(({ id }) => id === playerId)) {
          throw new RoomStoreError('ROOM_NOT_FOUND', 'Room not found.');
        }

        bindSocketToPlayer(socket, code, playerId);

        const publicRoom = roomStore.toPublicRoom(room);
        socket.emit('room:rejoined', { ...publicRoom, playerId });
        socket.emit('room:updated', publicRoom);

        if (room.status === 'IN_GAME' || room.status === 'MEETING') {
          const player = getPlayer(room, playerId);
          if (player) {
            socket.emit('game:role_assigned', buildRolePayload(room, playerId));
          }
        }
      } catch (error) {
        emitRoomError(socket, error);
      }
    });

    socket.on('game:start', (payload) => {
      try {
        const { code } = payload ?? {};
        const room = roomStore.getRoom(code);

        if (!room) {
          throw new RoomStoreError('ROOM_NOT_FOUND', 'Room not found.');
        }

        if (socket.data.roomCode !== code || socket.data.playerId !== room.hostId) {
          throw new RoomStoreError('NOT_ROOM_HOST', 'Only the room host can start the game.');
        }

        const {
          assignments,
          teammatesByPlayer,
          tasksByPlayer,
          room: publicRoom,
        } = roomStore.startGame(code);

        // Everyone receives the public room only (no roles, no task details).
        io.to(code).emit('room:updated', publicRoom);
        io.to(code).emit('game:started', publicRoom);

        // Each player privately receives role, tasks and impostor teammates.
        for (const [playerId, role] of Object.entries(assignments)) {
          emitToPlayer(code, playerId, 'game:role_assigned', {
            code,
            playerId,
            role,
            teammates: teammatesByPlayer[playerId] ?? [],
            tasks: tasksByPlayer[playerId] ?? [],
            killReadyAt: 0,
          });
        }
      } catch (error) {
        emitRoomError(socket, error);
      }
    });

    // ------------------------------------------------------- map setup //
    // The host is the map EDITOR, but the server stays the single source of
    // truth: every mutation is validated and broadcast via room:updated.

    socket.on('map:start', (payload) => {
      try {
        const { code } = payload ?? {};
        assertSocketInRoom(socket, code);
        assertHost(socket, code);
        const publicRoom = roomStore.startMapSetup(code);
        io.to(code).emit('room:updated', publicRoom);
      } catch (error) {
        emitRoomError(socket, error);
      }
    });

    /** Atomic full-map snapshot from the host while editing. */
    socket.on('map:update', (payload) => {
      try {
        const { code, map } = payload ?? {};
        assertSocketInRoom(socket, code);
        assertHost(socket, code);
        const publicRoom = roomStore.updateMap(code, map);
        io.to(code).emit('room:updated', publicRoom);
      } catch (error) {
        emitRoomError(socket, error);
      }
    });

    /** Validates + persists the map and opens the game start. */
    socket.on('map:save', (payload) => {
      try {
        const { code, map } = payload ?? {};
        assertSocketInRoom(socket, code);
        assertHost(socket, code);
        const publicRoom = roomStore.saveMap(code, map);
        io.to(code).emit('room:updated', publicRoom);
        io.to(code).emit('map:saved', {
          code,
          version: publicRoom.map?.version ?? 1,
          status: 'MAP_READY',
        });
      } catch (error) {
        emitRoomError(socket, error);
      }
    });

    /** Host reopens a saved map for editing (MAP_READY -> MAP_SETUP). */
    socket.on('map:edit', (payload) => {
      try {
        const { code } = payload ?? {};
        assertSocketInRoom(socket, code);
        assertHost(socket, code);
        const publicRoom = roomStore.beginMapEdit(code);
        io.to(code).emit('room:updated', publicRoom);
      } catch (error) {
        emitRoomError(socket, error);
      }
    });

    /** Host-only settings change; only possible in LOBBY. */
    socket.on('game:update_config', (payload) => {
      try {
        const { code, config } = payload ?? {};
        assertSocketInRoom(socket, code);
        assertHost(socket, code);

        const room = roomStore.updateConfig(code, config);
        io.to(code).emit('room:updated', roomStore.toPublicRoom(room));
      } catch (error) {
        emitRoomError(socket, error);
      }
    });

    /** Host-only rematch: resets a finished game back into the lobby. */
    socket.on('game:reset', (payload) => {
      try {
        const { code } = payload ?? {};
        assertSocketInRoom(socket, code);
        assertHost(socket, code);

        clearMeetingTimer(code);
        const publicRoom = roomStore.resetToLobby(code);
        io.to(code).emit('room:updated', publicRoom);
        io.to(code).emit('game:reset_done', { code, status: 'LOBBY' });
      } catch (error) {
        emitRoomError(socket, error);
      }
    });

    socket.on('task:complete', (payload) => {
      try {
        const { code, taskId } = payload ?? {};
        assertSocketInRoom(socket, code);

        // playerId comes from socket data; clients cannot complete tasks
        // for other players.
        const result = roomStore.completeTask(code, socket.data.playerId, taskId);

        io.to(code).emit('room:updated', result.room);
        io.to(code).emit('task:progress', {
          code,
          completedTaskId: result.completedTaskId,
          progress: result.progress,
        });

        if (result.winner) {
          broadcastGameOver(io, code, result.winner);
        }
      } catch (error) {
        emitRoomError(socket, error);
      }
    });

    socket.on('game:report', (payload) => {
      try {
        const { code } = payload ?? {};
        assertSocketInRoom(socket, code);

        const result = roomStore.reportBody(code, socket.data.playerId);
        const meeting = result.room;

        io.to(code).emit('room:updated', meeting);
        io.to(code).emit('game:meeting_started', {
          code,
          status: 'MEETING',
          phase: result.phase,
          reporterId: result.reporterId,
          players: meeting.players,
          discussionDeadline: result.discussionDeadline,
        });

        armNextMeetingTimer(code);
      } catch (error) {
        emitRoomError(socket, error);
      }
    });

    socket.on('game:vote_cast', (payload) => {
      try {
        const { code, targetId, skip } = payload ?? {};
        assertSocketInRoom(socket, code);

        // voterId comes from socket data; clients cannot vote for others
        // and each player can vote at most once (enforced in the store).
        const result = roomStore.castVote(code, socket.data.playerId, {
          targetId,
          skip: skip === true,
        });

        io.to(code).emit('room:updated', result.room);
        io.to(code).emit('game:vote_progress', {
          code,
          votedCount: result.votedCount,
          totalVoters: result.totalVoters,
        });

        if (result.everyoneVoted) {
          advanceAndBroadcast(code);
        }
      } catch (error) {
        emitRoomError(socket, error);
      }
    });

    socket.on('game:kill', (payload) => {
      try {
        const { code, targetPlayerId } = payload ?? {};
        assertSocketInRoom(socket, code);

        const result = roomStore.killPlayer(
          code,
          socket.data.playerId,
          targetPlayerId,
        );

        // The victims are public; the killer's identity stays hidden.
        io.to(code).emit('room:updated', result.room);
        io.to(code).emit('game:killed', {
          code,
          killedPlayerId: result.killedPlayerId,
        });

        // Synchronized cooldown info for every impostor (private).
        const cooldownMs = roomStore.getRequiredRoom(code).config.killCooldownMs;
        if (cooldownMs > 0) {
          const killReadyAt = Date.now() + cooldownMs;
          for (const [playerId, role] of Object.entries(
            getRolesSnapshot(roomStore.getRequiredRoom(code)),
          )) {
            if (role === 'IMPOSTOR') {
              emitToPlayer(code, playerId, 'game:kill_cooldown', {
                code,
                killReadyAt,
              });
            }
          }
        }

        if (result.winner) {
          broadcastGameOver(io, code, result.winner);
        }
      } catch (error) {
        emitRoomError(socket, error);
      }
    });

    // ---------------------------------------------------- position update //

    /**
     * Clients send their estimated position. Server validates, runs map
     * matching, and stores the authoritative result. Only the owning
     * socket receives the confirmed position back (privacy).
     */
    socket.on('position:update', (payload) => {
      try {
        const { code, ...estimate } = payload ?? {};
        assertSocketInRoom(socket, code);

        const result = roomStore.updatePosition(code, socket.data.playerId, estimate);

        // Send confirmed position only back to the sender (privacy)
        socket.emit('position:confirmed', {
          code,
          ...result.position,
          roomId: result.roomId,
          onCorridor: result.onCorridor,
        });

        // Broadcast to admin room if any admin is tracking
        if (roomStore.isAdmin(code, socket.data.playerId) || io.sockets.adapter.rooms.has(`admin:${code}`)) {
          const positions = roomStore.getAdminPositions(code);
          io.to(`admin:${code}`).emit('admin:positions', { code, positions });
        }
      } catch (error) {
        // Position errors are non-fatal — don't spam the client
        if (error instanceof RoomStoreError) {
          socket.emit('position:error', {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          });
        }
      }
    });

    // ---------------------------------------------------- admin tracking //

    /**
     * Host authenticates for admin tracking with a PIN.
     * On success, the socket joins the admin room for position broadcasts.
     */
    socket.on('admin:authenticate', (payload) => {
      try {
        const { code, pin } = payload ?? {};
        assertSocketInRoom(socket, code);

        const room = roomStore.getRoom(code);
        if (!room || socket.data.playerId !== room.hostId) {
          throw new RoomStoreError('NOT_ROOM_HOST', 'Only the host can become admin.');
        }

        roomStore.authenticateAdmin(code, socket.data.playerId, pin);
        socket.join(`admin:${code}`);
        socket.emit('admin:authenticated', { code, success: true });
      } catch (error) {
        emitRoomError(socket, error);
      }
    });

    /**
     * Host sets a custom admin PIN. Only the host can set this.
     * The PIN is hashed server-side before storage.
     */
    socket.on('admin:set-pin', (payload) => {
      try {
        const { code, pin } = payload ?? {};
        assertSocketInRoom(socket, code);

        const room = roomStore.getRoom(code);
        if (!room || socket.data.playerId !== room.hostId) {
          throw new RoomStoreError('NOT_ROOM_HOST', 'Only the host can set the admin PIN.');
        }

        roomStore.setAdminPin(code, socket.data.playerId, pin);
        socket.emit('admin:pin-set', { code, success: true });
      } catch (error) {
        emitRoomError(socket, error);
      }
    });

    /**
     * Request current admin positions. Only works if authenticated.
     */
    socket.on('admin:track', (payload) => {
      try {
        const { code } = payload ?? {};
        assertSocketInRoom(socket, code);

        if (!roomStore.isAdmin(code, socket.data.playerId)) {
          throw new RoomStoreError('ADMIN_REQUIRED', 'Admin authentication required.');
        }

        const positions = roomStore.getAdminPositions(code);
        socket.emit('admin:positions', { code, positions });
      } catch (error) {
        emitRoomError(socket, error);
      }
    });

    socket.on('disconnect', () => {
      handleDisconnect(socket);
    });
  });

  function emitSessionCreated(socket, code, playerId) {
    socket.emit('session:created', {
      code,
      playerId,
      token: roomStore.issueToken(code, playerId),
    });
  }

  function getPlayer(room, playerId) {
    return room.players.find(({ id }) => id === playerId) ?? null;
  }

  function getRolesSnapshot(room) {
    return Object.fromEntries(room.players.map(({ id, role }) => [id, role]));
  }

  function buildRolePayload(room, playerId) {
    const player = getPlayer(room, playerId);
    return {
      code: room.code,
      playerId,
      role: player.role,
      teammates:
        player.role === 'IMPOSTOR'
          ? room.players
              .filter((other) => other.role === 'IMPOSTOR' && other.id !== playerId)
              .map(({ id, name }) => ({ id, name }))
          : [],
      tasks: roomStore
        .getTasksForPlayer(room.code, playerId)
        .map(({ id, type, title }) => ({ id, type, title })),
      // 0 = kill available; otherwise epoch ms when the next kill unlocks.
      killReadyAt:
        room.status === 'IN_GAME' && (room.lastKillAt ?? 0) > 0
          ? room.lastKillAt + room.config.killCooldownMs
          : 0,
    };
  }

  function assertHost(socket, code) {
    const room = roomStore.getRoom(code);
    if (!room || socket.data.playerId !== room.hostId) {
      throw new RoomStoreError('NOT_ROOM_HOST', 'Only the room host can do this.');
    }
  }

  function handleDisconnect(socket) {
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !playerId) {
      return; // never bound to a room
    }

    const key = primaryKey(roomCode, playerId);
    if (primarySockets.get(key) !== socket.id) {
      return; // a newer socket owns this identity now
    }
    primarySockets.delete(key);

    const room = roomStore.getRoom(roomCode);
    if (
      !room ||
      ['IN_GAME', 'MEETING', 'GAME_OVER'].includes(room.status)
    ) return;

    const timer = setTimeout(() => {
      pendingDisconnects.delete(key);
      if (primarySockets.has(key) || !roomStore.getRoom(roomCode)) return;

      const outcome = roomStore.removePlayer(roomCode, playerId);
      if (outcome.deleted) {
        clearMeetingTimer(roomCode);
      } else if (outcome.removed && outcome.room) {
        io.to(roomCode).emit('room:updated', outcome.room);
      }
    }, disconnectGraceMs);
    timer.unref();
    pendingDisconnects.set(key, timer);
  }

  function emitToPlayer(code, playerId, event, payload) {
    for (const socket of io.of('/').sockets.values()) {
      if (
        socket.data.roomCode === code &&
        socket.data.playerId === playerId
      ) {
        socket.emit(event, payload);
      }
    }
  }

  function clearMeetingTimer(code) {
    const timer = meetingTimers.get(code);
    if (timer) {
      clearTimeout(timer);
      meetingTimers.delete(code);
    }
  }

  /**
   * Schedules the next phase transition of an active meeting based on its
   * stored deadlines (robust against drift and stale timers).
   */
  function armNextMeetingTimer(code) {
    clearMeetingTimer(code);
    const room = roomStore.getRoom(code);
    if (!room || !room.meeting) {
      return;
    }

    const now = Date.now();
    const target =
      room.meeting.phase === 'DISCUSSION'
        ? Date.parse(room.meeting.discussionEndsAt)
        : Date.parse(room.meeting.votingEndsAt);

    const delay = Math.max(0, target - now);
    const timer = setTimeout(() => {
      meetingTimers.delete(code);
      try {
        advanceAndBroadcast(code);
      } catch (error) {
        console.error(`Meeting tick failed for room ${code}:`, error.message);
      }
    }, delay);
    timer.unref(); // never keep the process alive just for this timer
    meetingTimers.set(code, timer);
  }

  /**
   * Advances an active meeting one step (DISCUSSION -> VOTING -> RESULT)
   * and broadcasts accordingly. Used by timers and by "everyone voted".
   */
  function advanceAndBroadcast(code) {
    clearMeetingTimer(code);
    const result = roomStore.advanceMeeting(code);

    if (result.type === 'PHASE') {
      io.to(code).emit('room:updated', result.room);
      io.to(code).emit('game:voting_started', {
        code,
        votingDeadline: result.votingDeadline,
      });
      armNextMeetingTimer(code);
      return;
    }

    broadcastMeetingResult(io, code, result);
  }

  function broadcastMeetingResult(ioInstance, code, result) {
    const gameOver = result.winner ? roomStore.endGame(code, result.winner) : null;

    ioInstance.to(code).emit('game:meeting_result', {
      code,
      ejectedPlayerId: result.ejectedPlayerId,
      ejectedPlayerName: result.ejectedPlayerName ?? null,
      // The store already omits the tally for anonymous voting.
      ...(result.tally ? { tally: result.tally } : {}),
      status: gameOver ? 'GAME_OVER' : 'IN_GAME',
      ...(result.winner ? { winner: result.winner } : {}),
    });

    if (gameOver) {
      ioInstance.to(code).emit('room:updated', gameOver.room);
      ioInstance.to(code).emit('game:over', {
        code,
        status: 'GAME_OVER',
        winner: gameOver.winner,
        players: gameOver.room.players,
      });
    } else {
      ioInstance.to(code).emit('room:updated', result.room);
    }
  }

  function broadcastGameOver(ioInstance, code, winner) {
    clearMeetingTimer(code);
    const { room, winner: confirmedWinner } = roomStore.endGame(code, winner);
    // Roles are revealed to everyone once the game is over.
    ioInstance.to(code).emit('room:updated', room);
    ioInstance.to(code).emit('game:over', {
      code,
      status: 'GAME_OVER',
      winner: confirmedWinner,
      players: room.players,
    });
  }

  return io;
}

function assertSocketInRoom(socket, code) {
  if (!code || typeof code !== 'string') {
    throw new RoomStoreError('INVALID_ROOM', 'A room code is required.');
  }

  if (socket.data.roomCode !== code || !socket.data.playerId) {
    throw new RoomStoreError(
      'NOT_IN_ROOM',
      'You must join this room before performing game actions.',
    );
  }
}

function emitRoomError(socket, error) {
  if (error instanceof RoomStoreError) {

    socket.emit('room:error', {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }

  console.error('Unhandled socket event failure:', error.message);
  socket.emit('room:error', {
    code: 'INTERNAL_ERROR',
    message: 'Unable to process the room request.',
  });
}

module.exports = { createSocketServer };
