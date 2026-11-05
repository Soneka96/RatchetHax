export async function replaceGameForSelection({ closeGame, promptSelection, createGame, processIdentifier }) {
    if (typeof closeGame !== 'function' || typeof promptSelection !== 'function' || typeof createGame !== 'function') {
        throw new TypeError('Game selection requires close, prompt, and create callbacks.');
    }

    await closeGame();
    const selection = await promptSelection();
    if (!selection || typeof selection.version !== 'string' || selection.version.length === 0) {
        throw new TypeError('Game selection must return a version.');
    }
    const game = await createGame(processIdentifier, selection.version);
    return { selection, game };
}
