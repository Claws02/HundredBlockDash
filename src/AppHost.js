// ============================================================
// APP HOST — the one door between claw-core and the app around it.
//
// Everything in src/claw-core/ is shared between HundredBlockDash and
// CLAWGames. Core files may import each other and THIS file, nothing else.
// Each app supplies its own AppHost.js at src/AppHost.js that provides these
// names. Here they are HundredBlockDash's real modules, re-exported unchanged
// (ES live bindings), so the board game behaves exactly as before.
//
// Shrinking this list is the migration: every name below is a piece of the
// board game the minigames still reach into.
// ============================================================

export * as Bot from './core/Bot.js';
export * as DualRead from './ui/DualRead.js';
export const loadUIManager = () => import('./ui/UIManager.js');
export { DISTRICT_BIOMES } from './config/GameConfig.js';
export { HBD_BIOMES } from './config/GameConfig.js';
export { MINIGAME_PLACE_COINS } from './config/GameConfig.js';
export { MINIGAME_REWARD } from './config/GameConfig.js';
export { PROP_KIT } from './engine/Renderer.js';
export { playerCount } from './core/GameState.js';
export { setBoardPaused } from './engine/Renderer.js';
export { setPlayerCount } from './core/GameState.js';
export { state } from './core/GameState.js';
