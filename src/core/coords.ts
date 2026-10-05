/** Une coordonnée de jeu vaut 6 unités internes (celles du catalogue) ; une case de territoire fait 18 unités = 3 coordonnées de jeu. */
export const UNITS_PER_GAME_COORDINATE = 6;
export const toGame = (value: number): number => Math.floor(value / UNITS_PER_GAME_COORDINATE + 0.5);
export const toReal = (game: number): number => game * UNITS_PER_GAME_COORDINATE;
