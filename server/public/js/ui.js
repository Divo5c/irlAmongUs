const SVG_NS = 'http://www.w3.org/2000/svg';

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function icon(name, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const use = document.createElementNS(SVG_NS, 'use');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', `/img/terminal.svg#${name}`);
  svg.append(use);
  return svg;
}

export function buttonArt(name, label) {
  const art = element('span', `ui-art ui-art--${name}`);
  if (label) {
    art.setAttribute('role', 'img');
    art.setAttribute('aria-label', label);
  } else {
    art.setAttribute('aria-hidden', 'true');
  }
  return art;
}

export function avatar(colorId, dead = false) {
  const svg = icon(dead ? 'ghost' : 'crew', 'crew-avatar');
  svg.dataset.crewColor = colorId ?? 'gray';
  return svg;
}
