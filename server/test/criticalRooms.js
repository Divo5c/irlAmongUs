/**
 * Test helper: every SAVED map now needs the four critical rooms
 * (Cafeteria for meetings, Reactor/O2/Admin for sabotages).
 */
function criticalRooms() {
  return [
    {
      id: 'r-cafeteria',
      name: 'Cafeteria',
      type: 'CAFETERIA',
      polygon: [
        { x: 12, y: 72 },
        { x: 30, y: 72 },
        { x: 30, y: 88 },
        { x: 12, y: 88 },
      ],
    },
    {
      id: 'r-reactor',
      name: 'Reactor',
      type: 'REACTOR',
      polygon: [
        { x: 36, y: 100 },
        { x: 50, y: 100 },
        { x: 50, y: 116 },
        { x: 36, y: 116 },
      ],
    },
    {
      id: 'r-o2',
      name: 'O2',
      type: 'O2',
      polygon: [
        { x: 56, y: 100 },
        { x: 68, y: 100 },
        { x: 68, y: 116 },
        { x: 56, y: 116 },
      ],
    },
    {
      id: 'r-admin',
      name: 'Admin',
      type: 'ADMIN',
      polygon: [
        { x: 74, y: 72 },
        { x: 92, y: 72 },
        { x: 92, y: 88 },
        { x: 74, y: 88 },
      ],
    },
  ];
}

module.exports = { criticalRooms };
