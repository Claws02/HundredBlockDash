// Text → safe to drop into an HTML string. Anything that came from a player
// (a name) or off the wire goes through this before it meets innerHTML.
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => MAP[c]);
