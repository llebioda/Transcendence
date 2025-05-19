import { saveMatchData } from "../db/db";
import { v4 as uuidv4 } from "uuid";
import {
  GAME_CONSTANT,
  GameData,
  newGameData,
  GameStats,
  newGameStats,
} from "../shared/game/gameElements";
import { resetBall, updateBallPosition } from "../shared/game/ball";
import {
  SkinChangeMessage,
  GameDataMessage,
  GameStartedMessage,
  GameResultMessage,
  DisconnectionMessage,
  ReconnectionMessage,
} from "../shared/game/gameMessageTypes";
import { GameMessage, GameMessageData } from "../shared/messageType";
import { Player } from "../types/player";
import { handleAIInput } from "../shared/inputHandler";
import { ReplayData, newReplayData } from "../shared/game/replayData";
import {
  snapshotReplayData,
  saveReplayDataToFile,
} from "../controllers/replayController";

export enum RoomType {
  Matchmaking,
  FriendlyMatch,
  Tournament,
}

const DISCONNECT_TIMEOUT: number = 5000; // 5 seconds

const rooms: Map<string, Room> = new Map();

export function createNewRoom(type: RoomType): Room {
  const room: Room = new Room(type);
  rooms.set(room.getId(), room);
  return room;
}

export function addPlayerToMatchmaking(player: Player): void {
  if (player.room || player.spectatingRoom) {
    return; // If the player is already in a room dont add it to matchmaking
  }

  // Check for an available room of type Matchmaking
  for (const [, room] of rooms) {
    if (room.getType() === RoomType.Matchmaking && room.isJoinable()) {
      if (room.addPlayer(player)) {
        startGameIfRoomFull(room);
        return;
      }
    }
  }

  // If no available room, create a new room
  const newRoom: Room = createNewRoom(RoomType.Matchmaking);
  newRoom.addPlayer(player);
}

// Start the game if room is full
function startGameIfRoomFull(room: Room): void {
  if (room.isFull()) {
    room.startGame().catch((error: any) => {
      console.error(`Error starting game in room '${room.getId()}':`, error);
      room.dispose();
    });
  }
}

export class Room {
  private static roomCounter: number = 1;

  private readonly id: string;
  private readonly type: RoomType;
  private player1: Player | null;
  private player2: Player | null;
  private player1Left: boolean;
  private player2Left: boolean;

  private spectators: Player[];

  private gameData: GameData;
  private gameStats: GameStats;
  private replayData: ReplayData;
  private winnerId: -1 | 1 | 2;

  private gameLaunched: boolean;
  private gameEnded: boolean;

  private scoreToWin: number = GAME_CONSTANT.defaultScoreToWin;

  private gameEndedCallback?: (gameResult: GameResultMessage) => void =
    undefined;

  public constructor(type: RoomType) {
    this.id = `room-${Room.roomCounter++}`;
    this.type = type;
    this.player1 = null; // Start with no players
    this.player2 = null;
    this.player1Left = false;
    this.player2Left = false;
    this.spectators = [];
    this.gameData = newGameData();
    this.gameStats = newGameStats();
    this.replayData = newReplayData();
    this.winnerId = -1;
    this.gameLaunched = false;
    this.gameEnded = false;
  }

  /**
   * @returns 'id' of the room.
   */
  public getId(): string {
    return this.id;
  }

  /**
   * @returns 'type' of the room.
   */
  public getType(): RoomType {
    return this.type;
  }

  /**
   * @param index The index of the player.
   * @returns player of index N of the room.
   */
  public getPlayer(index: 1 | 2): Player | null {
    if (index === 1) {
      return this.player1;
    } else if (index === 2) {
      return this.player2;
    }
    return null;
  }

  /**
   * @returns True if the game is launched, else False.
   */
  public isGameLaunched(): boolean {
    return this.gameLaunched;
  }

  /**
   * @returns True if the game is ended, else False.
   */
  public isGameEnded(): boolean {
    return this.gameEnded;
  }

  /**
   * @returns True if the game is joinable, else False.
   */
  public isJoinable(): boolean {
    return !this.isFull() && !this.isGameLaunched() && !this.isGameEnded();
  }

