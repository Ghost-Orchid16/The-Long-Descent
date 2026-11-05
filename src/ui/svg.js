// Small SVG builders for close-up instrument views.

/** Analogue pressure gauge. */
export function gaugeSVG(value, { min = 0, max = 300, step = 50, minor = 10, unit = 'bar', label = 'PRESSURE', red = [0, 50], green = null, size = 300 } = {}) {
  const c = size / 2, r = size * 0.42;
  const a0 = -225, a1 = 45; // degrees, sweep 270
  const ang = (v) => (a0 + ((v - min) / (max - min)) * (a1 - a0)) * (Math.PI / 180);
  const pt = (v, rr) => [c + Math.cos(ang(v)) * rr, c + Math.sin(ang(v)) * rr];
  const arc = (v0, v1, rr) => {
    const [x0, y0] = pt(v0, rr), [x1, y1] = pt(v1, rr);
    const large = ((v1 - v0) / (max - min)) * 270 > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${rr} ${rr} 0 ${large} 1 ${x1} ${y1}`;
  };
  let ticks = '';
  for (let v = min; v <= max + 1e-6; v += minor) {
    const major = Math.abs((v - min) % step) < 1e-6;
    const [x0, y0] = pt(v, r * (major ? 0.82 : 0.88)), [x1, y1] = pt(v, r * 0.95);
    ticks += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#1a1d20" stroke-width="${major ? 2.4 : 1.1}"/>`;
    if (major) { const [tx, ty] = pt(v, r * 0.66); ticks += `<text x="${tx}" y="${ty}" font-size="${size * 0.06}" text-anchor="middle" dominant-baseline="middle" fill="#1a1d20" font-family="Inter, sans-serif">${v}</text>`; }
  }
  const [nx, ny] = pt(Math.min(max, Math.max(min, value)), r * 0.86);
  const zones = (red ? `<path d="${arc(red[0], red[1], r * 0.91)}" stroke="#c43c26" stroke-width="${size * 0.035}" fill="none"/>` : '') +
    (green ? `<path d="${arc(green[0], green[1], r * 0.91)}" stroke="#3f9a62" stroke-width="${size * 0.035}" fill="none"/>` : '');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs><radialGradient id="gface" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fbfaf6"/><stop offset="1" stop-color="#d9d6cc"/></radialGradient>
    <linearGradient id="grim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9aa3a8"/><stop offset="1" stop-color="#3b4246"/></linearGradient></defs>
    <circle cx="${c}" cy="${c}" r="${r * 1.12}" fill="url(#grim)"/>
    <circle cx="${c}" cy="${c}" r="${r * 1.02}" fill="url(#gface)"/>
    ${zones}${ticks}
    <text x="${c}" y="${c + r * 0.38}" font-size="${size * 0.05}" text-anchor="middle" fill="#3a3f43" font-family="Inter, sans-serif" letter-spacing="2">${label}</text>
    <text x="${c}" y="${c + r * 0.52}" font-size="${size * 0.045}" text-anchor="middle" fill="#3a3f43" font-family="Inter, sans-serif">${unit}</text>
    <line x1="${c}" y1="${c}" x2="${nx}" y2="${ny}" stroke="#a22a18" stroke-width="${size * 0.014}" stroke-linecap="round"/>
    <circle cx="${c}" cy="${c}" r="${size * 0.03}" fill="#2a2d30"/>
    <ellipse cx="${c - r * 0.3}" cy="${c - r * 0.45}" rx="${r * 0.55}" ry="${r * 0.25}" fill="rgba(255,255,255,0.18)" transform="rotate(-25 ${c} ${c})"/>
  </svg>`;
}
