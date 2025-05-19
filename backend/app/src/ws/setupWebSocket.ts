import WebSocket, { WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import jwt from "jsonwebtoken";
import { Player, DisconnectedPlayer } from "../types/player";
import { addPlayerToMatchmaking, Room } from "../match/room";
import {
  isSkinChangeMessage,
  isPaddlePositionMessage,
  isMatchmakingMessage,
  isLeaveGameMessage,
  isReadyToPlayMessage,
  isSpectatingRequestMessage,
} from "../shared/game/gameMessageTypes";
import {
  isCloseMessage,
  isCreateMessage,
  isJoinMessage,
  isLeaveMessage,
} from "../shared/tournament/tournamentMessageTypes";
import {
  ErrorMessage,
  GameMessageData,
  isGameMessage,
  isTournamentMessage,
  TournamentMessageData,
} from "../shared/messageType";
import ERROR_TYPE, { ERROR_MSG } from "../shared/errorType";
import { RoomType, createNewRoom } from "../match/room";
// import { isInviteToGameMessage, isAcceptGameInviteMessage } from "../shared/chat/chatMessageTypes";
import { JWT_SECRET } from "../config";
import { UserPayload } from "../types/UserPayload";
import { User } from "../types/authTypes";
// import { isBlocked } from "../utils/blocked";
import db from "../db/db";
import {
  createNewTournament,
  addPlayerToTournament,
  removePlayerFromTournament,
  closeTournament
} from "../tournament/tournamentManager";
import { Tournament } from "../types/tournament";
// import { isChatMessage, ChatMessageData } from "../shared/messageType";
// import { NewMsgReceivedMessage, isNewMsgSendMessage } from "../shared/chat/chatMessageTypes";

import { handleChatAndInviteMessages } from "./chatInviteHandler";

// uuid : Player
const players: Map<string, Player> = new Map();

// const readyPlayers = new Map<number, Set<number>>();

const recentlyDisconnectedPlayers: Map<string, DisconnectedPlayer> = new Map();

// Extract the params from the request
function extractUrlParams(request: IncomingMessage): Record<string, string> {
  const fullUrl: string = `${request.headers.origin}${request.url}`;
  const parsedUrl: URL = new URL(fullUrl);

  const params: Record<string, string> = {};
  for (const [key, value] of parsedUrl.searchParams.entries()) {
    params[key] = value;
  }

  return params;
}

function sendErrorMessage(ws: WebSocket, msg: string, errorType?: ERROR_TYPE | undefined): void {
  const errorMessage: ErrorMessage = { type: "error", msg };
  if (errorType) {
    errorMessage.errorType = errorType;
  }
  ws.send(JSON.stringify(errorMessage));
}

// WebSocket setup
export function setupWebSocket(): WebSocketServer {
  const wss: WebSocketServer = new WebSocket.Server({ noServer: true });

  // WebSocket connection
  wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    const params: Record<string, string> = extractUrlParams(request);

    let isAuthentificated: boolean = false;
    let playerUUID: string = "";
    let playerUsername: string = "";

    const token: string = params.token;
    let decoded: UserPayload | null = null;
    if (token) {
      try {
        decoded = jwt.verify(token, JWT_SECRET) as UserPayload;
        if (decoded && decoded.uuid && typeof decoded.uuid === "string") {
          console.log(`User connected: ${decoded.uuid}`);

          const user: User = db
            .prepare("SELECT * FROM users WHERE uuid = ?")
            .get(decoded.uuid) as User;

          if (user) {
            isAuthentificated = true;
            playerUUID = user.uuid;
            playerUsername = user.name;
          }
        }
      } catch (error: any) {}
    }

    // If there is no token or the token is invalid, refuse the connection
    if (!isAuthentificated || !playerUUID || !playerUsername) {
      sendErrorMessage(ws, ERROR_MSG.TOKEN_MISSING_OR_INVALID, ERROR_TYPE.CONNECTION_REFUSED);
      ws.close(); // Close the connection after sending the error message
      return;
    }

    // Check if player is already connected with this account
    if (players.has(playerUUID)) {
      sendErrorMessage(ws, ERROR_MSG.ALREADY_CONNECTED, ERROR_TYPE.CONNECTION_REFUSED);
      ws.close(); // Close the connection after sending the error message
      return;
    }

    let player: Player;

    // Check if the player was recently disconnected
    if (recentlyDisconnectedPlayers.has(playerUUID)) {
      player = recentlyDisconnectedPlayers.get(playerUUID)!.player;
      recentlyDisconnectedPlayers.delete(playerUUID);
      player.socket = ws;
      console.log(`[Reconnection] Player reconnected: ${player.username} (${playerUUID})`);
      player.room?.notifyReconnection(player);
    } else {
      // Create a new player object
      player = {
        uuid: playerUUID,
        isBot: false,
        username: playerUsername,
        socket: ws,
        room: null,
        spectatingRoom: null,
        paddleSkinId: "",
      };
      console.log(`New player connected: ${player.username} (${playerUUID})`);
    }

    players.set(playerUUID, player);

    ws.on("message", (message: string) => {

      try {
        const msgData: any = JSON.parse(message);

        if (handleChatAndInviteMessages(msgData, player)) {
          return;
        }
        if (isGameMessage(msgData)) {
          const data: GameMessageData = msgData.data;
          if (isReadyToPlayMessage(data)) {
            const opponent: Player | undefined = getPlayerByUUID(data.opponentUuid);
            if (!opponent) {
              console.log("[GAME] Opponent not found or not connected");
              return;
            }

            // Check if already in a room
            if (player.room || opponent.room) {
              console.warn(`[GAME] Refus de créer une room :`);
              console.warn(`- ${player.username} a room ?`, !!player.room);
              console.warn(`- ${opponent.username} a room ?`, !!opponent.room);
              return;
            }

            const room: Room = createNewRoom(RoomType.FriendlyMatch);
            room.addPlayer(player);
            room.addPlayer(opponent);
            room.startGame().catch((error: any) => {
              console.error("Erreur au démarrage du jeu :", error);
              room.dispose();
            });

            return;
          } else if (isLeaveGameMessage(data)) {
            if (player.room) {
              player.room.removePlayer(player);
            }
            if (player.spectatingRoom) {
              player.spectatingRoom.removeSpectator(player);
            }
          } else if (isMatchmakingMessage(data)) {
            // Check if the player is already in a room
            if (player.room || player.spectatingRoom) {
              sendErrorMessage(ws, ERROR_MSG.ALREADY_IN_ROOM, ERROR_TYPE.MATCHMAKING_REFUSED);
            } else {
              console.log(`[Matchmaking] : ${player.username} (${playerUUID})`);
              addPlayerToMatchmaking(player);
            }
          } else if (isSkinChangeMessage(data)) {
            player.paddleSkinId = data.skinId;
            if (player.room?.isGameLaunched()) {
              player.room.notifySkinUpdate(player);
            }
          } else if (isPaddlePositionMessage(data)) {
            // Update paddle positions if condition meeted
            if (player.room) {
              const index: -1 | 1 | 2 = player.room.indexOfPlayer(player);
              if (index !== -1) {
                player.room.setPaddlePosition(index, data.position);
              }
            }
          } else if (isSpectatingRequestMessage(data)) {
            const target: Player | undefined = players.get(data.target);
            if (!target) {
              sendErrorMessage(ws, ERROR_MSG.NO_PLAYER_FOUND, ERROR_TYPE.SPECTATING_FAILED);
              return;
            }
            if (!target.room) {
              sendErrorMessage(ws, ERROR_MSG.PLAYER_IS_NOT_IN_GAME, ERROR_TYPE.SPECTATING_FAILED);
              return;
            }
            if (!target.room.addSpectator(player)) {
              sendErrorMessage(ws, ERROR_MSG.CANNOT_SPECTATE, ERROR_TYPE.SPECTATING_FAILED);
            }
          }
        } else if (isTournamentMessage(msgData)) {
          const data: TournamentMessageData = msgData.data;
          let error: string | undefined = undefined;
          let errorType: ERROR_TYPE | undefined = undefined;

          if (isCreateMessage(data)) {
            console.log(`[Tournament - Create] : ${player.username}\n`, data);
            const [_, err]: [Tournament | null, string | undefined] = createNewTournament(data.name, player, data.settings);
            if (err) {
              error = err;
              errorType = ERROR_TYPE.TOURNAMENT_CREATION_FAILED;
            }
          } else if (isJoinMessage(data)) {
            console.log(`[Tournament - Join] : ${player.username} as ${data.username}\n`, data);
            error = addPlayerToTournament(data.uuid, player, data.username);
            errorType = ERROR_TYPE.TOURNAMENT_JOIN_FAILED;
          } else if (isLeaveMessage(data)) {
            console.log(`[Tournament - Leave] : ${player.username}\n`, data);
            error = removePlayerFromTournament(data.uuid, player);
            errorType = ERROR_TYPE.TOURNAMENT_LEAVE_FAILED;
          } else if (isCloseMessage(data)) {
            console.log(`[Tournament - Close] : ${player.username}\n`, data);
            error = closeTournament(data.uuid, player);
            errorType = ERROR_TYPE.TOURNAMENT_CLOSE_FAILED;
          }

          // If an error occurred, send it to the player
          if (error) {
            sendErrorMessage(ws, error, errorType);
          }
        }
      } catch (error: any) {
        console.error("An Error occured:", error);
      }
    });

    const pingInterval: NodeJS.Timeout = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);

    ws.on("close", () => {
      clearInterval(pingInterval); // Clear ping interval on disconnect
      player.socket = null;
      if (player.room) {
        // Remove the player from the room if the game hasn't started
        if (!player.room.isGameLaunched()) {
          player.room?.removePlayer(player);
          player.room = null;
        }
        // If the game is launched the room handle by itself
      }
      if (player.spectatingRoom) {
        player.spectatingRoom.removeSpectator(player);
      }
      players.delete(playerUUID);
      console.log(`Player disconnected: ${player.username} (${playerUUID})`);

      recentlyDisconnectedPlayers.set(playerUUID, {
          disconnectionTime: Date.now(),
          player: player
        } as DisconnectedPlayer
      );
    });
  });

  return wss;
}