  /**
   * @param index The index of the owner of the paddle.
   * @param pos The new position of the paddle.
   */
  public setPaddlePosition(index: 1 | 2, pos: BABYLON.Vector2): void {
    if (index === 1) {
      this.gameStats.paddle1DistanceTravelled += BABYLON.Vector2.Distance(this.gameData.paddle1Position, pos);
      this.gameData.paddle1Position = pos;
    } else if (index === 2) {
      this.gameStats.paddle2DistanceTravelled += BABYLON.Vector2.Distance(this.gameData.paddle2Position, pos);
      this.gameData.paddle2Position = pos;
    }
  }

  /**
   * @param scoreToWin The score needed to win the game.
   */
  public setScoreToWin(scoreToWin: number): void {
    this.scoreToWin = scoreToWin;
  }

  /**
   * @param gameEndedCallback The callback to call when the game ends.
   */
  public setGameEndedCallback(
    gameEndedCallback: (gameResult: GameResultMessage) => void,
  ): void {
    this.gameEndedCallback = gameEndedCallback;
  }

  /**
   * Add a player to the room.
   * @param player The player to join the room.
   * @returns True if the player was added successfully, otherwise false.
   */
  public addPlayer(player: Player): boolean {
    if (!this.isPlayerAlive(player)) {
      return false; // Player is not connected
    }
    if (!this.isJoinable()) {
      return false; // Cannot add players after the game has started or ended
    }
    if (this.containsPlayer(player)) {
      return false; // Player already in the room
    }
    if (player.room !== null && !player.room.isGameEnded()) {
      return false; // Player already in another room that is not ended
    }

    const setupPlayer: () => void = () => {
      player.room = this;
      if (player.spectatingRoom) {
        player.spectatingRoom.removeSpectator(player);
      }
    };

    if (!this.player1) {
      this.player1 = player;
      this.player1Left = false;
      setupPlayer();
      return true;
    }

    if (!this.player2) {
      this.player2 = player;
      this.player2Left = false;
      setupPlayer();
      return true;
    }

    return false;
  }

  /**
   * Remove a player from the room.
   * @param player The player to remove.
   */
  public removePlayer(player: Player): void {
    if (!this.containsPlayer(player)) {
      return; // Do nothing if the player is not in the room
    }

    if (player.room === this) {
      player.room = null; // Clear the player's room reference
    }

    if (this.gameLaunched) {
      // If the game is launched we need to end the game
      // and we need to keep the player reference for the end of the game
      if (this.player1?.uuid === player.uuid) {
        this.player1Left = true;
      } else if (this.player2?.uuid === player.uuid) {
        this.player2Left = true;
      }
      return; // return to avoid removing player reference
    }

    if (this.player1?.uuid === player.uuid) {
      this.player1 = null;
    } else if (this.player2?.uuid === player.uuid) {
      this.player2 = null;
    }
  }

  /**
   * Add a spectator to the room.
   * @param player The player to join the room.
   * @returns True if the player was added successfully, otherwise false.
   */
  public addSpectator(player: Player): boolean {
    if (!this.isPlayerAlive(player)) {
      return false; // Player is not connected
    }
    if (!this.gameLaunched || this.gameEnded) {
      return false; // Game not started or game already ended
    }
    if (this.containsPlayer(player) || this.spectators.includes(player)) {
      return false; // Player already in the room
    }
    if (player.room !== null || player.spectatingRoom !== null) {
      return false; // Player already in another room
    }

    this.spectators.push(player);
    player.spectatingRoom = this;

    const skinChangeMessage1: SkinChangeMessage = {
      type: "skinId",
      id: 1,
      skinId: this.player1?.paddleSkinId ?? "",
    };
    player.socket?.send(this.stringifyGameMessageData(skinChangeMessage1));

    const skinChangeMessage2: SkinChangeMessage = {
      type: "skinId",
      id: 2,
      skinId: this.player2?.paddleSkinId ?? "",
    };
    player.socket?.send(this.stringifyGameMessageData(skinChangeMessage2));

    return true;
  }

  /**
   * Remove a spectator from the room.
   * @param player The player to remove.
   */
  public removeSpectator(player: Player): void {
    if (player.spectatingRoom === this) {
      player.spectatingRoom = null; // Clear the player's spectatingRoom reference
    }

    this.spectators = this.spectators.filter((spectator: Player) => spectator && spectator.uuid !== player.uuid);
  }

