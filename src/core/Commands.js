// ============================================================
// COMMANDS — the one place a player decision enters the game
// ============================================================
// Every choice a player can make used to be a direct call from a DOM handler
// into GameController or into a callback UIManager was holding. That is fine
// while the person deciding and the code deciding are on the same device, and
// it stops being fine the moment they are not: an online client pressing ROLL
// must not roll its own dice, it must ask the host to.
//
// So this is a bus. UI handlers stop calling functions and start naming
// commands. Offline the bus is a direct call and the game behaves exactly as it
// always did — same stack, same order, no indirection at runtime worth
// measuring. Online, the net layer installs a dispatcher that decides whether
// this device is allowed to run the command or has to send it.
//
// Deliberately NOT on the bus: opening the map, opening the bounty sheet,
// flipping a card, scrolling. Those change what one person is looking at and
// nothing else. Putting them on the wire would make one player's map scroll
// everybody's, which is not multiplayer, it is remote control.
//
// This module imports nothing. That is what lets `src/net/` depend on the game
// without the game depending on `src/net/`.

const _impl = {};
let _dispatch = null;

/** Register implementations. Called once by whoever owns the behaviour. */
export function define(map) { Object.assign(_impl, map); }

/**
 * Install an interceptor. `fn(name, args)` returns true if it has taken
 * responsibility for the command (a client forwarding it to the host), false to
 * let it run here. Passing null restores plain local execution.
 */
export function setDispatcher(fn) { _dispatch = fn || null; }

export function has(name) { return typeof _impl[name] === 'function'; }
export function names()   { return Object.keys(_impl); }

/** A player made a choice on THIS device. */
export function run(name, ...args) {
    if (_dispatch) {
        let taken = false;
        try { taken = !!_dispatch(name, args); }
        catch (e) { console.error('[cmd] dispatcher threw on', name, e); }
        if (taken) return undefined;
    }
    return runLocal(name, ...args);
}

/**
 * Execute here regardless of the dispatcher. This is the host applying a
 * command that arrived over the wire — it has already been authorised, and
 * routing it back through run() would hand it to the dispatcher a second time.
 */
export function runLocal(name, ...args) {
    const fn = _impl[name];
    if (!fn) { console.warn('[cmd] no implementation for', name); return undefined; }
    try { return fn(...args); }
    catch (e) { console.error('[cmd] command failed:', name, e); return undefined; }
}