const DISCONNECT_TIMEOUT: number = 30 * 1000; // 30 seconds in milliseconds

setInterval(() => {
  const currentTime: number = Date.now(); // Get the current time

  // Iterate over the recentlyDisconnectedPlayers map
  recentlyDisconnectedPlayers.forEach((disconnectedPlayer: DisconnectedPlayer, uuid: string) => {
    const timeSinceDisconnection: number = currentTime - disconnectedPlayer.disconnectionTime;

    // Check if the disconnection duration exceeds the timeout
    if (timeSinceDisconnection > DISCONNECT_TIMEOUT) {
      // Remove the player from the recentlyDisconnectedPlayers map
      disconnectedPlayer.player.room?.removePlayer(disconnectedPlayer.player);
      recentlyDisconnectedPlayers.delete(uuid);
      console.log(`Player '${uuid}' removed after ${timeSinceDisconnection} ms of disconnection.`);
    }
  });
}, 1000); // Run the interval every second

// Get a player by is UUID
export function getPlayerByUUID(uuid: string | undefined): Player | undefined {
  return uuid ? players.get(uuid) : undefined;
}

// Update player username
export function updateUsername(uuid: string, newUsername: string): void {
  const player: Player | undefined = players.get(uuid);
  if (player) {
    player.username = newUsername;
  }
}