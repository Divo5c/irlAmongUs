export const REACTOR_ZONE_RADIUS_M = 8;
export const REACTOR_ZONE_LOCK_MARGIN_M = 3;

export function usableReactorPanel(position, spots, panels, playerId, heldPanelId = null) {
  if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return null;
  const inRange = (radius) => spots.map(({ id, x, y }) => ({
    id, distance: Math.hypot(x - position.x, y - position.y),
  })).filter(({ distance }) => distance <= radius);
  if (heldPanelId !== null) {
    return spots.some(({ id }) => id === heldPanelId) &&
      inRange(REACTOR_ZONE_RADIUS_M + REACTOR_ZONE_LOCK_MARGIN_M).length ? heldPanelId : null;
  }
  const nearby = inRange(REACTOR_ZONE_RADIUS_M).sort((a, b) =>
    a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!nearby.length) return null;
  const occupied = (id) => panels.some((panel) =>
    panel.id === id && panel.state === 'HELD' && panel.playerId !== playerId);
  return occupied(nearby[0].id)
    ? spots.find(({ id }) => id !== nearby[0].id && !occupied(id))?.id ?? null
    : nearby[0].id;
}
