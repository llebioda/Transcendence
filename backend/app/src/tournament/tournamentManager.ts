//import db from "../db/db";
import { v4 as uuidv4 } from "uuid";
import { Player } from "../types/player";
import { Tournament, isValidTournamentSettings } from "../types/tournament";
import { TournamentSettings } from "../shared/tournament/tournamentSettings";
import { TournamentTree } from "./tournamentTree";
import { getRandomPaddleModelId } from "../controllers/assetsController";
import { ERROR_MSG } from "../shared/errorType";
import { NotificationMessage } from "../shared/messageType";

const tournaments: Map<string, Tournament> = new Map();

/**
 * This function creates a new tournament, adds it to the tournaments map and returns it
 * If there is an error return null instead and an error message
 * @returns the tournament if it was created successfully, or null if there was an error, and an error message
 */
export function createNewTournament(
  name: string,
  owner: Player,
  settings: TournamentSettings,
): [Tournament | null, string | undefined] {
  // If the name is empty or only whitespace, return null
  if (!name || name.trim() === "")
    return [null, ERROR_MSG.INVALID_TOURNAMENT_NAME];

  // If the settings are not valid, return null
  if (!isValidTournamentSettings(settings))
    return [null, ERROR_MSG.INVALID_TOURNAMENT_SETTINGS];

  // Search if the owner has already created a tournament
  const tournamentWithSameOwner: Tournament | undefined = Array.from(
    tournaments.values(),
  ).find((tournament: Tournament) => !tournament.isEnded && tournament.owner.uuid === owner.uuid);

  // If a tournament already exists for this owner, return null
  if (tournamentWithSameOwner)
    return [null, ERROR_MSG.ALREADY_OWNER_OF_TOURNAMENT];

  const uuid: string = uuidv4();
  const tournament: Tournament = {
    uuid,
    name,
    owner,
    playerCount: 0,
    players: [],
    pseudoNames: new Map<string, string>(),
    settings,
    // TournamentTree need a reference to the tournament, and we cant pass it before its declaration
    tree: undefined as unknown as TournamentTree, 
    isClosed: false,
    isEnded: false,
  };
  // Now we can set the TournamentTree
  tournament.tree = new TournamentTree(tournament);

  tournaments.set(uuid, tournament);
  return [tournament, undefined];
}

/**
 * @param uuid the uuid of the tournament
 * @returns return the tournament if it exist, else undefined
 */
export function getTournament(uuid: string): Tournament | undefined {
  return tournaments.get(uuid);
}

/**
 * @returns return all the tournaments
 */
export function getTournaments(): Tournament[] {
  return Array.from(tournaments.values());
}

/**
 * @param player the player to search for
 * @returns the list of tournaments the player is in
 */
export function getTournamentsForPlayer(player: Player): Tournament[] {
  return Array.from(tournaments.values()).filter((tournament: Tournament) =>
    tournament.players.some((p: Player) => p.uuid === player.uuid),
  );
}

/**
 * Add a player to a tournament
 * @returns nothing if the player was added successfully, or an error message
 */
export function addPlayerToTournament(
  tournamentUUID: string,
  player: Player,
  username?: string,
): string | undefined {
  const tournament: Tournament | undefined = tournaments.get(tournamentUUID);
  if (!tournament) return ERROR_MSG.TOURNAMENT_NOT_FOUND;

  // Tournament is closed
  if (tournament.isClosed) return ERROR_MSG.TOURNAMENT_CLOSED;

  // Tournament is full
  if (tournament.players.length >= tournament.settings.maxPlayerCount)
    return ERROR_MSG.TOURNAMENT_FULL;

  // Player is already in the tournament
  if (tournament.players.some((p: Player) => p.uuid === player.uuid))
    return ERROR_MSG.PLAYER_ALREADY_IN_TOURNAMENT;

  // If username is undefined then set it to player.username
  username ??= player.username;

  // Username is already taken by another player
  if (Array.from(tournament.pseudoNames.values()).some((name: string) => name === username))
    return ERROR_MSG.USERNAME_ALREADY_IN_USE;

  tournament.players.push(player);
  tournament.pseudoNames.set(player.uuid, username);
  tournament.playerCount++;

  if (tournament.playerCount >= tournament.settings.maxPlayerCount) {
    // Tournament is full, close it
    close(tournament);
  }
}