  /**
   * Removes all players from the room.
   */
  private clear(): void {
    if (this.player1 && this.player1.room === this) {
      this.player1.room = null;
    }
    if (this.player2 && this.player2.room === this) {
      this.player2.room = null;
    }
    this.player1 = null;
    this.player2 = null;

    this.spectators.forEach((player: Player) => {
      if (player.spectatingRoom === this) {
        player.spectatingRoom = null;
      }
    });
    this.spectators.length = 0;
  }

  /**
   * Checks if the room is empty.
   * @returns True if both player1 and player2 are null, otherwise false.
   */
  public isEmpty(): boolean {
    return !this.player1 && !this.player2;
  }

  /**
   * Checks if the room is full.
   * @returns True if both player1 and player2 are present, otherwise false.
   */
  public isFull(): boolean {
    return !!this.player1 && !!this.player2;
  }

  /**
   * Checks if the room contains a specific player.
   * @param player The player to check.
   * @returns True if the room contains the player, otherwise false.
   */
  public containsPlayer(player: Player): boolean {
    return (
      this.player1?.uuid === player.uuid || this.player2?.uuid === player.uuid
    );
  }

  /**
   * Get the index of the player.
   * @param player The player to check.
   * @returns the index of player (p1 = 1, p2 = 2) or -1 if player isn't in this room.
   */
  public indexOfPlayer(player: Player): -1 | 1 | 2 {
    if (!player) {
      return -1;
    }

    if (this.player1?.uuid === player.uuid) {
      return 1;
    } else if (this.player2?.uuid === player.uuid) {
      return 2;
    }
    return -1;
  }

  /**
   * Checks if player is still alive (connected).
   * @returns True if player exist and is still connected, otherwise false.
   */
  public isPlayerAlive(player: Player | null | undefined): boolean {
    return (
      !!player && (player.isBot || player.socket?.readyState === WebSocket.OPEN)
    );
  }

  /**
   * Notify the room about a player skin update.
   */
  public notifySkinUpdate(player: Player): void {
    const playerId: -1 | 1 | 2 = this.indexOfPlayer(player);
    if (playerId === -1) {
      return;
    }

    if (playerId === 1) {
      this.replayData.p1Skin = player.paddleSkinId;
    } else if (playerId === 2) {
      this.replayData.p2Skin = player.paddleSkinId;
    }

    const skinChangeMessage: SkinChangeMessage = {
      type: "skinId",
      id: playerId,
      skinId: player.paddleSkinId,
    };
    this.sendGameMessage(skinChangeMessage, [player.uuid]);
  }

  /**
   * Notify the room about the player reconnection.
   */
  public notifyReconnection(player: Player): void {
    const playerId: -1 | 1 | 2 = this.indexOfPlayer(player);
    if (playerId === -1) {
      return;
    }

    const otherPlayerId: 1 | 2 = playerId === 1 ? 2 : 1;
    const reconnectionMessage: ReconnectionMessage = {
      type: "reconnection",
      id: playerId,
      selfSkinId: player.paddleSkinId,
      otherSkinId: this.getPlayer(otherPlayerId)?.paddleSkinId ?? "",
    };

    player.socket?.send(this.stringifyGameMessageData(reconnectionMessage));

    if (this.gameEnded) {
      const gameResultMessage: GameResultMessage = {
        type: "gameResult",
        p1Score: this.gameData.p1Score,
        p2Score: this.gameData.p2Score,
        winnerUUID: this.winnerId === -1 ? "" : this.getPlayer(this.winnerId)!.uuid,
        winner: this.winnerId === -1 ? "" : this.getPlayer(this.winnerId)!.username,
        gameStats: this.gameStats,
      };
      player.socket?.send(this.stringifyGameMessageData(gameResultMessage));
    }
  }

  private stringifyGameMessageData(data: GameMessageData): string {
    const message: GameMessage = {
      type: "game",
      data: data,
    };
    return JSON.stringify(message);
  }

