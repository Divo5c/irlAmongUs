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
import { avatar, browserStorage, buttonArt, icon } from './ui.js';
import { localText, roomLabel, t, taskStageLabel, taskTitle } from './i18n.js';

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
  function openShell(titleText, onClose) {
    const overlay = document.createElement('div');
    overlay.className = 'task-overlay task-overlay--game';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', titleText);
    const card = el('div', 'task-card');
    const header = el('div', 'task-head');
    const title = el('div', 'task-title', titleText);
    title.appendChild(el('small', 'ghost-context', t('ghost.status')));
    const closeBtn = el('button', 'task-close');
    closeBtn.setAttribute('aria-label', localText('Aufgabe schließen', "Close task"));
    closeBtn.append(buttonArt('close'));
    header.append(title, closeBtn);
    const body = el('div', 'task-body');
    card.append(header, body);
    overlay.appendChild(card);
    const previousFocus = document.activeElement;
    document.body.appendChild(overlay);
    closeBtn.focus({ preventScroll: true });
    let closed = false;
    const cleanupFns = [];
    const timeouts = new Set();
    function close() {
      if (closed) return;
      closed = true;
      onClose();
      timeouts.forEach(clearTimeout);
      timeouts.clear();
      for (const fn of cleanupFns.splice(0)) {
        try { fn(); } catch { /* keep closing */ }
      }
      overlay.remove();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    }
    closeBtn.addEventListener('click', () => {
      window.RlausSfx?.('panel_close', 0.7);
      close();
      if (browserStorage.getItem('rlaus_vibration') !== 'false') navigator.vibrate?.(20);
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      closeBtn.click();
    });
    return {
      body,
      cleanup: (fn) => cleanupFns.push(fn),
      close,
      delay(fn, ms) {
        const timer = setTimeout(() => {
          timeouts.delete(timer);
          if (!closed) fn();
        }, ms);
        timeouts.add(timer);
      },
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
        bar.style.setProperty('--progress', Math.max(0, Math.min(1, fraction)));
      },
      node: wrap,
    };
  }

  function hint(container, text) {
    const node = el('div', 'task-hint', text);
    node.setAttribute('role', 'status');
    container.appendChild(node);
    return {
      update: (t) => {
        node.classList.remove('bad');
        node.textContent = t;
      },
      error: (t) => {
        node.textContent = t;
        node.classList.add('bad');
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
        if (dragFrom || node.classList.contains('used') || !event.isPrimary) return;
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
            shell.delay(finish, 320);
          }
        }
      });
      on(node, 'lostpointercapture', () => {
        if (dragFrom !== node.dataset.wire) return;
        dragFrom = null;
        line.style.display = 'none';
      });
    }
    shell.cleanup(() => {
      handlerCleanup.forEach((fn) => fn());
      line.remove();
    });
  }

  // ------------------------------------------------------------ swipe card //

  function mountSwipeCard(shell, finish) {
    const { body } = shell;
    const track = el('div', 'swipe-track');
    const reader = el('div', 'swipe-reader', localText('Ziel', "End"));
    const card = el('button', 'swipe-card');
    card.type = 'button';
    card.setAttribute('aria-label', localText('Crew-Ausweis. Leertaste etwa eine Sekunde halten und loslassen.', "Crew ID. Hold Space for about a second, then release."));
    card.append(avatar('cyan'), el('span', '', localText('Crew-Ausweis', "Crew ID")));
    const directions = el('div', 'swipe-directions');
    directions.append(el('span', '', 'Start'), el('span', '', localText('Wischrichtung →', "Swipe →")), el('span', '', localText('Leser', "Reader")));
    track.append(reader, card);
    body.append(directions, track);
    const progress = progressBar(body, 'var(--signal-ok)');
    const status = hint(body, localText('Zieh den Ausweis gleichmäßig nach rechts bis zum Leser.', "Swipe the card steadily to the right until it reaches the reader."));
    let attempt = null;

    function begin(pointerId, x = 0) {
      if (attempt || card.disabled) return false;
      attempt = { pointerId, x, startedAt: performance.now() };
      status.update(localText('Bis zum Leser durchziehen, dann loslassen.', "Swipe all the way to the reader, then release."));
      S('card_move', 0.7);
      return true;
    }

    function move(fraction) {
      const distance = Math.max(0, track.clientWidth - card.offsetWidth);
      card.style.transform = `translateX(${fraction * distance}px)`;
      progress.set(fraction);
    }

    function fractionAt(clientX) {
      const distance = track.clientWidth - card.offsetWidth;
      if (distance <= 0) return 0;
      const scale = track.getBoundingClientRect().width / track.offsetWidth;
      return Math.max(0, Math.min(1, (clientX - attempt.x) / scale / distance));
    }

    function cancel(message) {
      attempt = null;
      move(0);
      status.error(message);
    }

    function release(fraction) {
      const elapsed = performance.now() - attempt.startedAt;
      const error = fraction < 0.94 ? localText('Zu kurz. Zieh die Karte bis zum Leser am rechten Rand.', "Too short. Swipe the card to the reader on the right.")
        : elapsed < 300 ? localText('Zu schnell. Wische beim nächsten Versuch etwas langsamer.', "Too fast. Swipe a little slower next time.")
        : elapsed > 2200 ? localText('Zu langsam. Zieh die Karte in einer gleichmäßigen Bewegung durch.', "Too slow. Swipe the card in one steady motion.")
        : null;
      if (error) {
        S('card_deny', 0.9);
        cancel(error);
        return;
      }
      attempt = null;
      move(1);
      card.disabled = true;
      card.classList.add('accepted');
      status.update(localText('Ausweis akzeptiert ✓', "Card accepted ✓"));
      S('card_accept');
      shell.delay(finish, 320);
    }

    card.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !begin(event.pointerId, event.clientX)) return;
      event.preventDefault();
      card.setPointerCapture(event.pointerId);
    });
    card.addEventListener('pointermove', (event) => {
      if (attempt?.pointerId === event.pointerId) move(fractionAt(event.clientX));
    });
    card.addEventListener('pointerup', (event) => {
      if (attempt?.pointerId === event.pointerId) release(fractionAt(event.clientX));
    });
    card.addEventListener('lostpointercapture', (event) => {
      if (attempt?.pointerId === event.pointerId) cancel(localText('Wischversuch unterbrochen. Versuch es noch einmal.', "Swipe interrupted. Try again."));
    });
    card.addEventListener('keydown', (event) => {
      if (event.code !== 'Space') return;
      event.preventDefault();
      if (!event.repeat && begin('keyboard')) status.update(localText('Leertaste nach etwa einer Sekunde loslassen.', "Release Space after about a second."));
    });
    card.addEventListener('keyup', (event) => {
      if (event.code !== 'Space') return;
      event.preventDefault();
      if (attempt?.pointerId === 'keyboard') release(1);
    });
    card.addEventListener('blur', () => {
      if (attempt?.pointerId === 'keyboard') cancel(localText('Wischversuch unterbrochen. Versuch es noch einmal.', "Swipe interrupted. Try again."));
    });
  }

  // ------------------------------------------------------------ upload data //

  function mountHoldToFill(shell, finish, setHint, {
    seconds = 6, label = localText('Halten', "Hold"), color = '#4ade80', sound = null,
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
      if (cancel) {
        fraction = 0;
        progress.set(0);
        setHint?.(localText('Abgebrochen \u2014 halte durch!', "Interrupted. Keep holding to finish."));
      }
    }
    function start() {
      if (timer || button.disabled) return;
      if (sound) S(sound, 0.7);
      button.classList.add('holding');
      timer = setInterval(() => {
        fraction += 60 / (seconds * 1000);
        progress.set(fraction);
        if (fraction >= 1) {
          stop(false);
          button.disabled = true;
          shell.delay(finish, 200);
        }
      }, 60);
    }
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      start();
    });
    button.addEventListener('pointerup', () => stop(true));
    button.addEventListener('lostpointercapture', () => stop(true));
    button.addEventListener('keydown', (event) => {
      if (event.code === 'Space') {
        event.preventDefault();
        if (!event.repeat) start();
      }
    });
    button.addEventListener('keyup', (event) => {
      if (event.code === 'Space') stop(true);
    });
    button.addEventListener('blur', () => stop(true));
    shell.cleanup(() => {
      clearInterval(timer);
    });
  }

  // -------------------------------------------------- calibrate distributor //

  function mountCalibrateDistributor(shell, finish, setHint) {
    const { body } = shell;
    const colors = ['#facc15', '#3b82f6', '#22d3ee'];
    const field = el('div', 'calibrate-field');
    body.appendChild(field);
    const progress = progressBar(body, '#22d3ee');

    let round = 0;
    let angle = 0;
    const RINGS = [];

    for (let index = 0; index < 3; index += 1) {
      const ring = el('div', 'calibrate-ring');
      ring.style.borderColor = colors[index];
      const arc = el('div', 'calibrate-arc');
      arc.style.background = colors[index];
      placeMarker(arc, 280);
      ring.appendChild(arc);
      const dot = el('div', 'calibrate-dot');
      ring.appendChild(dot);
      field.appendChild(ring);
      RINGS.push({ ring, arc, dot });
    }
    RINGS[0].ring.classList.add('active');
    const pressBtn = el('button', 'task-tap-btn', localText('Kalibrieren', "Calibrate"));
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
    function placeMarker(node, degrees) {
      const radians = degrees * Math.PI / 180;
      node.style.left = `${50 + Math.sin(radians) * 45}%`;
      node.style.top = `${50 - Math.cos(radians) * 45}%`;
    }
    function rotorNode() {
      if (active) placeMarker(RINGS[round].dot, angle);
    }
    pressBtn.addEventListener('click', () => {
      if (!active) return;
      const { ring } = RINGS[round];
      if (inZone()) {
        ring.classList.add('ok');
        ring.classList.remove('active', 'miss');
        round += 1;
        progress.set(round / 3);
        if (round >= 3) {
          active = false;
          shell.delay(finish, 260);
        } else {
          RINGS[round].ring.classList.add('active');
          rotorNode();
        }
      } else {
        ring.classList.add('miss');
        shell.delay(() => ring.classList.remove('miss'), 400);
        setHint?.(localText('Verfehlt \u2014 Ring ', "Missed — try ring ") + (round + 1) + localText(' nochmal!', " again!"));
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
        shell.delay(() => {
          cells[cellIndex].classList.add('lit');
          shell.delay(() => cells[cellIndex].classList.remove('lit'), 350);
        }, step * 500);
      });
      shell.delay(() => {
        showing = false;
      }, sequence.length * 500);
    }
    cells.forEach((cell, cellIndex) => {
      cell.addEventListener('click', () => {
        if (showing) return;
        if (cellIndex === sequence[inputIndex]) {
          cell.classList.add('ok');
          shell.delay(() => cell.classList.remove('ok'), 250);
          inputIndex += 1;
          if (inputIndex >= sequence.length) {
            round += 1;
            progress.set(round / ROUND_LENGTHS.length);
            if (round >= ROUND_LENGTHS.length) {
              showing = true;
              shell.delay(finish, 260);
              return;
            }
            showing = true;
            setHint?.(localText('Runde ', "Round ") + (round + 1) + localText(' von 3', " of 3"));
            shell.delay(playSequence, 700);
          }
        } else {
          cell.classList.add('wrong');
          shell.delay(() => cell.classList.remove('wrong'), 350);
          showing = true;
          setHint?.(localText('Falsch! Nochmal\u2026', "Wrong sequence. Try again…"));
          shell.delay(playSequence, 600);
        }
      });
    });
    setHint?.(localText('Runde 1 von 3', "Round 1 of 3"));
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
          shell.delay(() => field.classList.remove('task-error-flash'), 400);
          expected = 1;
          for (const [, node2] of nodes) node2.classList.remove('ok');
          setHint?.(localText('Falsche Reihenfolge \u2014 ab 1 neu!', "Wrong order. Start again from 1."));
          return;
        }
        node.classList.add('ok');
        expected += 1;
        if (expected > 10) shell.delay(finish, 280);
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
            shell.delay(finish, 280);
            return;
          }
          display.classList.add('bad');
          shell.delay(() => display.classList.remove('bad'), 500);
          typed = '';
          setHint?.(localText('Falscher Code \u2014 nochmal!', "Wrong code. Try again."));
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
          switches.forEach((sw, i) => {
            sw.classList.remove('ok');
            sw.textContent = String(i + 1);
          });
          setHint?.(localText('Falsch \u2014 ab Sicherung 1 neu!', "Wrong order. Start again at breaker 1."));
          return;
        }
        node.classList.add('ok');
        node.textContent = '\u21CA';
        expected += 1;
        if (expected > 7) shell.delay(finish, 280);
      });
    }
  }

  // -------------------------------------------------------- chart course //

  function mountChartCourse(shell, finish) {
    const { body } = shell;
    const field = el('div', 'chart-field');
    body.appendChild(field);
    const ship = el('div', 'chart-ship', '\u25B6');
    const points = Array.from({ length: 5 }, (_, i) => ({
      x: 8 + i * 21, y: i % 2 === 0 ? 25 : 75,
    }));
    function place(node, point) {
      node.style.left = `${point.x}%`;
      node.style.top = `${point.y}%`;
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'chart-line');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', points.map((p) => `${p.x},${p.y}`).join(' '));
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', 'rgba(255,255,255,0.35)');
    polyline.setAttribute('stroke-width', '3');
    polyline.setAttribute('stroke-dasharray', '7 5');
    polyline.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(polyline);
    field.appendChild(svg);
    const dots = points.map((p) => {
      const dot = el('div', 'chart-dot');
      place(dot, p);
      field.appendChild(dot);
      return dot;
    });
    place(ship, points[0]);
    field.appendChild(ship);

    let waypoint = 1;
    let pointerId = null;
    ship.addEventListener('pointerdown', (event) => {
      if (pointerId !== null || waypoint === points.length || event.button !== 0) return;
      event.preventDefault();
      ship.setPointerCapture(event.pointerId);
      pointerId = event.pointerId;
    });
    ship.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId) return;
      const rect = field.getBoundingClientRect();
      const x = Math.max(5, Math.min(95, (event.clientX - rect.left) / rect.width * 100));
      const y = Math.max(10, Math.min(90, (event.clientY - rect.top) / rect.height * 100));
      place(ship, { x, y });
      const target = points[waypoint];
      const dx = (target.x - x) / 100 * rect.width;
      const dy = (target.y - y) / 100 * rect.height;
      if (Math.hypot(dx, dy) < 18) {
        dots[waypoint].classList.add('visited');
        waypoint += 1;
        if (waypoint >= points.length) {
          pointerId = null;
          place(ship, target);
          ship.classList.add('ok');
          shell.delay(finish, 280);
        }
      }
    });
    ship.addEventListener('lostpointercapture', (event) => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      place(ship, points[waypoint - 1]);
    });
  }

  // ---------------------------------------------------- clean o2 filter //

  function mountCleanO2Filter(shell, finish) {
    const { body } = shell;
    const field = el('div', 'o2field');
    const hole = el('div', 'o2-hole');
    const label = el('span', '', localText('↓ Blätter hierhin ziehen', '↓ Drag leaves here'));
    const count = el('span', '', '0 / 6');
    count.setAttribute('role', 'status');
    hole.append(label, count);
    field.appendChild(hole);
    body.appendChild(field);
    let swept = 0;
    for (let index = 0; index < 6; index += 1) {
      const leaf = el('div', 'o2-leaf');
      leaf.append(icon('leaf'));
      const startX = `${18 + (index % 3) * 32}%`;
      const startY = `${19 + Math.floor(index / 3) * 30}%`;
      leaf.style.left = startX;
      leaf.style.top = startY;
      field.appendChild(leaf);
      let pointerId = null;
      function reset() {
        pointerId = null;
        leaf.style.left = startX;
        leaf.style.top = startY;
        leaf.classList.remove('dragging');
      }
      function collect(clientY) {
        if (clientY < hole.getBoundingClientRect().top) return false;
        pointerId = null;
        leaf.remove();
        S('o2_drop', 0.8);
        hole.classList.add('flash');
        shell.delay(() => hole.classList.remove('flash'), 240);
        swept += 1;
        count.textContent = `${swept} / 6`;
        if (swept === 6) shell.delay(finish, 250);
        return true;
      }
      leaf.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || pointerId !== null) return;
        event.preventDefault();
        leaf.setPointerCapture(event.pointerId);
        S('o2_grab', 0.6);
        pointerId = event.pointerId;
        leaf.classList.add('dragging');
      });
      leaf.addEventListener('pointermove', (event) => {
        if (pointerId !== event.pointerId || collect(event.clientY)) return;
        const rect = field.getBoundingClientRect();
        leaf.style.left = `${(event.clientX - rect.left) / rect.width * 100}%`;
        leaf.style.top = `${(event.clientY - rect.top) / rect.height * 100}%`;
      });
      leaf.addEventListener('pointerup', (event) => {
        if (pointerId === event.pointerId && !collect(event.clientY)) reset();
      });
      leaf.addEventListener('lostpointercapture', (event) => {
        if (pointerId === event.pointerId) reset();
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
    let drag = null;
    function progressAt(clientY) {
      const travel = leverWrap.clientHeight - lever.offsetHeight;
      if (travel <= 0) return 0;
      const scale = leverWrap.getBoundingClientRect().height / leverWrap.offsetHeight;
      return Math.max(0, Math.min(1, (clientY - drag.y) / scale / travel));
    }
    function move(fraction) {
      lever.style.transform = `translateY(${fraction * (leverWrap.clientHeight - lever.offsetHeight)}px)`;
    }
    lever.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || drag || lever.classList.contains('ok')) return;
      event.preventDefault();
      lever.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, y: event.clientY };
    });
    lever.addEventListener('pointermove', (event) => {
      if (drag?.id === event.pointerId) move(progressAt(event.clientY));
    });
    lever.addEventListener('pointerup', (event) => {
      if (drag?.id !== event.pointerId) return;
      if (progressAt(event.clientY) >= 0.9) {
        move(1);
        lever.classList.add('ok');
        shell.delay(finish, 300);
      } else {
        move(0);
      }
      drag = null;
    });
    lever.addEventListener('lostpointercapture', (event) => {
      if (drag?.id !== event.pointerId) return;
      drag = null;
      move(0);
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
      label.textContent = localText(`Umleitung \u2192 ${roomLabel(rooms[index])}`, `Divert to → ${roomLabel(rooms[index])}`);
      label.classList.toggle('ok', rooms[index] === target);
    }
    slider.addEventListener('input', refresh);
    slider.addEventListener('change', () => S('power_switch', 0.8));
    refresh();
    const acceptBtn = el('button', 'task-tap-btn', localText('\u26A1 POWER ANNEHMEN', "Confirm room"));
    body.appendChild(acceptBtn);
    acceptBtn.addEventListener('click', () => {
      if (rooms[Number(slider.value)] !== target) {
        setHint?.(localText(`Falscher Raum. Wähle ${roomLabel(target)} und bestätige erneut.`, `Wrong room. Select ${roomLabel(target)} and confirm again.`));
        return;
      }
      shell.delay(finish, 200);
    });
    body.appendChild(el('div', 'task-hint', localText(`Zielraum: ${roomLabel(target)}`, `Target room: ${roomLabel(target)}`)));
  }

  // -------------------------------------------------- align engine output //

  function mountAlignEngine(shell, finish) {
    const { body } = shell;
    const gaugeWrap = el('div', 'engine-wrap');
    const reference = el('div', 'engine-ref');
    const needle = el('div', 'engine-needle', '\u25C4');
    gaugeWrap.append(reference, needle);
    body.appendChild(gaugeWrap);
    let pointerId = null;
    needle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || pointerId !== null || needle.classList.contains('ok')) return;
      event.preventDefault();
      needle.setPointerCapture(event.pointerId);
      pointerId = event.pointerId;
    });
    needle.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId) return;
      const wrapRect = gaugeWrap.getBoundingClientRect();
      const y = (event.clientY - wrapRect.top) / wrapRect.height * 100;
      needle.style.top = `${Math.max(15, Math.min(85, y))}%`;
    });
    needle.addEventListener('pointerup', (event) => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      const refRect = reference.getBoundingClientRect();
      const delta = Math.abs((refRect.top + refRect.height / 2) - (event.clientY));
      if (delta <= 12) {
        needle.style.top = '50%';
        needle.classList.add('ok');
        shell.delay(finish, 280);
      } else {
        needle.style.top = '';
      }
    });
    needle.addEventListener('lostpointercapture', (event) => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      needle.style.top = '';
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
    let pointerId = null;
    function reset() {
      pointerId = null;
      cross.style.left = '';
      cross.style.top = '';
    }
    cross.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || pointerId !== null || cross.classList.contains('ok')) return;
      event.preventDefault();
      cross.setPointerCapture(event.pointerId);
      pointerId = event.pointerId;
    });
    cross.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId) return;
      const rect = field.getBoundingClientRect();
      cross.style.left = `${(event.clientX - rect.left) / rect.width * 100}%`;
      cross.style.top = `${(event.clientY - rect.top) / rect.height * 100}%`;
    });
    cross.addEventListener('pointerup', (event) => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      const cRect = cross.getBoundingClientRect();
      const tRect = target.getBoundingClientRect();
      const dx = (cRect.left + cRect.width / 2) - (tRect.left + tRect.width / 2);
      const dy = (cRect.top + cRect.height / 2) - (tRect.top + tRect.height / 2);
      if (Math.hypot(dx, dy) < 14) {
        cross.classList.add('ok');
        shell.delay(finish, 260);
      } else {
        reset();
      }
    });
    cross.addEventListener('lostpointercapture', (event) => {
      if (pointerId === event.pointerId) reset();
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
      const rock = el('button', 'asteroid');
      rock.setAttribute('aria-label', localText('Asteroid treffen', "Hit asteroid"));
      rock.append(icon('rock'));
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
        if (hits >= GOAL && alive) shell.delay(finish, 200);
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
    for (let index = 0; index < 7; index += 1) {
      const cell = el('button', 'shield-hex', '');
      if (Math.random() < 0.75 || index < 1) {
        cell.classList.add('lit');
        active.add(index);
      }
      cell.disabled = !active.has(index);
      cell.setAttribute('aria-label', localText(`Schild ${index + 1}`, `Shield ${index + 1}`));
      field.appendChild(cell);
      cell.addEventListener('click', () => {
        if (!cell.classList.contains('lit')) return;
        cell.classList.remove('lit');
        cell.classList.add('ok');
        cell.disabled = true;
        cell.setAttribute('aria-label', localText(`Schild ${index + 1} aktiviert`, `Shield ${index + 1} activated`));
        active.delete(index);
        if (active.size === 0) {
          shell.delay(finish, 280);
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
      const vial = el('button', 'sample-vial', String(index + 1));
      vial.disabled = true;
      vial.setAttribute('aria-label', localText(`Probe ${index + 1}`, `Sample ${index + 1}`));
      row.appendChild(vial);
      vials.push(vial);
    }
    const startBtn = el('button', 'task-tap-btn', localText('\u25B6 Analyse starten', "▶ Start analysis"));
    body.appendChild(startBtn);
    const hintNode = hint(body, localText('Dr\u00fccke Start, warte auf Ergebnis.', "Start the analysis and wait for the result."));
    let timer = null;

    startBtn.addEventListener('click', () => {
      startBtn.disabled = true;
      let remaining = 8;
      hintNode.update(localText(`Scan l\u00e4uft\u2026 ${remaining}s`, `Scanning… ${remaining}s`));
      timer = setInterval(() => {
        remaining -= 1;
        if (remaining > 0) {
          hintNode.update(localText(`Scan l\u00e4uft\u2026 ${remaining}s`, `Scanning… ${remaining}s`));
          return;
        }
        clearInterval(timer);
        timer = null;
        vials[anomaly].classList.add('anomaly');
        vials[anomaly].setAttribute('aria-label', localText(`Probe ${anomaly + 1}: Anomalie`, `Sample ${anomaly + 1}: anomaly`));
        vials.forEach((vial) => { vial.disabled = false; });
        hintNode.update(localText(`Anomalie in Probe ${anomaly + 1}. Wähle die markierte Probe.`, `Anomaly in sample ${anomaly + 1}. Select the highlighted sample.`));
      }, 1000);
    });
    for (const [index, vial] of vials.entries()) {
      vial.addEventListener('click', () => {
        if (index !== anomaly) {
          hintNode.error(localText(`Wähle die markierte Probe ${anomaly + 1}.`, `Select the highlighted sample ${anomaly + 1}.`));
          return;
        }
        vials.forEach((entry) => { entry.disabled = true; });
        hintNode.update(localText('Anomalie bestätigt ✓', "Anomaly confirmed ✓"));
        shell.delay(finish, 240);
      });
    }
    shell.cleanup(() => {
      clearInterval(timer);
    });
  }

  // --------------------------------------------------------- submit scan //

  function mountSubmitScan(shell, finish, setHint) {
    const { body } = shell;
    const stage = el('div', 'scan-stage');
    const figure = el('div', 'scan-figure');
    figure.append(avatar('cyan'));
    stage.appendChild(figure);
    body.appendChild(stage);
    const progress = progressBar(body, '#4ade80');
    let remaining = 12;
    let timer = null;
    const hintNode = hint(body, localText(`Scan l\u00e4uft\u2026 ${remaining}s`, `Scanning… ${remaining}s`));
    timer = setInterval(() => {
      remaining -= 1;
      progress.set((12 - remaining) / 12);
      hintNode.update(localText(`Scan l\u00e4uft\u2026 ${remaining}s`, `Scanning… ${remaining}s`));
      if (remaining <= 0) {
        clearInterval(timer);
        shell.delay(finish, 200);
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
    upload_data: (shell, finish, setHint, task) => mountHoldToFill(
      shell, finish, setHint, {
        seconds: 6,
        label: (task.stageIndex ?? 0) === 0 && task.stages?.length > 1
          ? localText('Gedrückt halten zum Herunterladen', "Hold to download") : localText('Gedrückt halten zum Hochladen', "Hold to upload"),
      },
    ),
    fuel_engines: (shell, finish, setHint) => mountHoldToFill(
      shell, finish, setHint, { seconds: 5, label: localText('Gedrückt halten zum Tanken', "Hold to refuel"), color: '#facc15', sound: 'fuel' },
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

  const TASK_INSTRUCTIONS = {
    fix_wiring: ["Zieh jedes Kabel links zum Anschluss mit demselben Symbol rechts.","Drag each wire on the left to the matching symbol on the right."],
    inspect_sample: ["Starte die Analyse und wähle danach die markierte Probe.","Start the analysis, then select the highlighted sample."],
    calibrate_distributor: ["Tippe auf „Kalibrieren“, sobald der weiße Punkt die farbige Markierung erreicht.","Tap “Calibrate” when the white dot reaches the colored marker."],
    start_reactor: ["Merke dir die aufleuchtenden Felder und tippe sie in derselben Reihenfolge an.","Remember the flashing tiles, then tap them in the same order."],
    chart_course: ["Zieh das Schiff nacheinander durch alle Punkte der gestrichelten Route.","Drag the ship through each point on the dashed route in order."],
    clean_o2_filter: ["Zieh alle sechs Blätter in den Sammelschacht am unteren Rand.","Drag all six leaves into the waste chute at the bottom."],
    empty_garbage: ["Zieh den Hebel bis zum unteren Anschlag.","Pull the lever all the way down."],
    divert_power: ["Wähle mit dem Regler den angezeigten Zielraum und bestätige.","Use the slider to select the target room, then confirm."],
    align_engine: ["Zieh den blauen Zeiger auf die waagerechte Markierung.","Drag the blue pointer onto the horizontal mark."],
    stabilize_steering: ["Zieh das blaue Fadenkreuz in die Mitte des gestrichelten Rings.","Drag the blue crosshair into the center of the dashed ring."],
    clear_asteroids: ["Tippe auf zwölf Asteroiden, bevor sie aus dem Feld fliegen.","Tap twelve asteroids before they leave the field."],
    prime_shields: ["Tippe alle markierten Felder an, um sie zu aktivieren.","Tap every highlighted tile to activate it."],
    submit_scan: ["Warte hier, bis der Scan abgeschlossen ist.","Wait here until the scan is complete."],
    unlock_manifolds: ["Tippe die Zahlen in der Reihenfolge 1 bis 10 an.","Tap the numbers in order from 1 to 10."],
    enter_id_code: ["Gib den fünfstelligen Code von der Karte ein und tippe auf ✓.","Enter the five-digit code from the card and tap ✓."],
    reset_breakers: ["Tippe die Sicherungen in der Reihenfolge 1 bis 7 an.","Tap the breakers in order from 1 to 7."],
  };

  // ------------------------------------------------------------------- API //

  function launch(task, onComplete) {
    current?.close();
    const title = taskStageLabel(task.stageLabels?.[task.stageIndex ?? 0]) ?? taskTitle(task);
    const shell = openShell(title, () => {
      if (current === session) current = null;
    });
    const session = { close: shell.close };
    current = session;
    const finish = () => {
      if (current !== session) return;
      session.close();
      if (typeof onComplete === 'function') onComplete(task);
    };
    const builder = GAME_BUILDERS[task.type];
    if (!builder) {
      hint(shell.body, localText('Bestätige den Kontrollpunkt, um die Aufgabe abzuschließen.', "Confirm the checkpoint to finish the task."));
      const okBtn = el('button', 'task-tap-btn', localText('Kontrollpunkt bestätigen', "Confirm checkpoint"));
      okBtn.addEventListener('click', finish);
      shell.body.appendChild(okBtn);
      return shell;
    }
    const instructions = TASK_INSTRUCTIONS[task.type];
    if (instructions) shell.body.appendChild(el('p', 'task-instructions', localText(...instructions)));
    let feedback;
    builder(shell, finish, (message) => {
      feedback ??= hint(shell.body, '');
      feedback.update(message);
    }, task);
    return shell;
  }

  function isActive() {
    return !!current;
  }

  window.RlausTasks = { launch, isActive, close: () => current?.close() };
})();
