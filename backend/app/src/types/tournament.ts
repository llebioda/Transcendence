import { TournamentTree } from "../tournament/tournamentTree";
import { Player } from "../types/player";
import { TournamentSettings, isTournamentSettings } from "../shared/tournament/tournamentSettings";
import { maxScoreToWin } from "../shared/game/constants";

export type Tournament = {
  readonly uuid: string;
  name: string;
  owner: Player; // The player who created the tournament
  playerCount: number;
  players: Player[];
  pseudoNames: Map<string, string>; // Pseudo names of the players (key: pseudo)
  settings: TournamentSettings;
  tree: TournamentTree;
  isClosed: boolean; // Indicates if the tournament is closed for new players
  isEnded: boolean; // Indicates if the tournament is ended
}

export function isValidTournamentSettings(settings: TournamentSettings): boolean {
  if (!isTournamentSettings(settings)) {
    return false;
  }

  if (settings.maxPlayerCount !== 4 &&
      settings.maxPlayerCount !== 8 &&
      settings.maxPlayerCount !== 16 &&
      settings.maxPlayerCount !== 32) {
    return false;
  }

  if (settings.scoreToWin < 1 || settings.scoreToWin > maxScoreToWin) {
    return false;
  }

  return true;
}