  /**
   * Sends a message to all players.
   * @param msg The message to send.
   * @param excludedPlayerUUID The list of player UUID to excluded from the message.
   */
  public sendMessage(msg: string, excludedPlayerUUID?: string[]): void {
    if (
      this.player1 &&
      this.isPlayerAlive(this.player1) &&
      !this.player1Left &&
      !excludedPlayerUUID?.includes(this.player1.uuid)
    ) {
      this.player1!.socket?.send(msg);
    }

    if (
      this.player2 &&
      this.isPlayerAlive(this.player2) &&
      !this.player2Left &&
      !excludedPlayerUUID?.includes(this.player2.uuid)
    ) {
      this.player2!.socket?.send(msg);
    }

    this.spectators.forEach((player: Player) => {
      if (
        this.isPlayerAlive(player) &&
        !excludedPlayerUUID?.includes(player.uuid)
      ) {
        player!.socket?.send(msg);
      }
    });
  }

  /**
   * Sends a game message to all players.
   * @param data The GameMessageData to send.
   * @param excludedPlayerUUID The list of player UUID to excluded from the message.
   */
  public sendGameMessage(
    data: GameMessageData,
    excludedPlayerUUID?: string[],
  ): void {
    const msg: string = this.stringifyGameMessageData(data);
    this.sendMessage(msg, excludedPlayerUUID);
  }

  /**
   * Start the game by initializing game data.
   * @returns A promise that resolves when the game successfully started.
   */
  public startGame(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.gameEnded) return reject("Game already ended");
      if (this.gameLaunched) return reject("Game already started");
      if (!this.isFull()) return reject("Room is not full");
      if (!this.isPlayerAlive(this.player1))
        return reject(
          "Somehow the player 1 disconnected before the game start",
        );
      if (!this.isPlayerAlive(this.player2))
        return reject(
          "Somehow the player 2 disconnected before the game start",
        );

      this.gameLaunched = true;

      // Initialize game
      this.gameData = newGameData();
      resetBall(this.gameData.ball);
      this.gameStats = newGameStats();
      this.gameStats.gameStartTime = Date.now(); // game start time in milliseconds

      // Initialize replay data
      this.replayData.p1Skin = this.player1!.paddleSkinId;
      this.replayData.p2Skin = this.player2!.paddleSkinId;
      snapshotReplayData(this.replayData, 0, this.gameData);

      if (this.player1?.socket) {
        const gameStartedMessage: GameStartedMessage = {
          type: "gameStarted",
          id: 1,
        };
        this.player1.socket.send(
          this.stringifyGameMessageData(gameStartedMessage),
        );
      }

      if (this.player2?.socket) {
        const gameStartedMessage: GameStartedMessage = {
          type: "gameStarted",
          id: 2,
        };
        this.player2.socket.send(
          this.stringifyGameMessageData(gameStartedMessage),
        );
      }

      this.startMainLoop();

