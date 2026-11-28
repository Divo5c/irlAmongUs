import { buttonArt, element } from './ui.js';

export function createSabotagePanel({ t, tones, vibrate, notify, currentPanel }) {
  let view;
  let dialog;
  const HEARTBEAT_MS = 500;

  function send(entry, action, fields, callback) {
    const { socket, code, roundId, panelId } = entry;
    if (!socket.connected) return;
    socket.timeout(2500).emit(`game:sabotage_panel_${action}`, { code, roundId, panelId, ...fields }, (error, reply) => {
      if (view !== entry || !callback) return;
      callback(error ? { ok: false } : reply);
    });
  }

  function release() {
    if (!view?.holding) return;
    view.holding = false;
    view.holdToken = null;
    view.holdConfirmed = false;
    view.hand?.classList.remove('is-held');
    clearInterval(view.heartbeat);
    showStatus(view.status);
    send(view, 'hold', { active: false });
  }

  function close() {
    if (!view) return;
    const entry = view;
    release();
    send(entry, 'close');
    clearTimeout(entry.closeTimer);
    clearTimeout(entry.retryTimer);
    view = undefined;
    if (dialog?.open) dialog.close();
    entry.opener?.focus();
  }

  function bindHand(entry, hand) {
    function hold() {
      if (view !== entry || entry.holding || entry.done || !entry.socket.connected) return;
      entry.holding = true;
      const holdToken = Symbol();
      entry.holdToken = holdToken;
      hand.classList.add('is-held');
      vibrate(25);
      const heartbeat = () => {
        tones([92], 190, 0.13);
        if (entry.progress > 0) vibrate(15);
        send(entry, 'hold', { active: true }, (reply) => {
          if (entry.holdToken !== holdToken || reply?.ignored) return;
          if (reply?.ok) {
            entry.holdConfirmed = true;
            showStatus(entry.status);
          } else if (reply?.error === 'SABOTAGE_NOT_AT_PANEL') {
            close();
          } else {
            release();
            notify(t('panel.unavailable'));
          }
        });
      };
      heartbeat();
      entry.heartbeat = setInterval(heartbeat, HEARTBEAT_MS);
    }

    hand.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || entry.holding) return;
      hand.setPointerCapture(event.pointerId);
      hold();
    });
    hand.addEventListener('pointermove', (event) => {
      const r = hand.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) release();
    });
    for (const event of ['pointerup', 'pointerleave', 'pointercancel', 'lostpointercapture', 'blur']) {
      hand.addEventListener(event, release);
    }
    hand.addEventListener('contextmenu', (event) => event.preventDefault());
    hand.addEventListener('keydown', (event) => {
      if (event.code !== 'Space' && event.code !== 'Enter') return;
      event.preventDefault();
      if (!event.repeat) hold();
    });
    hand.addEventListener('keyup', (event) => {
      if (event.code === 'Space' || event.code === 'Enter') release();
    });
  }

  function oxygenKeys(entry, keyboard) {
    entry.digits = '';
    function press(key) {
      if (entry.done || entry.locked) return;
      tones([470], 45, 0.28);
      if (key === '✓') {
        if (!entry.digits) return;
        entry.locked = true;
        send(entry, 'submit', { digits: entry.digits }, (reply) => {
          if (entry.done) return;
          if (reply?.ok && reply.result === 'OK') {
            showStatus(reply.status);
          } else if (reply?.ok && reply.result === 'BAD') {
            entry.display.textContent = 'BAD';
            entry.display.dataset.result = 'bad';
            entry.retryTimer = setTimeout(() => {
              entry.digits = '';
              entry.display.textContent = '';
              delete entry.display.dataset.result;
              entry.locked = false;
            }, Math.max(1000, reply.retryInMs ?? 0));
          } else {
            entry.locked = false;
            notify(t('panel.unavailable'));
          }
        });
        return;
      }
      if (key === '×') entry.digits = '';
      else if (entry.digits.length < 5) entry.digits += key;
      entry.display.textContent = entry.digits;
    }
    for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '×', '0', '✓']) {
      const button = element('button', 'sab-key', key);
      button.type = 'button';
      if (key === '×' || key === '✓') {
        button.dataset.action = key === '×' ? 'clear' : 'submit';
        button.setAttribute('aria-label', t(key === '×' ? 'panel.clear' : 'panel.submit'));
      }
      button.addEventListener('click', () => press(key));
      keyboard.append(button);
    }
    keyboard.addEventListener('keydown', (event) => {
      const key = event.key === 'Backspace' || event.key === 'Delete' ? '×' : event.key;
      if (/^[0-9×]$/.test(key)) {
        event.preventDefault();
        press(key);
      }
    });
  }

  function showStatus(status) {
    const entry = view;
    if (!entry?.display || status?.roundId !== entry.roundId) return;
    entry.status = status;
    entry.progress = status.progress;
    const own = status.panels.find(({ id }) => id === entry.panelId)?.state;
    const partner = status.panels.some(({ id, state }) => id !== entry.panelId && state === 'HELD');
    if (own === 'DONE' && !entry.done) {
      entry.done = true;
      if (entry.holding) release();
      tones([523, 659, 784], 110, 0.5);
      vibrate(180);
      if (entry.type === 'REACTOR' || status.panels.every(({ state }) => state === 'DONE')) {
        entry.closeTimer = setTimeout(close, 1200);
      }
    }
    if (entry.type === 'O2') {
      if (entry.done) {
        entry.display.textContent = 'OK';
        if (entry.display.dataset.result !== 'ok') entry.display.dataset.result = 'ok';
        entry.note.remove();
        for (const key of entry.keys.querySelectorAll('button')) key.disabled = true;
      }
      return;
    }
    const localHold = entry.holdConfirmed === true && own === 'HELD';
    const waiting = localHold && !partner;
    const label = t(entry.done ? 'panel.nominal' : waiting ? 'panel.waiting' : 'panel.hold');
    if (entry.display.textContent !== label) entry.display.textContent = label;
    entry.hand.classList.toggle('is-waiting', waiting);
    entry.hand.style.setProperty('--sab-progress', entry.done ? 1 : localHold ? status.progress : 0);
    entry.hand.setAttribute('aria-label', label);
    const hint = partner && !localHold && !entry.done ? t('panel.partner') : '';
    if (entry.hint.textContent !== hint) entry.hint.textContent = hint;
  }

  function open(socket, code, sab, panelId) {
    if (!socket.connected || !sab?.panelStatus) return;
    if (view?.roundId === sab.panelStatus.roundId && view.panelId === panelId) return;
    close();
    const entry = { socket, code, roundId: sab.panelStatus.roundId, panelId, type: sab.type, opener: document.activeElement };
    view = entry;
    send(entry, 'open', {}, (reply) => {
      if (!reply?.ok || currentPanel()?.roundId !== entry.roundId) {
        close();
        notify(t('panel.unavailable'));
        return;
      }
      dialog ??= element('dialog', 'sab-dialog');
      if (!dialog.isConnected) {
        dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
        document.body.append(dialog);
      }
      dialog.setAttribute('aria-label', t(entry.type === 'REACTOR' ? 'sab.reactor' : 'sab.o2'));
      const exit = element('button', 'sab-close');
      exit.setAttribute('aria-label', t('btn.close'));
      exit.append(buttonArt('close'));
      exit.addEventListener('click', close);
      const terminal = element('section', `sab-terminal sab-terminal--${entry.type.toLowerCase()}`);
      entry.display = element('div', 'sab-display');
      entry.display.setAttribute('aria-live', 'polite');
      terminal.append(entry.display);
      if (entry.type === 'REACTOR') {
        entry.hand = element('button', 'sab-hand');
        for (const kind of ['idle', 'scan', 'progress']) {
          entry.hand.append(element('span', `sab-hand__${kind}`));
        }
        entry.hint = element('div', 'sab-partner');
        entry.hint.setAttribute('aria-live', 'polite');
        terminal.append(entry.hand, entry.hint);
        bindHand(entry, entry.hand);
      } else {
        entry.note = element('aside', 'sab-note', reply.note ?? '');
        entry.note.setAttribute('aria-label', `${t('panel.note')} ${reply.note ?? ''}`);
        entry.keys = element('div', 'sab-keys');
        oxygenKeys(entry, entry.keys);
        terminal.append(entry.note, entry.keys);
      }
      dialog.replaceChildren(exit, terminal);
      showStatus(currentPanel() ?? reply.status);
      dialog.showModal();
      (entry.hand ?? entry.keys.querySelector('button:not(:disabled)') ?? exit).focus();
    });
  }

  function sync(status, alive) {
    if (!view) return;
    if (!alive) close();
    else if (!status || status.roundId !== view.roundId) {
      if (!view.done || !view.closeTimer) close();
    } else showStatus(status);
  }

  function checkReactorReach(canReach) {
    if (view?.type === 'REACTOR' && !view.done && !canReach(view.panelId, view.holding)) close();
  }

  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
  return { open, close, sync, showStatus, checkReactorReach };
}
