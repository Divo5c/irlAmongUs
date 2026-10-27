/* eslint-env browser */
/**
 * RLAUS Task-Minigames.
 * Registry per task type; each game mounts into the shared overlay and
 * calls done() when the crewmate finished it. Impostors get the same
 * games for their fake tasks \u2014 the toast on completion differs, the
 * mechanics do not.
 *
 * Exposed API:
 *   RlausTasks.launch(task, onComplete, onFail?)  \u2014 opens the overlay
 *   RlausTasks.isActive()                          \u2014 a game is open
 *   RlausTasks.close()                             \u2014 force-close
 */
(() => {
  let current = null; // { task, cleanup }

  // ---------------------------------------------------------------- utils //

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function shuffle(array) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /** Shared overlay shell: header + body; returns controller. */
  function openShell(titleText) {
    const overlay = document.createElement('div');
    overlay.className = 'task-overlay';
    const card = el('div', 'task-card');
    const header = el('div', 'task-head');
    const title = el('div', 'task-title', titleText);
    const closeBtn = el('button', 'task-close', '\u2715');
    header.append(title, closeBtn);
    const body = el('div', 'task-body');
    card.append(header, body);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    let closed = false;
    const cleanupFns = [];
    function close() {
      if (closed) return;
      closed = true;
      for (const fn of cleanupFns.splice(0)) {
        try { fn(); } catch { /* keep closing */ }
      }
      overlay.remove();
      if (current) current = null;
    }
    closeBtn.addEventListener('click', () => {
      window.RlausSfx?.('panel_close', 0.7);
      close();
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(20);
    });
    return {
      body,
      cleanup: (fn) => cleanupFns.push(fn),
      close,
      setTitle: (text) => { title.textContent = text; },
    };
  }

  /** Generic helper — progress bar readout row under the playfield. */
  function progressBar(container, color = '#ffd166') {
    const wrap = el('div', 'task-progress');
    const bar = el('div', 'task-progress-bar');
    wrap.appendChild(bar);
    container.appendChild(wrap);
    bar.style.background = color;
    return {
      set(fraction) {
        bar.style.width = `${Math.max(0, Math.min(100, fraction * 100))}%`;
      },
      node: wrap,
    };
  }

  function hint(container, text) {
    const node = el('div', 'task-hint', text);
    container.appendChild(node);
    return {
      update: (t) => { node.textContent = t; },
      error: (t) => {
        node.textContent = t;
        node.style.color = '#ef4444';
        setTimeout(() => {
          node.style.color = '';
        }, 900);
      },
    };
  }

  function done(container, cleanup, finish) {
    container.classList.add('task-done-flash');
    if (typeof finish === 'function') finish();
  }

  // ---------------------------------------------------------------- wiring //

  const WIRE_COLORS = [
    { id: 'red', hex: '#ef4444', glyph: '\u25B2' },
    { id: 'blue', hex: '#3b82f6', glyph: '\u2715' },
    { id: 'yellow', hex: '#facc15', glyph: '\u25CF' },
    { id: 'magenta', hex: '#e879f9', glyph: '\u2605' },
  ];

  /** Kurzer Alias fuer den App-Sound-Player (falls geladen). */
  const S = (name, volume = 1) => window.RlausSfx?.(name, volume);
  const WIRE_LINK_SOUNDS = ['wire1', 'wire2', 'wire3'];

  function mountWiring(shell, finish) {
    const { body } = shell;
    const leftOrder = shuffle(WIRE_COLORS);
    const rightOrder = shuffle(WIRE_COLORS);
    let connected = 0;

    const board = el('div', 'wire-board');
    const leftCol = el('div', 'wire-col');
    const rightCol = el('div', 'wire-col right');
    const leftEnds = new Map();
    for (const wire of leftOrder) {
      const node = el('div', 'wire-end');
      node.dataset.wire = wire.id;
      node.style.borderColor = wire.hex;
      node.style.background = wire.hex;
      node.textContent = wire.glyph;
      leftCol.appendChild(node);
      leftEnds.set(wire.id, node);
    }
    const sockets = new Map();
    for (const wire of rightOrder) {
      const node = el('div', 'wire-socket');
      node.dataset.wire = wire.id;
      node.style.borderColor = wire.hex;
      node.textContent = wire.glyph;
      rightCol.appendChild(node);
      sockets.set(wire.id, node);
    }
    board.append(leftCol, rightCol);
    body.appendChild(board);

    let dragFrom = null;
    const line = el('div', 'wire-line');
    document.body.appendChild(line);

    function pointerPos(event) {
      return { x: event.clientX, y: event.clientY };
    }
    function center(node) {
      const r = node.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    function moveLine(from, to) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy);
      line.style.display = 'block';
      line.style.left = `${from.x}px`;
      line.style.top = `${from.y}px`;
      line.style.width = `${len}px`;
      line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    }

    const handlerCleanup = [];
    function on(node, name, fn) {
      node.addEventListener(name, fn);
      handlerCleanup.push(() => node.removeEventListener(name, fn));
    }
    for (const [, node] of leftEnds) {
      on(node, 'pointerdown', (event) => {
        event.preventDefault();
        dragFrom = node.dataset.wire;
        node.setPointerCapture(event.pointerId);
        const start = center(node);
        moveLine(start, pointerPos(event));
      });
      on(node, 'pointermove', (event) => {
        if (dragFrom !== node.dataset.wire) return;
        moveLine(center(node), pointerPos(event));
      });
      on(node, 'pointerup', (event) => {
        if (dragFrom !== node.dataset.wire) return;
        dragFrom = null;
        line.style.display = 'none';
        const endNode = document.elementFromPoint(event.clientX, event.clientY);
        const socketNode = endNode?.closest?.('.wire-socket');
        if (!socketNode) return;
        if (socketNode.dataset.wire === node.dataset.wire
          && socketNode.classList.contains('connected') === false
          && sockets.get(socketNode.dataset.wire) === socketNode) {
          socketNode.classList.add('connected');
          socketNode.style.background = leftEnds.get(node.dataset.wire).style.background;
          leftEnds.get(node.dataset.wire).classList.add('used');
          connected += 1;
          S(WIRE_LINK_SOUNDS[Math.floor(Math.random() * WIRE_LINK_SOUNDS.length)], 0.8);
          if (connected === 4) {
            board.classList.add('task-done-flash');
            setTimeout(finish, 320);
          }
        }
      });
    }
    shell.cleanup(() => {
      handlerCleanup.forEach((fn) => fn());
      line.remove();
    });
  }

  // ------------------------------------------------------------ swipe card //

  function mountSwipeCard(shell, finish, setHint) {
    const { body } = shell;
    const track = el('div', 'swipe-track');
    const cardSlot = el('div', 'swipe-slot');
    const card = el('div', 'swipe-card', '\u2261 ID CARD');
    const reader = el('div', 'swipe-reader');
    track.append(reader, cardSlot);
    cardSlot.appendChild(card);
    body.appendChild(track);
    const progress = progressBar(body, '#4ade80');

    let startX = 0;
    let startTime = 0;
    let dragging = false;
    let currentX = 0;

    card.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      card.setPointerCapture(event.pointerId);
      S('card_move', 0.7);
      startX = event.clientX;
      currentX = 0;
      startTime = Date.now();
      dragging = true;
    });
    card.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      currentX = Math.max(0, Math.min(260, event.clientX - startX));
      card.style.transform = `translateX(${currentX}px)`;
      progress.set(currentX / 260);
    });
    card.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      const dt = Date.now() - startTime;
      if (currentX >= 250) {
        if (dt < 350) {
          S('card_deny', 0.9);
          setHint?.('Zu schnell! Karte zur\u00fcck.');
        } else if (dt > 2200) {
          S('card_deny', 0.9);
          setHint?.('Zu langsam! Karte zur\u00fcck.');
        } else {
          S('card_accept');
          card.classList.add('accepted');
          setTimeout(finish, 320);
          return;
        }
      } else if (currentX > 40) {
        setHint?.('Abgebrochen \u2014 zieh bis ganz zum Ende.');
      }
      card.style.transform = 'translateX(0)';
      progress.set(0);
      void card.offsetWidth;
      card.classList.remove('accepted');
    });
  }

  // ------------------------------------------------------------ upload data //

  function mountHoldToFill(shell, finish, setHint, {
    seconds = 6, label = 'HALTEN', color = '#4ade80', cancelable = true, sound = null,
  } = {}) {
    const { body } = shell;
    const button = el('button', 'task-hold-btn', label);
    body.appendChild(button);
    const progress = progressBar(body, color);
    let timer = null;
    let fraction = 0;

    function stop(cancel) {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      button.classList.remove('holding');
      if (cancel && cancelable) {
        fraction = 0;
        progress.set(0);
        setHint?.('Abgebrochen \u2014 halte durch!');
      }
    }
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      if (timer) return;
      if (sound) S(sound, 0.7);
      button.classList.add('holding');
      timer = setInterval(() => {
        fraction += 60 / (seconds * 1000);
        progress.set(fraction);
        if (fraction >= 1) {
          stop(false);
          setTimeout(finish, 200);
        }
      }, 60);
    });
    button.addEventListener('pointerup', () => stop(true));
    button.addEventListener('pointercancel', () => stop(true));
    shell.cleanup(() => {
      clearInterval(timer);
    });
  }

  // -------------------------------------------------- calibrate distributor //

  function mountCalibrateDistributor(shell, finish, setHint) {
    const { body } = shell;
    const colors = ['#facc15', '#3b82f6', '#22d3ee'];
    const names = ['Gelb', 'Blau', 'Cyan'];
    const field = el('div', 'calibrate-field');
    body.appendChild(field);
    const progress = progressBar(body, '#22d3ee');

    let round = 0;
    let angle = 0;
    let rotor = null;
    const RINGS = [];

    for (let index = 0; index < 3; index += 1) {
      const ring = el('div', 'calibrate-ring');
      ring.style.borderColor = colors[index];
      const arc = el('div', 'calibrate-arc');
      arc.style.background = colors[index];
      ring.appendChild(arc);
      const dot = el('div', 'calibrate-dot');
      ring.appendChild(dot);
      field.appendChild(ring);
      RINGS.push({ ring, arc, dot });
    }
    const pressBtn = el('button', 'task-tap-btn', 'CALIBRATE');
    body.appendChild(pressBtn);

    let active = true;
    const rotorTimer = setInterval(() => {
      angle = (angle - 5 + 360) % 360;
      rotorNode();
    }, 50);

    function zone() {
      return { from: 250, to: 310 };
    }
    function inZone() {
      const z = zone();
      return angle >= z.from && angle <= z.to;
    }
    function rotorNode() {
      for (const { dot } of RINGS) {
        dot.style.transform = `rotate(${angle}deg) translateY(-46px)`;
      }
    }
    pressBtn.addEventListener('click', () => {
      if (!active) return;
      if (inZone()) {
        RINGS[round].ring.classList.add('ok');
        round += 1;
        progress.set(round / 3);
        if (round >= 3) {
          active = false;
          setTimeout(finish, 260);
        }
      } else {
        RINGS[round].ring.classList.add('miss');
        setTimeout(() => RINGS[round].ring.classList.remove('miss'), 400);
        setHint?.('Verfehlt \u2014 Ring ' + (round + 1) + ' nochmal!');
      }
    });
    shell.cleanup(() => {
      active = false;
      clearInterval(rotorTimer);
    });
    rotorNode();
  }

  // --------------------------------------------------------- start reactor //

  function mountStartReactor(shell, finish, setHint) {
    const { body } = shell;
    const grid = el('div', 'memory-grid');
    body.appendChild(grid);
    const progress = progressBar(body, '#22d3ee');
    const cells = [];
    for (let index = 0; index < 9; index += 1) {
      const cell = el('button', 'memory-cell', String(index + 1));
      grid.appendChild(cell);
      cells.push(cell);
    }
    const ROUND_LENGTHS = [3, 4, 5];
    let round = 0;
    let sequence = [];
    let inputIndex = 0;
    let showing = true;

    function playSequence() {
      showing = true;
      inputIndex = 0;
      sequence = [];
      const pool = shuffle([...Array(9).keys()]);
      for (let i = 0; i < ROUND_LENGTHS[round]; i += 1) sequence.push(pool[i]);
      sequence.forEach((cellIndex, step) => {
        setTimeout(() => {
          cells[cellIndex].classList.add('lit');
          setTimeout(() => cells[cellIndex].classList.remove('lit'), 350);
        }, step * 500);
      });
      setTimeout(() => {
        showing = false;
      }, sequence.length * 500);
    }
    cells.forEach((cell, cellIndex) => {
      cell.addEventListener('click', () => {
        if (showing) return;
        if (cellIndex === sequence[inputIndex]) {
          cell.classList.add('ok');
          setTimeout(() => cell.classList.remove('ok'), 250);
          inputIndex += 1;
          if (inputIndex >= sequence.length) {
            round += 1;
            progress.set(round / ROUND_LENGTHS.length);
            if (round >= ROUND_LENGTHS.length) {
              setTimeout(finish, 260);
              return;
            }
            showing = true;
            setHint?.('Runde ' + (round + 1) + ' von 3');
            setTimeout(playSequence, 700);
          }
        } else {
          cell.classList.add('wrong');
          setTimeout(() => cell.classList.remove('wrong'), 350);
          showing = true;
          setHint?.('Falsch! Nochmal\u2026');
          setTimeout(playSequence, 600);
        }
      });
    });
    shell.cleanup(() => {});
    setHint?.('Runde 1 von 3');
    playSequence();
  }

  // ------------------------------------------------------ unlock manifolds //

  function mountUnlockManifolds(shell, finish, setHint) {
    const { body } = shell;
    const field = el('div', 'manifold-field');
    body.appendChild(field);
    const numbers = shuffle([...Array(10).keys()].map((n) => n + 1));
    let expected = 1;
    const nodes = new Map();
    for (const number of numbers) {
      const node = el('button', 'manifold-btn', String(number));
      node.dataset.number = number;
      field.appendChild(node);
      nodes.set(number, node);
      node.addEventListener('click', () => {
        if (Number(node.dataset.number) !== expected) {
          field.classList.add('task-error-flash');
          setTimeout(() => field.classList.remove('task-error-flash'), 400);
          expected = 1;
          for (const [, node2] of nodes) node2.classList.remove('ok');
          setHint?.('Falsche Reihenfolge \u2014 ab 1 neu!');
          return;
        }
        node.classList.add('ok');
        expected += 1;
        if (expected > 10) setTimeout(finish, 280);
      });
    }
  }

  // --------------------------------------------------------- enter id code //

  function mountEnterIdCode(shell, finish, setHint) {
    const { body } = shell;
    let code = '';
    for (let i = 0; i < 5; i += 1) code += String(Math.floor(Math.random() * 10));
    const card = el('div', 'id-card-note', code);
    body.appendChild(card);
    const display = el('div', 'id-display', '\u2014'.repeat(5));
    body.appendChild(display);
    const pad = el('div', 'id-pad');
    let typed = '';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '\u2713'];
    for (const key of keys) {
      const keyBtn = el('button', 'id-key', key);
      pad.appendChild(keyBtn);
      keyBtn.addEventListener('click', () => {
        if (key === 'C') {
          typed = '';
        } else if (key === '\u2713') {
          if (typed === code) {
            display.style.color = '#4ade80';
            setTimeout(finish, 280);
            return;
          }
          display.classList.add('bad');
          setTimeout(() => display.classList.remove('bad'), 500);
          typed = '';
          setHint?.('Falscher Code \u2014 nochmal!');
        } else if (typed.length < 5) {
          typed += key;
        }
        display.textContent = typed.padEnd(5, '\u2014');
      });
    }
    body.appendChild(pad);
  }

  // -------------------------------------------------------- reset breakers //

  function mountResetBreakers(shell, finish, setHint) {
    const { body } = shell;
    const field = el('div', 'breaker-row');
    body.appendChild(field);
    let expected = 1;
    const switches = [];
    for (let index = 1; index <= 7; index += 1) {
      const node = el('button', 'breaker', String(index));
      field.appendChild(node);
      switches.push(node);
      node.addEventListener('click', () => {
        const number = switches.indexOf(node) + 1;
        S('breaker', 0.7);
        if (number !== expected) {
          expected = 1;
          for (const sw of switches) sw.classList.remove('ok');
          setHint?.('Falsch \u2014 ab Sicherung 1 neu!');
          return;
        }
        node.classList.add('ok');
        node.textContent = '\u21CA';
        expected += 1;
        if (expected > 7) setTimeout(finish, 280);
      });
    }
  }

  // -------------------------------------------------------- chart course //

  function mountChartCourse(shell, finish) {
    const { body } = shell;
    const field = el('div', 'chart-field');
    body.appendChild(field);
    const ship = el('div', 'chart-ship', '\u25B6');
    const w = field.clientWidth || field.offsetWidth || 300;
    const h = field.clientHeight || 220;    const points = [];
    const COLS = 5;
    for (let col = 0; col < COLS; col += 1) {
      const offset = col % 2 === 0 ? 0.25 : 0.75;
      points.push({
        x: (w - 30) * (col / (COLS - 1)) + 15,
        y: h * offset,
      });
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'chart-line');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', points.map((p) => `${p.x},${p.y}`).join(' '));
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', 'rgba(255,255,255,0.35)');
    polyline.setAttribute('stroke-width', '3');
    polyline.setAttribute('stroke-dasharray', '7 5');
    svg.appendChild(polyline);
    field.appendChild(svg);
    points.forEach((p) => {
      const dot = el('div', 'chart-dot');
      dot.style.left = `${p.x - 4}px`;
      dot.style.top = `${p.y - 4}px`;
      field.appendChild(dot);
    });
    ship.style.left = `${points[0].x - 10}px`;
    ship.style.top = `${points[0].y - 10}px`;
    field.appendChild(ship);

    let waypoint = 1;
    let dragging = false;
    ship.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      ship.setPointerCapture(event.pointerId);
      dragging = true;
    });
    ship.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const rect = field.getBoundingClientRect();
      const x = Math.max(0, Math.min(w - 20, event.clientX - rect.left - 10));
      const y = Math.max(0, Math.min(h - 20, event.clientY - rect.top - 10));
      ship.style.left = `${x}px`;
      ship.style.top = `${y}px`;
      const target = points[waypoint];
      if (target && Math.hypot(target.x - x, target.y - y) < 16) {
        waypoint += 1;
        if (waypoint >= points.length) {
          dragging = false;
          ship.classList.add('ok');
          setTimeout(finish, 280);
        }
      }
    });
    ship.addEventListener('pointerup', () => {
      dragging = false;
      // Snap back if lost its way:
      const x = parseFloat(ship.style.left) || 0;
      const y = parseFloat(ship.style.top) || 0;
      const anchor = points[Math.max(0, waypoint - 1)];
      if (Math.hypot(anchor.x - x, anchor.y - y) > 40) {
        ship.style.left = `${anchor.x - 10}px`;
        ship.style.top = `${anchor.y - 10}px`;
      }
    });
  }

  // ---------------------------------------------------- clean o2 filter //

  function mountCleanO2Filter(shell, finish) {
    const { body } = shell;
    const field = el('div', 'o2field');
    const hole = el('div', 'o2-hole', '\u2B07 FEINSTAUB-ABFALL');
    body.append(field, hole);
    let swept = 0;
    for (let index = 0; index < 6; index += 1) {
      const leaf = el('div', 'o2-leaf', '\u{1F343}');
      leaf.style.left = `${10 + (index % 3) * 32}%`;
      leaf.style.top = `${10 + Math.floor(index / 3) * 40}%`;
      field.appendChild(leaf);
      let dragging = false;
      leaf.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        leaf.setPointerCapture(event.pointerId);
        S('o2_grab', 0.6);
        dragging = true;
      });
      leaf.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        const rect = field.getBoundingClientRect();
        leaf.style.left = `${event.clientX - rect.left - 14}px`;
        leaf.style.top = `${event.clientY - rect.top - 14}px`;
      });
      leaf.addEventListener('pointerup', (event) => {
        if (!dragging) return;
        dragging = false;
        const holeRect = hole.getBoundingClientRect();
        if (event.clientY >= holeRect.top - 20) {
          S('o2_drop', 0.8);
          leaf.style.display = 'none';
          hole.classList.add('flash');
          setTimeout(() => hole.classList.remove('flash'), 240);
          swept += 1;
          if (swept === 6) setTimeout(finish, 250);
        }
      });
    }
  }

  // ------------------------------------------------------- empty garbage //

  function mountEmptyGarbage(shell, finish) {
    const { body } = shell;
    const leverWrap = el('div', 'lever-wrap');
    const lever = el('div', 'lever', '\u2193');
    leverWrap.appendChild(lever);
    body.appendChild(leverWrap);
    let startY = null;
    let pulled = 0;
    lever.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      lever.setPointerCapture(event.pointerId);
      startY = event.clientY;
    });
    lever.addEventListener('pointermove', (event) => {
      if (startY == null) return;
      pulled = Math.max(0, Math.min(120, event.clientY - startY));
      lever.style.transform = `translateY(${pulled}px)`;
    });
    lever.addEventListener('pointerup', () => {
      if (pulled >= 110) {
        lever.classList.add('ok');
        setTimeout(finish, 300);
      } else {
        lever.style.transform = 'translateY(0)';
      }
      startY = null;
    });
  }

  // -------------------------------------------------------- divert power //

  function mountDivertPower(shell, finish, setHint) {
    const { body } = shell;
    const rooms = shuffle(['Cafeteria', 'Nav', 'Weapons', 'O2', 'Shields', 'Reactor', 'Storage', 'Admin']);
    const target = rooms[2];
    const panel = el('div', 'divert-row');
    const sliderRow = el('div', 'divert-slider-row');
    body.append(panel, sliderRow);
    const slider = el('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(rooms.length - 1);
    slider.value = '0';
    slider.step = '1';
    sliderRow.appendChild(slider);
    const label = el('div', 'divert-label', '');
    body.appendChild(label);
    function refresh() {
      const index = Number(slider.value);
      label.textContent = `Umleitung \u2192 ${rooms[index]}`;
      label.classList.toggle('ok', rooms[index] === target);
    }
    slider.addEventListener('input', refresh);
    slider.addEventListener('change', () => S('power_switch', 0.8));
    refresh();
    const acceptBtn = el('button', 'task-tap-btn', '\u26A1 POWER ANNEHMEN');
    body.appendChild(acceptBtn);
    acceptBtn.addEventListener('click', () => {
      if (rooms[Number(slider.value)] !== target) {
        setHint?.('Falscher Raum \u2014 gesucht: ???');
        setHint?.(`Das Ziel war ${target}. Nochmal!`);
        return;
      }
      setTimeout(finish, 200);
    });
    body.appendChild(el('div', 'task-hint', `Zielraum: ${target}`));
  }

  // -------------------------------------------------- align engine output //

  function mountAlignEngine(shell, finish) {
    const { body } = shell;
    const gaugeWrap = el('div', 'engine-wrap');
    const reference = el('div', 'engine-ref');
    const needle = el('div', 'engine-needle', '\u25C4');
    gaugeWrap.append(reference, needle);
    body.appendChild(gaugeWrap);
    let dragging = false;
    needle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      needle.setPointerCapture(event.pointerId);
      dragging = true;
    });
    needle.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const wrapRect = gaugeWrap.getBoundingClientRect();
      const y = Math.max(0, Math.min(wrapRect.height - 10, event.clientY - wrapRect.top - 5));
      needle.style.top = `${y}px`;
    });
   needle.addEventListener('pointerup', (event) => {
      dragging = false;
      const wrapRect = gaugeWrap.getBoundingClientRect();
      const refRect = reference.getBoundingClientRect();
      const delta = Math.abs((refRect.top + refRect.height / 2) - (event.clientY));
      if (delta <= 12) {
        needle.classList.add('ok');
        setTimeout(finish, 280);
      } else {
        needle.style.top = '50%';
      }
    });
  }

  // ------------------------------------------------- stabilize steering //

  function mountStabilizeSteering(shell, finish) {
    const { body } = shell;
    const field = el('div', 'steer-field');
    const target = el('div', 'steer-target', '\u25CE');
    const cross = el('div', 'steer-cross', '\u271D');
    field.append(target, cross);
    body.appendChild(field);
    let dragging = false;
    cross.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      cross.setPointerCapture(event.pointerId);
      dragging = true;
    });
    cross.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const rect = field.getBoundingClientRect();
      cross.style.left = `${event.clientX - rect.left - 14}px`;
      cross.style.top = `${event.clientY - rect.top - 14}px`;
    });
    cross.addEventListener('pointerup', () => {
      dragging = false;
      const cRect = cross.getBoundingClientRect();
      const tRect = target.getBoundingClientRect();
      const dx = (cRect.left + cRect.width / 2) - (tRect.left + tRect.width / 2);
      const dy = (cRect.top + cRect.height / 2) - (tRect.top + tRect.height / 2);
      if (Math.hypot(dx, dy) < 14) {
        cross.classList.add('ok');
        setTimeout(finish, 260);
      }
    });
  }

  // ------------------------------------------------------ clear asteroids //

  function mountClearAsteroids(shell, finish, setHint) {
    const { body } = shell;
    const GOAL = 12;
    const field = el('div', 'asteroid-field');
    body.appendChild(field);
    const progress = progressBar(body, '#7dd3fc');
    let hits = 0;
    let alive = true;
    shell.cleanup(() => {
      alive = false;
    });

    function spawn() {
      if (!alive) return;
      const rock = el('div', 'asteroid', '\u{1FAA8}');
      const startY = Math.random() * 80 + 10;
      rock.style.top = `${startY}%`;
      field.appendChild(rock);
      let x = 105;
      const speed = 0.55 + Math.random() * 0.75;
      const timer = setInterval(() => {
        x -= speed;
        rock.style.left = `${x}%`;
        if (x < -8) {
          clearInterval(timer);
          rock.remove();
        }
      }, 40);
      rock._timer = timer;
      rock.addEventListener('click', () => {
        clearInterval(rock._timer);
        rock.remove();
        hits += 1;
        progress.set(hits / GOAL);
        if (hits >= GOAL && alive) setTimeout(finish, 200);
      });
      shell.cleanup(() => clearInterval(timer));
    }
    const spawner = setInterval(spawn, 700);
    spawn();
    shell.cleanup(() => clearInterval(spawner));
  }

  // -------------------------------------------------------- prime shields //

  function mountPrimeShields(shell, finish) {
    const { body } = shell;
    const field = el('div', 'shield-grid');
    body.appendChild(field);
    const active = new Set();
    const cells = [];
    for (let index = 0; index < 7; index += 1) {
      const cell = el('button', 'shield-hex', '');
      if (Math.random() < 0.75 || index < 1) {
        cell.classList.add('lit');
        active.add(index);
      }
      field.appendChild(cell);
      cells.push(cell);
      cell.addEventListener('click', () => {
        if (!cell.classList.contains('lit')) return;
        cell.classList.add('ok');
        active.delete(index);
        if (active.size === 0 && [...cells].every((c) => !c.classList.contains('lit'))) {
          setTimeout(finish, 280);
        }
      });
    }
  }

  // ---------------------------------------------------- inspect sample //

  function mountInspectSample(shell, finish, setHint) {
    const { body } = shell;
    const row = el('div', 'sample-row');
    body.appendChild(row);
    const vials = [];
    const anomaly = Math.floor(Math.random() * 5);
    for (let index = 0; index < 5; index += 1) {
      const vial = el('div', 'sample-vial', '\u2B21');
      vial.dataset.index = index;
      row.appendChild(vial);
      vials.push(vial);
    }
    const startBtn = el('button', 'task-tap-btn', '\u25B6 Analyse starten');
    body.appendChild(startBtn);
    const hintNode = hint(body, 'Dr\u00fccke Start, warte auf Ergebnis.');
    let timer = null;

    startBtn.addEventListener('click', () => {
      if (timer) clearInterval(timer);
      let remaining = 8;
      hintNode.update(`Scan l\u00e4uft\u2026 ${remaining}s`);
      timer = setInterval(() => {
        remaining -= 1;
        if (remaining > 0) {
          hintNode.update(`Scan l\u00e4uft\u2026 ${remaining}s`);
          return;
        }
        clearInterval(timer);
        timer = null;
        vials[anomaly].classList.add('anomaly');
        hintNode.update('Anomalie gefunden \u2014 tippe die rote Probe!');
        vials.forEach((vial) => {
          vial.addEventListener('click', () => {
            if (!vial.classList.contains('anomaly')) {
              hintNode.error('Falsche Probe \u2014 Analyse neu starten.');
              return;
            }
            setTimeout(finish, 240);
          }, { once: true });
        });
      }, 1000);
    });
    shell.cleanup(() => {
      clearInterval(timer);
    });
  }

  // --------------------------------------------------------- submit scan //

  function mountSubmitScan(shell, finish, setHint) {
    const { body } = shell;
    const stage = el('div', 'scan-stage');
    const figure = el('div', 'scan-figure', '\u{1F464}');
    stage.appendChild(figure);
    body.appendChild(stage);
    const progress = progressBar(body, '#4ade80');
    let remaining = 12;
    let timer = null;
    const hintNode = hint(body, `Scan l\u00e4uft\u2026 ${remaining}s`);
    timer = setInterval(() => {
      remaining -= 1;
      progress.set((12 - remaining) / 12);
      hintNode.update(`Scan l\u00e4uft\u2026 ${remaining}s`);
      if (remaining <= 0) {
        clearInterval(timer);
        setTimeout(finish, 200);
      }
    }, 1000);
    shell.cleanup(() => {
      clearInterval(timer);
    });
  }

  // ------------------------------------------------------------------ registry //

  const GAME_BUILDERS = {
    fix_wiring: mountWiring,
    swipe_card: mountSwipeCard,
    upload_data: (shell, finish, setHint) => mountHoldToFill(
      shell, finish, setHint, { seconds: 6, label: '\u2B06 HALTEN \u2014 UPLOAD', color: '#4ade80' },
    ),
    fuel_engines: (shell, finish, setHint) => mountHoldToFill(
      shell, finish, setHint, { seconds: 5, label: '\u26FD HALTEN \u2014 TANKEN', color: '#facc15', sound: 'fuel' },
    ),
    calibrate_distributor: mountCalibrateDistributor,
    start_reactor: mountStartReactor,
    unlock_manifolds: mountUnlockManifolds,
    enter_id_code: mountEnterIdCode,
    reset_breakers: mountResetBreakers,
    chart_course: mountChartCourse,
    clean_o2_filter: mountCleanO2Filter,
    empty_garbage: mountEmptyGarbage,
    divert_power: mountDivertPower,
    align_engine: mountAlignEngine,
    stabilize_steering: mountStabilizeSteering,
    clear_asteroids: mountClearAsteroids,
    prime_shields: mountPrimeShields,
    inspect_sample: mountInspectSample,
    submit_scan: mountSubmitScan,
  };

  // ------------------------------------------------------------------- API //

  function launch(task, onComplete) {
    if (current) current.close();
    const finish = () => {
      const cleanup = current;
      current = null;
      cleanup?.close();
      if (typeof onComplete === 'function') onComplete(task);
    };
    const shell = openShell(task.title ?? 'Minigame');
    const setHintFn = (text) => {
      let node = shell.body.querySelector('.task-hint:last-child');
      if (!node || node._mode === 'done') {
        node = hint(shell.body, text);
        node._mode = 'hint';
        return;
      }
      node.textContent = text;
    };
    let hintNodeRef = null;
    const hintFn = Object.assign((text) => {
      if (!hintNodeRef || hintNodeRef.dataset.dead === '1') {
        hintNodeRef = hint(shell.body, text);
        return hintNodeRef;
      }
      hintNodeRef.update(text);
      return hintNodeRef;
    }, {
      error(text) {
        if (!hintNodeRef || hintNodeRef.dataset.dead === '1') {
          hintNodeRef = hint(shell.body, text);
        } else {
          hintNodeRef.error(text);
        }
      },
    });
    current = { task, close: shell.close };
    const builder = GAME_BUILDERS[task.type];
    if (!builder) {
      // Unknown type \u2014 instant-close fallback.
      shell.body.appendChild(hint(shell.body, 'Kein Minigame f\u00fcr diesen Task \u2014 nur \u201cUse\u201d am Ort \u2611'));
      const okBtn = el('button', 'task-tap-btn', '\u2713 Erledigt');
      okBtn.addEventListener('click', finish);
      shell.body.appendChild(okBtn);
      return shell;
    }
    builder(shell, finish, hintFn);
    return shell;
  }

  function isActive() {
    return !!current;
  }

  window.RlausTasks = { launch, isActive, close: () => current?.close() };
})();