/**
 * Remove a player from a tournament
 * @returns nothing if the player was removed successfully, or an error message
 */
export function removePlayerFromTournament(
  tournamentUUID: string,
  player: Player,
): string | undefined {
  const tournament: Tournament | undefined = tournaments.get(tournamentUUID);
  if (!tournament) return ERROR_MSG.TOURNAMENT_NOT_FOUND;

  // Tournament is closed
  if (tournament.isClosed) return ERROR_MSG.TOURNAMENT_CLOSED;

  const playerIndex: number = tournament.players.findIndex(
    (p: Player) => p.uuid === player.uuid,
  );

  // Player not found in the tournament
  if (playerIndex === -1) return ERROR_MSG.PLAYER_NOT_IN_TOURNAMENT;

  tournament.players.splice(playerIndex, 1);
  tournament.pseudoNames.delete(player.uuid);
  tournament.playerCount--;
}

// Adjust players to make the count a power of 2 by adding bot players
function adjustPlayers(tournament: Tournament): void {
  let count: number = tournament.players.length;
  // Calculate the next power of 2
  // If the count is less or equal than 4, set it to 4 (minimum for a tournament)
  //const nextPowerOfTwo: number = count <= 4 ? 4 : Math.pow(2, Math.ceil(Math.log2(count)));
  const nextPowerOfTwo: number = tournament.settings.maxPlayerCount;

  let botCount: number = 1;
  const pseudosTaken: string[] = Array.from(tournament.pseudoNames.values());

  while (count < nextPowerOfTwo) {
    const botUUID: string = uuidv4();
    let botName: string;

    do {
      botName = `Bot ${botCount++}`;
    } while (pseudosTaken.some((pseudo: string) => pseudo === botName))

    tournament.players.push({
      uuid: botUUID,
      isBot: true,
      username: botName,
      socket: null,
      room: null,
      spectatingRoom: null,
      paddleSkinId: getRandomPaddleModelId(),
    });
    tournament.pseudoNames.set(botUUID, botName);
    count++;
  }
}

/**
 * Close a tournament and generate the tournament tree
 * @param tournament the tournament to close
 */
function close(tournament: Tournament): void {
  if (tournament.isClosed) return;

  tournament.isClosed = true;
  tournament.playerCount = tournament.players.length;
  // Ensure the number of players is a power of 2 by adding bot players if necessary
  adjustPlayers(tournament);

  try {
    tournament.tree.generate(tournament.players);
  } catch (error: any) {
    console.error(`An error occurred while generating the tournament tree of '${tournament.name}':`, error);
    return;
  }

  const notificationMessage: NotificationMessage = {
    type: "notif",
    notifType: "info",
    msg: `Le tournoi ${tournament.name} va commencer`
  };
  const msg: string = JSON.stringify(notificationMessage);

  tournament.players.forEach((player: Player) => {
    if (player && !player.isBot && player.socket?.readyState === WebSocket.OPEN) {
      player.socket?.send(msg);
    }
  });

  tournament.tree.playTournament();
}

/**
 * Ask for a tournament closure
 * @returns nothing if the tournament was closed successfully, or an error message
 */
export function closeTournament(
  tournamentUUID: string,
  player: Player,
): string | undefined {
  const tournament: Tournament | undefined = tournaments.get(tournamentUUID);
  if (!tournament) return ERROR_MSG.TOURNAMENT_NOT_FOUND;

  // Tournament is already closed
  if (tournament.isClosed) return ERROR_MSG.TOURNAMENT_CLOSED;

  // Only the owner can close the tournament
  if (tournament.owner.uuid !== player.uuid)
    return ERROR_MSG.NOT_OWNER_OF_TOURNAMENT;

  // Tournament must have at least 3 players to be closed
  if (tournament.players.length < 3)
    return ERROR_MSG.NOT_ENOUGHT_PLAYER_TO_CLOSE_TOURNAMENT;

  close(tournament);
}

