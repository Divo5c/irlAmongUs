export function chooseUseAction(role, task, admin, emergency) {
  return role === 'IMPOSTOR'
    ? admin ?? emergency ?? task
    : task ?? admin ?? emergency;
}