      console.log(
        `Game started: ${this.id} (${RoomType[this.type]}) with p1 '${this.player1?.username}' and p2 '${this.player2?.username}'`,
      );
      resolve();
    });
  }

  /**
   * Start the game main loop.
   */
  private startMainLoop(): void {
    let previousTime: number = Date.now();
    let roomMainLoopInterval: NodeJS.Timeout;
    let p1DisconnectionTimeout: number = 0;
    let p2DisconnectionTimeout: number = 0;

    roomMainLoopInterval = setInterval(() => {
      const currentTime: number = Date.now(); // Get the current time
      const deltaTime: number = (currentTime - previousTime) / 1000; // Time elapsed in seconds
      previousTime = currentTime; // Update the previous time

      // Check if player 1 is still alive
      if (!this.isPlayerAlive(this.player1) || this.player1Left) {
        if (p1DisconnectionTimeout === 0) {
          p1DisconnectionTimeout = currentTime + DISCONNECT_TIMEOUT;
        }

        if (currentTime > p1DisconnectionTimeout || this.player1Left) {
          // Player 1 has been disconnected for too long
          clearInterval(roomMainLoopInterval);
          this.endGame(1);
          return;
        }
      } else {
        p1DisconnectionTimeout = 0; // Reset the timeout if player 1 is alive
      }

      // Check if player 2 is still alive
      if (!this.isPlayerAlive(this.player2) || this.player2Left) {
        if (p2DisconnectionTimeout === 0) {
          p2DisconnectionTimeout = currentTime + DISCONNECT_TIMEOUT;
        }

        if (currentTime > p2DisconnectionTimeout || this.player2Left) {
          // Player 2 has been disconnected for too long
          clearInterval(roomMainLoopInterval);
          this.endGame(2);
          return;
        }
      } else {
        p2DisconnectionTimeout = 0; // Reset the timeout if player 2 is alive
      }

      // If the player is a bot update his paddle position
      if (this.player1?.isBot) {
        handleAIInput(
          this.gameData.paddle1Position,
          undefined,
          this.gameData.ball,
          deltaTime,
        );
      }

      if (this.player2?.isBot) {
        handleAIInput(
          this.gameData.paddle2Position,
          undefined,
          this.gameData.ball,
          deltaTime,
        );
      }

      // Use the computed deltaTime to update the ball position
      updateBallPosition(this.gameData, this.gameStats, deltaTime);
      const gameDataMessage: GameDataMessage = {
        type: "gameData",
        data: this.gameData,
      };
      this.sendGameMessage(gameDataMessage);

      // Snapshot the current game data
      const elapsedTimeSinceStart: number =
        currentTime - this.gameStats.gameStartTime;
      snapshotReplayData(this.replayData, elapsedTimeSinceStart, this.gameData);

      // Stop the game if one player reaches enought points
      if (
        this.gameData.p1Score >= this.scoreToWin ||
        this.gameData.p2Score >= this.scoreToWin
      ) {
        clearInterval(roomMainLoopInterval);
        this.endGame();
      }
    }, 16.67); // 60 TPS
  }

  /**
   * End the game
   */
  private endGame(disconnectedPlayer: -1 | 1 | 2 = -1): void {
    if (!this.gameLaunched) {
      throw new Error("Cannot end a game not launched");
    }
    console.log(`[Room ${this.id}] Fin de partie appelée`);

    this.gameEnded = true;
    this.gameStats.gameEndTime = Date.now(); // game end time in milliseconds

    if (disconnectedPlayer !== -1) {
      console.log(
        `[Room ${this.id}] : The player ${disconnectedPlayer} (${this.getPlayer(disconnectedPlayer)?.username ?? ""}) disconnected for too long`,
      );
      const disconnectionMessage: DisconnectionMessage = {
        type: "disconnection",
        id: disconnectedPlayer,
      };
      this.sendGameMessage(disconnectionMessage);
      this.winnerId = disconnectedPlayer === 1 ? 2 : 1;
    } else if (this.gameData.p1Score === this.gameData.p2Score) {
      this.winnerId = -1; // If the match ended by a draw
    } else {
      this.winnerId = this.gameData.p1Score > this.gameData.p2Score ? 1 : 2;
    }

    const gameResultMessage: GameResultMessage = {
      type: "gameResult",
      p1Score: this.gameData.p1Score,
      p2Score: this.gameData.p2Score,
      winnerUUID: this.winnerId === -1 ? "" : this.getPlayer(this.winnerId)!.uuid,
      winner: this.winnerId === -1 ? "" : this.getPlayer(this.winnerId)!.username,
      gameStats: this.gameStats,
    };
    this.sendGameMessage(gameResultMessage);

    this.saveGameSessionData(this.winnerId);

    this.gameEndedCallback?.(gameResultMessage);

    //this.clear();
    this.dispose(); // Dispose the room
  }

  /**
   * Save the game result and data in the database
   */
  private saveGameSessionData(winnerId: -1 | 1 | 2): void {
    if (!this.gameEnded)
      throw new Error("Cannot save the data of a game not ended");
    if (!this.player1)
      console.warn("[WARNING] missing player 1, this should not happen !");
    if (!this.player2)
      console.warn("[WARNING] missing player 2, this should not happen !");

    const uuid: string = uuidv4();

    // Save the match replay
    this.replayData.gameDuration = this.gameStats.gameEndTime - this.gameStats.gameStartTime;
    saveReplayDataToFile(this.replayData, uuid);

    saveMatchData(
      uuid,
      this.player1?.uuid ?? "", // put empty string by default if the player is null
      this.player2?.uuid ?? "",
      this.gameData.p1Score,
      this.gameData.p2Score,
      winnerId === 1 ? "A" : winnerId === 2 ? "B" : "draw",
      this.type,
    );
  }

  /**
   * Dispose the room and remove it from the map.
   * This should be called when the game is over and the room is no longer needed.
   */
  public dispose(): void {
    this.clear();
    this.gameEndedCallback = undefined;
    rooms.delete(this.id);
  }
}
