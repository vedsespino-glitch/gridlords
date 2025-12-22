const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();

const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');

function loadLeaderboard() {
    try {
        if (fs.existsSync(LEADERBOARD_FILE)) {
            const data = fs.readFileSync(LEADERBOARD_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('Error loading leaderboard:', err);
    }
    return [];
}

function saveLeaderboard(leaderboard) {
    try {
        fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2));
    } catch (err) {
        console.error('Error saving leaderboard:', err);
    }
}

function updateLeaderboard(nickname) {
    const leaderboard = loadLeaderboard();
    const existingPlayer = leaderboard.find(p => p.name.toLowerCase() === nickname.toLowerCase());
    
    if (existingPlayer) {
        existingPlayer.wins += 1;
        existingPlayer.name = nickname;
    } else {
        leaderboard.push({ name: nickname, wins: 1 });
    }
    
    leaderboard.sort((a, b) => b.wins - a.wins);
    saveLeaderboard(leaderboard);
    
    const playerEntry = leaderboard.find(p => p.name.toLowerCase() === nickname.toLowerCase());
    return playerEntry ? playerEntry.wins : 1;
}

function getTopRanking(limit = 10) {
    const leaderboard = loadLeaderboard();
    return leaderboard.slice(0, limit);
}
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/health', (req, res) => {
    const activeRooms = Object.keys(rooms).length;
    const totalPlayers = Object.values(rooms).reduce((sum, room) => sum + Object.keys(room.players).length, 0);
    res.json({ status: 'ok', activeRooms, totalPlayers });
});

const GRID_SIZE = 30;
const TICK_INTERVAL = 1000;
const MOUNTAIN_DENSITY = 0.15;

const TERRAIN = {
    EMPTY: 0,
    MOUNTAIN: 1,
    OUTPOST: 2,
    ARTILLERY: 3
};

const UNIT = {
    NONE: null,
    GENERAL: 'general'
};

const OUTPOST_CONFIG = {
    MIN_COUNT: 12,
    MAX_COUNT: 15,
    INITIAL_TROOPS: 10,
    MIN_DISTANCE_FROM_SPAWN: 6,
    TROOP_PRODUCTION: 1
};

const ARTILLERY_CONFIG = {
    MIN_COUNT: 6,
    MAX_COUNT: 8,
    INITIAL_TROOPS: 50,
    MIN_DISTANCE_FROM_SPAWN: 8,
    FIRE_INTERVAL: 1000,
    DAMAGE: 5
};

const PLAYER_COLORS = ['red', 'blue', 'green', 'yellow', 'purple'];
const MAX_PLAYERS = 4;
const MIN_PLAYERS_TO_START = 2;

const RECONNECT_TIMEOUT = 60000; // 60 seconds to reconnect

const rooms = {};
const socketToRoom = {};
const disconnectedPlayers = {}; // sessionToken -> { roomId, socketId, color, nickname, playerClass, disconnectTime, timeoutId }

function generateRoomId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let roomId;
    do {
        roomId = '';
        for (let i = 0; i < 4; i++) {
            roomId += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    } while (rooms[roomId]);
    return roomId;
}

function createRoomState(hostSocketId) {
    return {
        grid: [],
        players: {},
        playerClasses: {},
        playerNames: {},
        playerColors: {},
        playerSessionTokens: {},
        deadPlayers: {},
        playerCount: 0,
        gameStarted: false,
        winner: null,
        alivePlayers: 0,
        hostSocketId: hostSocketId,
        spawnPositions: null,
        timers: {
            gameLoop: null,
            artilleryLoop: null,
            tankOutpostLoop: null
        }
    };
}

function getRoomBySocketId(socketId) {
    const roomId = socketToRoom[socketId];
    return roomId ? rooms[roomId] : null;
}

function getRoomIdBySocketId(socketId) {
    return socketToRoom[socketId] || null;
}

const MIN_SPAWN_DISTANCE = 15;

function getCornerSpawnPositions() {
    const margin = 3;
    return [
        { x: margin, y: margin },
        { x: GRID_SIZE - margin - 1, y: margin },
        { x: margin, y: GRID_SIZE - margin - 1 },
        { x: GRID_SIZE - margin - 1, y: GRID_SIZE - margin - 1 }
    ];
}

function getManhattanDistance(x1, y1, x2, y2) {
    return Math.abs(x2 - x1) + Math.abs(y2 - y1);
}

function clearMountainsAround(roomState, x, y) {
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (roomState.grid[ny] && roomState.grid[ny][nx]) {
                if (roomState.grid[ny][nx].terrain === TERRAIN.MOUNTAIN) {
                    roomState.grid[ny][nx].terrain = TERRAIN.EMPTY;
                }
            }
        }
    }
}

function generateOutposts(roomState, redSpawn, blueSpawn) {
    const outpostCount = OUTPOST_CONFIG.MIN_COUNT + Math.floor(Math.random() * (OUTPOST_CONFIG.MAX_COUNT - OUTPOST_CONFIG.MIN_COUNT + 1));
    const outposts = [];
    const maxAttempts = 200;
    
    for (let i = 0; i < outpostCount; i++) {
        let placed = false;
        
        for (let attempt = 0; attempt < maxAttempts && !placed; attempt++) {
            const x = Math.floor(Math.random() * GRID_SIZE);
            const y = Math.floor(Math.random() * GRID_SIZE);
            
            const distToRed = getManhattanDistance(x, y, redSpawn.x, redSpawn.y);
            const distToBlue = getManhattanDistance(x, y, blueSpawn.x, blueSpawn.y);
            
            if (distToRed < OUTPOST_CONFIG.MIN_DISTANCE_FROM_SPAWN || 
                distToBlue < OUTPOST_CONFIG.MIN_DISTANCE_FROM_SPAWN) {
                continue;
            }
            
            const cell = roomState.grid[y][x];
            if (cell.terrain !== TERRAIN.EMPTY || cell.owner !== null) {
                continue;
            }
            
            const tooCloseToOther = outposts.some(op => 
                getManhattanDistance(x, y, op.x, op.y) < 3
            );
            if (tooCloseToOther) {
                continue;
            }
            
            roomState.grid[y][x] = {
                terrain: TERRAIN.OUTPOST,
                owner: null,
                troops: OUTPOST_CONFIG.INITIAL_TROOPS,
                unit: null
            };
            outposts.push({ x, y });
            placed = true;
        }
    }
    
    console.log('Generated ' + outposts.length + ' Outposts');
    return outposts;
}

function generateArtillery(roomState, redSpawn, blueSpawn, existingStructures) {
    const artilleryCount = ARTILLERY_CONFIG.MIN_COUNT + Math.floor(Math.random() * (ARTILLERY_CONFIG.MAX_COUNT - ARTILLERY_CONFIG.MIN_COUNT + 1));
    const artillery = [];
    const maxAttempts = 200;
    
    for (let i = 0; i < artilleryCount; i++) {
        let placed = false;
        
        for (let attempt = 0; attempt < maxAttempts && !placed; attempt++) {
            const x = Math.floor(Math.random() * GRID_SIZE);
            const y = Math.floor(Math.random() * GRID_SIZE);
            
            const distToRed = getManhattanDistance(x, y, redSpawn.x, redSpawn.y);
            const distToBlue = getManhattanDistance(x, y, blueSpawn.x, blueSpawn.y);
            
            if (distToRed < ARTILLERY_CONFIG.MIN_DISTANCE_FROM_SPAWN || 
                distToBlue < ARTILLERY_CONFIG.MIN_DISTANCE_FROM_SPAWN) {
                continue;
            }
            
            const cell = roomState.grid[y][x];
            if (cell.terrain !== TERRAIN.EMPTY || cell.owner !== null) {
                continue;
            }
            
            const tooCloseToOther = [...existingStructures, ...artillery].some(s => 
                getManhattanDistance(x, y, s.x, s.y) < 4
            );
            if (tooCloseToOther) {
                continue;
            }
            
            roomState.grid[y][x] = {
                terrain: TERRAIN.ARTILLERY,
                owner: null,
                troops: ARTILLERY_CONFIG.INITIAL_TROOPS,
                unit: null
            };
            artillery.push({ x, y });
            placed = true;
        }
    }
    
    console.log('Generated ' + artillery.length + ' Artillery');
    return artillery;
}

function initializeRoomMap(roomState) {
    roomState.spawnPositions = getCornerSpawnPositions();
    roomState.grid = [];

    for (let y = 0; y < GRID_SIZE; y++) {
        roomState.grid[y] = [];
        for (let x = 0; x < GRID_SIZE; x++) {
            const isMountain = Math.random() < MOUNTAIN_DENSITY;
            roomState.grid[y][x] = {
                terrain: isMountain ? TERRAIN.MOUNTAIN : TERRAIN.EMPTY,
                owner: null,
                troops: 0,
                unit: null
            };
        }
    }

    for (let i = 0; i < MAX_PLAYERS; i++) {
        const spawn = roomState.spawnPositions[i];
        const color = PLAYER_COLORS[i];
        
        roomState.grid[spawn.y][spawn.x] = {
            terrain: TERRAIN.EMPTY,
            owner: color,
            troops: 10,
            unit: UNIT.GENERAL
        };
        
        clearMountainsAround(roomState, spawn.x, spawn.y);
    }

    const outposts = generateOutposts(roomState, roomState.spawnPositions[0], roomState.spawnPositions[1]);
    generateArtillery(roomState, roomState.spawnPositions[0], roomState.spawnPositions[1], outposts);
}

function gameTick(roomId) {
    const roomState = rooms[roomId];
    if (!roomState || !roomState.gameStarted || roomState.winner) return;

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = roomState.grid[y][x];
            
            if (cell.unit === UNIT.GENERAL && cell.owner) {
                cell.troops += 1;
            }
            
            if (cell.terrain === TERRAIN.OUTPOST && cell.owner) {
                const ownerId = Object.keys(roomState.players).find(
                    id => roomState.players[id] === cell.owner
                );
                const ownerClass = ownerId ? roomState.playerClasses[ownerId] : null;
                if (ownerClass !== 'tank') {
                    cell.troops += OUTPOST_CONFIG.TROOP_PRODUCTION;
                }
            }
        }
    }

    emitGameStateToRoom(roomId);
}

function tankOutpostTick(roomId) {
    const roomState = rooms[roomId];
    if (!roomState || !roomState.gameStarted || roomState.winner) return;

    let stateChanged = false;
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = roomState.grid[y][x];
            
            if (cell.terrain === TERRAIN.OUTPOST && cell.owner) {
                const ownerId = Object.keys(roomState.players).find(
                    id => roomState.players[id] === cell.owner
                );
                const ownerClass = ownerId ? roomState.playerClasses[ownerId] : null;
                if (ownerClass === 'tank') {
                    cell.troops += OUTPOST_CONFIG.TROOP_PRODUCTION;
                    stateChanged = true;
                }
            }
        }
    }

    if (stateChanged) {
        emitGameStateToRoom(roomId);
    }
}

function artilleryTick(roomId) {
    const roomState = rooms[roomId];
    if (!roomState || !roomState.gameStarted || roomState.winner) return;

    const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    let stateChanged = false;

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = roomState.grid[y][x];
            
            if (cell.terrain !== TERRAIN.ARTILLERY) continue;
            
            const artilleryOwner = cell.owner;
            
            for (const [dx, dy] of directions) {
                const nx = x + dx;
                const ny = y + dy;
                
                if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
                
                const targetCell = roomState.grid[ny][nx];
                
                if (!targetCell.owner) continue;
                
                const isEnemy = artilleryOwner === null || targetCell.owner !== artilleryOwner;
                
                if (isEnemy && targetCell.troops > 0) {
                    const targetOwner = targetCell.owner;
                    targetCell.troops -= ARTILLERY_CONFIG.DAMAGE;
                    
                    io.to(roomId).emit('artilleryFire', {
                        from: { x, y },
                        to: { nx, ny },
                        damage: ARTILLERY_CONFIG.DAMAGE,
                        artilleryOwner: artilleryOwner || 'neutral',
                        targetOwner: targetOwner
                    });
                    
                    if (targetCell.troops <= 0) {
                        targetCell.troops = 0;
                        targetCell.owner = null;
                        
                        if (targetCell.unit === UNIT.GENERAL) {
                            const loserSocketId = Object.keys(roomState.players).find(
                                id => roomState.players[id] === targetOwner
                            );
                            if (loserSocketId) {
                                eliminatePlayer(roomId, loserSocketId, null, 'artillery');
                            }
                            targetCell.unit = null;
                        }
                    }
                    
                    stateChanged = true;
                }
            }
        }
    }

    if (stateChanged) {
        emitGameStateToRoom(roomId);
    }
}

const TANK_OUTPOST_INTERVAL = 800;

function startGameLoop(roomId) {
    const roomState = rooms[roomId];
    if (!roomState) return;
    
    if (roomState.timers.gameLoop) {
        console.log('Game loop already running for room ' + roomId + ', skipping start');
        return;
    }
    console.log('--- GAME LOOP STARTED for room ' + roomId + ' ---');
    roomState.timers.gameLoop = setInterval(() => gameTick(roomId), TICK_INTERVAL);
    roomState.timers.artilleryLoop = setInterval(() => artilleryTick(roomId), ARTILLERY_CONFIG.FIRE_INTERVAL);
    roomState.timers.tankOutpostLoop = setInterval(() => tankOutpostTick(roomId), TANK_OUTPOST_INTERVAL);
}

function stopGameLoop(roomId) {
    const roomState = rooms[roomId];
    if (!roomState) return;
    
    if (roomState.timers.gameLoop) {
        clearInterval(roomState.timers.gameLoop);
        roomState.timers.gameLoop = null;
        console.log('--- GAME LOOP STOPPED for room ' + roomId + ' ---');
    }
    if (roomState.timers.artilleryLoop) {
        clearInterval(roomState.timers.artilleryLoop);
        roomState.timers.artilleryLoop = null;
    }
    if (roomState.timers.tankOutpostLoop) {
        clearInterval(roomState.timers.tankOutpostLoop);
        roomState.timers.tankOutpostLoop = null;
    }
}

function startBattleRoyale(roomId) {
    const roomState = rooms[roomId];
    if (!roomState) return;
    
    roomState.gameStarted = true;
    roomState.alivePlayers = Object.keys(roomState.players).length;
    roomState.playerCount = roomState.alivePlayers;
    
    for (const socketId of Object.keys(roomState.players)) {
        roomState.deadPlayers[socketId] = false;
    }
    
    io.to(roomId).emit('gameStart', { 
        totalPlayers: roomState.alivePlayers,
        mode: 'battle_royale'
    });
    emitGameStateToRoom(roomId);
    startGameLoop(roomId);
    console.log('Battle Royale started in room ' + roomId + ' with ' + roomState.alivePlayers + ' players!');
}

function broadcastRoomInfo(roomId) {
    const roomState = rooms[roomId];
    if (!roomState) return;
    
    const playerList = [];
    for (const [socketId, color] of Object.entries(roomState.players)) {
        playerList.push({
            socketId: socketId,
            color: color,
            name: roomState.playerNames[socketId] || color.toUpperCase(),
            isHost: socketId === roomState.hostSocketId,
            playerClass: roomState.playerClasses[socketId]
        });
    }
    
    io.to(roomId).emit('roomInfo', {
        roomId: roomId,
        players: playerList,
        playerCount: Object.keys(roomState.players).length,
        maxPlayers: MAX_PLAYERS,
        minPlayers: MIN_PLAYERS_TO_START,
        gameStarted: roomState.gameStarted,
        hostSocketId: roomState.hostSocketId
    });
}

function broadcastPlayerCount(roomId) {
    const roomState = rooms[roomId];
    if (!roomState) return;
    
    const count = Object.keys(roomState.players).length;
    const alive = roomState.gameStarted ? roomState.alivePlayers : count;
    io.to(roomId).emit('playerCount', { 
        current: count, 
        required: MAX_PLAYERS,
        minRequired: MIN_PLAYERS_TO_START,
        alive: alive,
        canForceStart: false
    });
}

function resetRoomForNewMatch(roomId) {
    const roomState = rooms[roomId];
    if (!roomState) return;
    
    console.log('Resetting room ' + roomId + ' for new match...');
    stopGameLoop(roomId);
    
    roomState.gameStarted = false;
    roomState.winner = null;
    roomState.alivePlayers = 0;
    roomState.deadPlayers = {};
    
    initializeRoomMap(roomState);
    
    io.to(roomId).emit('gameReset');
    emitGameStateToRoom(roomId);
    broadcastRoomInfo(roomId);
}

function cleanupRoom(roomId) {
    const roomState = rooms[roomId];
    if (!roomState) return;
    
    stopGameLoop(roomId);
    delete rooms[roomId];
    console.log('Room ' + roomId + ' cleaned up');
}

function getVisibleCells(roomState, playerColor) {
    const visible = new Set();
    
    const playerId = Object.keys(roomState.players).find(
        id => roomState.players[id] === playerColor
    );
    const playerClass = playerId ? roomState.playerClasses[playerId] : null;
    const visionRange = playerClass === 'scout' ? 3 : 1;
    
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = roomState.grid[y][x];
            if (cell.owner === playerColor) {
                visible.add(x + ',' + y);
                for (let dy = -visionRange; dy <= visionRange; dy++) {
                    for (let dx = -visionRange; dx <= visionRange; dx++) {
                        if (Math.abs(dx) + Math.abs(dy) <= visionRange) {
                            const nx = x + dx;
                            const ny = y + dy;
                            if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
                                visible.add(nx + ',' + ny);
                            }
                        }
                    }
                }
            }
        }
    }
    
    return visible;
}

function getFilteredGameState(roomState, playerColor) {
    const visible = getVisibleCells(roomState, playerColor);
    const filteredGrid = [];
    
    for (let y = 0; y < GRID_SIZE; y++) {
        filteredGrid[y] = [];
        for (let x = 0; x < GRID_SIZE; x++) {
            const key = x + ',' + y;
            if (visible.has(key)) {
                filteredGrid[y][x] = { ...roomState.grid[y][x] };
            } else {
                filteredGrid[y][x] = { isFog: true };
            }
        }
    }
    
    return {
        grid: filteredGrid,
        gameStarted: roomState.gameStarted,
        winner: roomState.winner,
        playerCount: roomState.playerCount
    };
}

function emitGameStateToRoom(roomId) {
    const roomState = rooms[roomId];
    if (!roomState) return;
    
    for (const [socketId, playerColor] of Object.entries(roomState.players)) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
            socket.emit('gameState', getFilteredGameState(roomState, playerColor));
        }
    }
}

function isValidMove(roomState, playerId, from, to) {
    const playerColor = roomState.players[playerId];
    if (!playerColor) return false;

    const fromCell = roomState.grid[from.y] && roomState.grid[from.y][from.x];
    if (!fromCell || fromCell.owner !== playerColor) return false;

    if (fromCell.troops <= 1) return false;

    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    if (dx + dy !== 1) return false;

    const toCell = roomState.grid[to.y] && roomState.grid[to.y][to.x];
    if (!toCell || toCell.terrain === TERRAIN.MOUNTAIN) return false;

    return true;
}

function executeMove(roomId, playerId, from, to, splitMove) {
    splitMove = splitMove || false;
    const roomState = rooms[roomId];
    if (!roomState) return;
    
    const playerColor = roomState.players[playerId];
    const fromCell = roomState.grid[from.y][from.x];
    const toCell = roomState.grid[to.y][to.x];
    
    const isMovingGeneral = fromCell.unit === UNIT.GENERAL;
    
    let troopsToMove;
    if (splitMove) {
        troopsToMove = Math.floor(fromCell.troops / 2);
        if (troopsToMove < 1) {
            return;
        }
        fromCell.troops = fromCell.troops - troopsToMove;
    } else {
        troopsToMove = fromCell.troops - 1;
        fromCell.troops = 1;
    }
    
    let moveSuccessful = false;
    let capturedEnemyGeneral = false;
    let capturedOwner = null;

    if (toCell.owner === playerColor) {
        toCell.troops += troopsToMove;
        moveSuccessful = true;
    } else {
        const result = troopsToMove - toCell.troops;
        if (result > 0) {
            if (toCell.unit === UNIT.GENERAL && toCell.owner) {
                capturedEnemyGeneral = true;
                capturedOwner = toCell.owner;
            }

            toCell.owner = playerColor;
            toCell.troops = result;
            if (capturedEnemyGeneral) {
                toCell.unit = null;
            }
            moveSuccessful = true;
        } else if (result < 0) {
            toCell.troops = Math.abs(result);
        } else {
            toCell.troops = 0;
            toCell.owner = null;
        }
    }
    
    if (isMovingGeneral && moveSuccessful && toCell.owner === playerColor && !splitMove) {
        fromCell.unit = null;
        toCell.unit = UNIT.GENERAL;
    }

    if (capturedEnemyGeneral && capturedOwner) {
        const loserSocketId = Object.keys(roomState.players).find(
            id => roomState.players[id] === capturedOwner
        );
        if (loserSocketId) {
            eliminatePlayer(roomId, loserSocketId, playerId, 'captured');
        }
    }

    emitGameStateToRoom(roomId);
}

function getPlayerNamesForBroadcast(roomState) {
    const names = {};
    for (const [socketId, color] of Object.entries(roomState.players)) {
        names[color] = roomState.playerNames[socketId] || color.toUpperCase();
    }
    return names;
}

function getPlayerClassesForBroadcast(roomState) {
    const classes = {};
    for (const [socketId, color] of Object.entries(roomState.players)) {
        classes[color] = roomState.playerClasses[socketId] || 'rusher';
    }
    return classes;
}

function broadcastPlayerNames(roomId) {
    const roomState = rooms[roomId];
    if (!roomState) return;
    
    const names = getPlayerNamesForBroadcast(roomState);
    const classes = getPlayerClassesForBroadcast(roomState);
    io.to(roomId).emit('playerNames', { names: names, classes: classes });
}

function eliminatePlayer(roomId, loserSocketId, attackerSocketId, reason) {
    reason = reason || 'captured';
    const roomState = rooms[roomId];
    if (!roomState) return;
    
    const loserColor = roomState.players[loserSocketId];
    const attackerColor = attackerSocketId ? roomState.players[attackerSocketId] : null;
    
    console.log('Eliminating player ' + loserColor + ' in room ' + roomId + ' (reason: ' + reason + ')');
    
    roomState.deadPlayers[loserSocketId] = true;
    roomState.alivePlayers--;
    
    if (attackerColor && reason === 'captured') {
        let cellsTransferred = 0;
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const cell = roomState.grid[y][x];
                if (cell.owner === loserColor) {
                    cell.owner = attackerColor;
                    cellsTransferred++;
                }
            }
        }
        console.log('Transferred ' + cellsTransferred + ' cells from ' + loserColor + ' to ' + attackerColor);
    }
    
    const loserSocket = io.sockets.sockets.get(loserSocketId);
    if (loserSocket) {
        loserSocket.emit('eliminated', { 
            reason: reason,
            killedBy: attackerColor,
            placement: roomState.alivePlayers + 1
        });
    }
    
    io.to(roomId).emit('playerEliminated', {
        eliminatedColor: loserColor,
        eliminatedBy: attackerColor,
        alivePlayers: roomState.alivePlayers
    });
    
    checkForWinner(roomId);
}

function checkForWinner(roomId) {
    const roomState = rooms[roomId];
    if (!roomState) return;
    
    if (roomState.alivePlayers === 1) {
        const winnerSocketId = Object.keys(roomState.players).find(
            id => !roomState.deadPlayers[id]
        );
        
        if (winnerSocketId) {
            const winnerColor = roomState.players[winnerSocketId];
            const winnerName = roomState.playerNames[winnerSocketId] || 'Unknown';
            roomState.winner = winnerColor;
            
            const totalWins = updateLeaderboard(winnerName);
            
            io.to(roomId).emit('gameOver', { 
                winner: winnerColor,
                winnerName: winnerName,
                winnerSocketId: winnerSocketId,
                totalWins: totalWins,
                reason: 'last_man_standing'
            });
            
            console.log('Game Over in room ' + roomId + '! Winner: ' + winnerName + ' (' + winnerColor + ') - Victory #' + totalWins);
        }
    } else if (roomState.alivePlayers === 0) {
        roomState.winner = 'draw';
        io.to(roomId).emit('gameOver', { winner: null, reason: 'draw' });
        console.log('Game Over in room ' + roomId + '! Draw - no survivors');
    }
}

function promoteNewHost(roomId) {
    const roomState = rooms[roomId];
    if (!roomState) return;
    
    const remainingPlayers = Object.keys(roomState.players);
    if (remainingPlayers.length > 0) {
        roomState.hostSocketId = remainingPlayers[0];
        console.log('New host promoted in room ' + roomId + ': ' + roomState.hostSocketId);
        broadcastRoomInfo(roomId);
    }
}

function markPlayerDisconnected(roomId, socketId, sessionToken) {
    const roomState = rooms[roomId];
    if (!roomState) return;
    
    const playerColor = roomState.players[socketId];
    const playerNickname = roomState.playerNames[socketId];
    const playerClass = roomState.playerClasses[socketId];
    
    if (!sessionToken || !playerColor) return;
    
    console.log('Marking player ' + playerNickname + ' (' + playerColor + ') as disconnected with token ' + sessionToken);
    
    const timeoutId = setTimeout(() => {
        console.log('Reconnection timeout expired for ' + playerNickname + ' (' + sessionToken + ')');
        finalizePlayerDisconnect(roomId, sessionToken);
    }, RECONNECT_TIMEOUT);
    
    disconnectedPlayers[sessionToken] = {
        roomId: roomId,
        oldSocketId: socketId,
        color: playerColor,
        nickname: playerNickname,
        playerClass: playerClass,
        disconnectTime: Date.now(),
        timeoutId: timeoutId
    };
    
    io.to(roomId).emit('playerDisconnecting', {
        color: playerColor,
        nickname: playerNickname,
        timeout: RECONNECT_TIMEOUT / 1000
    });
}

function finalizePlayerDisconnect(roomId, sessionToken) {
    const disconnectedPlayer = disconnectedPlayers[sessionToken];
    if (!disconnectedPlayer) return;
    
    const roomState = rooms[roomId];
    if (!roomState) {
        delete disconnectedPlayers[sessionToken];
        return;
    }
    
    console.log('Finalizing disconnect for ' + disconnectedPlayer.nickname + ' - timeout expired');
    
    const oldSocketId = disconnectedPlayer.oldSocketId;
    
    if (roomState.gameStarted && !roomState.deadPlayers[oldSocketId]) {
        eliminatePlayer(roomId, oldSocketId, null, 'disconnect');
    }
    
    delete roomState.players[oldSocketId];
    delete roomState.playerClasses[oldSocketId];
    delete roomState.playerNames[oldSocketId];
    delete roomState.playerColors[oldSocketId];
    delete roomState.playerSessionTokens[oldSocketId];
    delete roomState.deadPlayers[oldSocketId];
    roomState.playerCount = Object.keys(roomState.players).length;
    
    if (Object.keys(roomState.players).length === 0) {
        cleanupRoom(roomId);
    } else {
        if (oldSocketId === roomState.hostSocketId) {
            promoteNewHost(roomId);
        }
        
        if (!roomState.gameStarted) {
            broadcastRoomInfo(roomId);
            broadcastPlayerNames(roomId);
        }
    }
    
    delete disconnectedPlayers[sessionToken];
}

function tryReconnectPlayer(socket, sessionToken) {
    const disconnectedPlayer = disconnectedPlayers[sessionToken];
    if (!disconnectedPlayer) return false;
    
    const roomId = disconnectedPlayer.roomId;
    const roomState = rooms[roomId];
    
    if (!roomState) {
        clearTimeout(disconnectedPlayer.timeoutId);
        delete disconnectedPlayers[sessionToken];
        return false;
    }
    
    if (roomState.winner) {
        clearTimeout(disconnectedPlayer.timeoutId);
        delete disconnectedPlayers[sessionToken];
        return false;
    }
    
    console.log('Reconnecting player ' + disconnectedPlayer.nickname + ' (' + disconnectedPlayer.color + ') to room ' + roomId);
    
    clearTimeout(disconnectedPlayer.timeoutId);
    
    const oldSocketId = disconnectedPlayer.oldSocketId;
    const newSocketId = socket.id;
    
    if (roomState.players[oldSocketId]) {
        roomState.players[newSocketId] = roomState.players[oldSocketId];
        delete roomState.players[oldSocketId];
    } else {
        roomState.players[newSocketId] = disconnectedPlayer.color;
    }
    
    if (roomState.playerClasses[oldSocketId]) {
        roomState.playerClasses[newSocketId] = roomState.playerClasses[oldSocketId];
        delete roomState.playerClasses[oldSocketId];
    } else {
        roomState.playerClasses[newSocketId] = disconnectedPlayer.playerClass;
    }
    
    if (roomState.playerNames[oldSocketId]) {
        roomState.playerNames[newSocketId] = roomState.playerNames[oldSocketId];
        delete roomState.playerNames[oldSocketId];
    } else {
        roomState.playerNames[newSocketId] = disconnectedPlayer.nickname;
    }
    
    if (roomState.playerColors[oldSocketId]) {
        roomState.playerColors[newSocketId] = roomState.playerColors[oldSocketId];
        delete roomState.playerColors[oldSocketId];
    }
    
    roomState.playerSessionTokens[newSocketId] = sessionToken;
    delete roomState.playerSessionTokens[oldSocketId];
    
    if (roomState.deadPlayers[oldSocketId] !== undefined) {
        roomState.deadPlayers[newSocketId] = roomState.deadPlayers[oldSocketId];
        delete roomState.deadPlayers[oldSocketId];
    }
    
    if (roomState.hostSocketId === oldSocketId) {
        roomState.hostSocketId = newSocketId;
    }
    
    socketToRoom[newSocketId] = roomId;
    delete socketToRoom[oldSocketId];
    socket.join(roomId);
    
    console.log('Socket ID transfer complete. New mappings:');
    console.log('  socketToRoom[' + newSocketId + '] =', socketToRoom[newSocketId]);
    console.log('  roomState.players[' + newSocketId + '] =', roomState.players[newSocketId]);
    console.log('  All players in room:', Object.keys(roomState.players));
    
    socket.emit('reconnected', {
        roomId: roomId,
        color: disconnectedPlayer.color,
        playerClass: disconnectedPlayer.playerClass,
        gameStarted: roomState.gameStarted,
        isHost: roomState.hostSocketId === newSocketId
    });
    
    socket.emit('gameState', getFilteredGameState(roomState, disconnectedPlayer.color));
    
    io.to(roomId).emit('playerReconnected', {
        color: disconnectedPlayer.color,
        nickname: disconnectedPlayer.nickname
    });
    
    broadcastPlayerNames(roomId);
    
    delete disconnectedPlayers[sessionToken];
    
    console.log('Player ' + disconnectedPlayer.nickname + ' successfully reconnected!');
    return true;
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    const sessionToken = socket.handshake.auth.sessionToken;
    let alreadyReconnected = false;
    
    if (sessionToken && disconnectedPlayers[sessionToken]) {
        console.log('Attempting reconnection with token:', sessionToken);
        alreadyReconnected = tryReconnectPlayer(socket, sessionToken);
    }

    socket.on('createRoom', (data) => {
        if (alreadyReconnected) {
            socket.emit('error', { message: 'Already reconnected to a game' });
            return;
        }
        const nickname = data.nickname;
        const playerClass = data.playerClass;
        const playerSessionToken = data.sessionToken;
        
        if (socketToRoom[socket.id]) {
            socket.emit('error', { message: 'Already in a room' });
            return;
        }
        
        const roomId = generateRoomId();
        rooms[roomId] = createRoomState(socket.id);
        const roomState = rooms[roomId];
        
        initializeRoomMap(roomState);
        
        socketToRoom[socket.id] = roomId;
        socket.join(roomId);
        
        const usedColors = Object.values(roomState.players);
        const playerColor = PLAYER_COLORS.find(color => !usedColors.includes(color));
        
        roomState.players[socket.id] = playerColor;
        roomState.playerClasses[socket.id] = playerClass || 'rusher';
        roomState.playerNames[socket.id] = nickname || 'General 1';
        roomState.playerColors[socket.id] = playerColor;
        roomState.playerSessionTokens[socket.id] = playerSessionToken;
        roomState.playerCount = 1;
        
        if (roomState.playerClasses[socket.id] === 'rusher') {
            for (let y = 0; y < GRID_SIZE; y++) {
                for (let x = 0; x < GRID_SIZE; x++) {
                    const cell = roomState.grid[y][x];
                    if (cell.unit === UNIT.GENERAL && cell.owner === playerColor) {
                        cell.troops = 150;
                    }
                }
            }
        }
        
        socket.emit('roomCreated', { roomId: roomId });
        socket.emit('playerAssigned', { color: playerColor, playerClass: roomState.playerClasses[socket.id], isHost: true });
        socket.emit('gameState', getFilteredGameState(roomState, playerColor));
        broadcastRoomInfo(roomId);
        broadcastPlayerNames(roomId);
        
        console.log('Room ' + roomId + ' created by ' + socket.id + ' (' + nickname + ')');
    });

    socket.on('joinRoom', (data) => {
        if (alreadyReconnected) {
            socket.emit('error', { message: 'Already reconnected to a game' });
            return;
        }
        
        const roomId = data.roomId;
        const nickname = data.nickname;
        const playerClass = data.playerClass;
        const playerSessionToken = data.sessionToken;
        const upperRoomId = roomId.toUpperCase();
        
        if (socketToRoom[socket.id]) {
            socket.emit('error', { message: 'Already in a room' });
            return;
        }
        
        if (!rooms[upperRoomId]) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }
        
        const roomState = rooms[upperRoomId];
        
        if (roomState.gameStarted) {
            if (playerSessionToken) {
                if (disconnectedPlayers[playerSessionToken] && disconnectedPlayers[playerSessionToken].roomId === upperRoomId) {
                    console.log('Reconnecting via joinRoom with token:', playerSessionToken);
                    if (tryReconnectPlayer(socket, playerSessionToken)) {
                        alreadyReconnected = true;
                        return;
                    }
                }
                
                const existingSocketId = Object.keys(roomState.playerSessionTokens).find(
                    sid => roomState.playerSessionTokens[sid] === playerSessionToken
                );
                if (existingSocketId) {
                    console.log('Reconnecting existing player via joinRoom, old socket:', existingSocketId);
                    
                    const playerColor = roomState.players[existingSocketId];
                    const existingPlayerClass = roomState.playerClasses[existingSocketId];
                    const existingNickname = roomState.playerNames[existingSocketId];
                    const isHost = roomState.hostSocketId === existingSocketId;
                    
                    roomState.players[socket.id] = playerColor;
                    delete roomState.players[existingSocketId];
                    
                    roomState.playerClasses[socket.id] = existingPlayerClass;
                    delete roomState.playerClasses[existingSocketId];
                    
                    roomState.playerNames[socket.id] = existingNickname;
                    delete roomState.playerNames[existingSocketId];
                    
                    roomState.playerColors[socket.id] = playerColor;
                    delete roomState.playerColors[existingSocketId];
                    
                    roomState.playerSessionTokens[socket.id] = playerSessionToken;
                    delete roomState.playerSessionTokens[existingSocketId];
                    
                    if (roomState.deadPlayers[existingSocketId] !== undefined) {
                        roomState.deadPlayers[socket.id] = roomState.deadPlayers[existingSocketId];
                        delete roomState.deadPlayers[existingSocketId];
                    }
                    
                    if (isHost) {
                        roomState.hostSocketId = socket.id;
                    }
                    
                    socketToRoom[socket.id] = upperRoomId;
                    delete socketToRoom[existingSocketId];
                    socket.join(upperRoomId);
                    
                    console.log('joinRoom reconnection - Socket ID transfer complete:');
                    console.log('  Old socket:', existingSocketId, '-> New socket:', socket.id);
                    console.log('  socketToRoom[' + socket.id + '] =', socketToRoom[socket.id]);
                    console.log('  roomState.players[' + socket.id + '] =', roomState.players[socket.id]);
                    console.log('  All players in room:', Object.keys(roomState.players));
                    
                    socket.emit('reconnected', {
                        roomId: upperRoomId,
                        color: playerColor,
                        playerClass: existingPlayerClass,
                        gameStarted: roomState.gameStarted,
                        isHost: roomState.hostSocketId === socket.id
                    });
                    
                    socket.emit('gameState', getFilteredGameState(roomState, playerColor));
                    
                    io.to(upperRoomId).emit('playerReconnected', {
                        color: playerColor,
                        nickname: existingNickname
                    });
                    
                    broadcastPlayerNames(upperRoomId);
                    alreadyReconnected = true;
                    
                    console.log('Player ' + existingNickname + ' reconnected via joinRoom!');
                    return;
                }
            }
            
            socket.emit('error', { message: 'Game already in progress' });
            return;
        }
        
        const playerCount = Object.keys(roomState.players).length;
        if (playerCount >= MAX_PLAYERS) {
            socket.emit('error', { message: 'Room is full' });
            return;
        }
        
        socketToRoom[socket.id] = upperRoomId;
        socket.join(upperRoomId);
        
        const usedColors = Object.values(roomState.players);
        const playerColor = PLAYER_COLORS.find(color => !usedColors.includes(color));
        
        const playerNumber = Object.keys(roomState.players).length + 1;
        roomState.players[socket.id] = playerColor;
        roomState.playerClasses[socket.id] = playerClass || 'rusher';
        roomState.playerNames[socket.id] = nickname || ('General ' + playerNumber);
        roomState.playerColors[socket.id] = playerColor;
        roomState.playerSessionTokens[socket.id] = playerSessionToken;
        roomState.playerCount = Object.keys(roomState.players).length;
        
        if (roomState.playerClasses[socket.id] === 'rusher') {
            for (let y = 0; y < GRID_SIZE; y++) {
                for (let x = 0; x < GRID_SIZE; x++) {
                    const cell = roomState.grid[y][x];
                    if (cell.unit === UNIT.GENERAL && cell.owner === playerColor) {
                        cell.troops = 150;
                    }
                }
            }
        }
        
        socket.emit('roomJoined', { roomId: upperRoomId });
        socket.emit('playerAssigned', { 
            color: playerColor, 
            playerClass: roomState.playerClasses[socket.id], 
            isHost: socket.id === roomState.hostSocketId 
        });
        socket.emit('gameState', getFilteredGameState(roomState, playerColor));
        broadcastRoomInfo(upperRoomId);
        broadcastPlayerNames(upperRoomId);
        
        console.log('Player ' + socket.id + ' (' + nickname + ') joined room ' + upperRoomId);
    });

    socket.on('hostStartGame', () => {
        const roomId = getRoomIdBySocketId(socket.id);
        if (!roomId) return;
        
        const roomState = rooms[roomId];
        if (!roomState) return;
        
        if (socket.id !== roomState.hostSocketId) {
            socket.emit('error', { message: 'Only the host can start the game' });
            return;
        }
        
        const playerCount = Object.keys(roomState.players).length;
        if (playerCount < MIN_PLAYERS_TO_START) {
            socket.emit('error', { message: 'Need at least ' + MIN_PLAYERS_TO_START + ' players to start' });
            return;
        }
        
        if (roomState.gameStarted) {
            socket.emit('error', { message: 'Game already started' });
            return;
        }
        
        startBattleRoyale(roomId);
        console.log('Host ' + socket.id + ' started game in room ' + roomId);
    });

    socket.on('move', (data) => {
        const roomId = getRoomIdBySocketId(socket.id);
        if (!roomId) {
            console.log('Move rejected: socket.id', socket.id, 'not found in socketToRoom');
            return;
        }
        
        const roomState = rooms[roomId];
        if (!roomState || !roomState.gameStarted || roomState.winner) {
            console.log('Move rejected: roomState invalid, gameStarted:', roomState?.gameStarted, 'winner:', roomState?.winner);
            return;
        }
        if (roomState.deadPlayers[socket.id]) {
            console.log('Move rejected: player is dead');
            return;
        }

        const from = data.from;
        const to = data.to;
        const splitMove = data.splitMove;
        const playerColor = roomState.players[socket.id];
        console.log('Move attempt by socket.id:', socket.id, 'playerColor:', playerColor, 'from:', from, 'to:', to);
        
        if (isValidMove(roomState, socket.id, from, to)) {
            executeMove(roomId, socket.id, from, to, splitMove || false);
        } else {
            console.log('Move rejected: isValidMove returned false. Players map:', Object.keys(roomState.players));
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        const roomId = getRoomIdBySocketId(socket.id);
        
        if (roomId) {
            const roomState = rooms[roomId];
            
            if (roomState) {
                const playerSessionToken = roomState.playerSessionTokens[socket.id];
                
                if (roomState.gameStarted && !roomState.deadPlayers[socket.id] && playerSessionToken) {
                    markPlayerDisconnected(roomId, socket.id, playerSessionToken);
                    delete socketToRoom[socket.id];
                    return;
                }
                
                if (roomState.gameStarted && !roomState.deadPlayers[socket.id]) {
                    eliminatePlayer(roomId, socket.id, null, 'disconnect');
                }
                
                delete roomState.players[socket.id];
                delete roomState.playerClasses[socket.id];
                delete roomState.playerNames[socket.id];
                delete roomState.playerColors[socket.id];
                delete roomState.playerSessionTokens[socket.id];
                delete roomState.deadPlayers[socket.id];
                roomState.playerCount = Object.keys(roomState.players).length;
                
                if (Object.keys(roomState.players).length === 0) {
                    cleanupRoom(roomId);
                } else {
                    if (socket.id === roomState.hostSocketId) {
                        promoteNewHost(roomId);
                    }
                    
                    if (!roomState.gameStarted) {
                        broadcastRoomInfo(roomId);
                        broadcastPlayerNames(roomId);
                    }
                }
            }
            
            delete socketToRoom[socket.id];
        }
    });

    socket.on('requestReset', () => {
        const roomId = getRoomIdBySocketId(socket.id);
        if (!roomId) return;
        
        const roomState = rooms[roomId];
        if (!roomState) return;
        
        if (roomState.winner || !roomState.gameStarted) {
            resetRoomForNewMatch(roomId);
        }
    });

    socket.on('leaveRoom', () => {
        const roomId = getRoomIdBySocketId(socket.id);
        if (!roomId) return;
        
        const roomState = rooms[roomId];
        if (roomState) {
            delete roomState.players[socket.id];
            delete roomState.playerClasses[socket.id];
            delete roomState.playerNames[socket.id];
            delete roomState.playerColors[socket.id];
            delete roomState.playerSessionTokens[socket.id];
            roomState.playerCount = Object.keys(roomState.players).length;
            
            socket.leave(roomId);
            
            if (Object.keys(roomState.players).length === 0) {
                cleanupRoom(roomId);
            } else {
                if (socket.id === roomState.hostSocketId) {
                    promoteNewHost(roomId);
                }
                broadcastRoomInfo(roomId);
                broadcastPlayerNames(roomId);
            }
        }
        
        delete socketToRoom[socket.id];
        socket.emit('leftRoom');
    });

    socket.on('send_message', (data) => {
        const roomId = getRoomIdBySocketId(socket.id);
        if (!roomId) return;
        
        const roomState = rooms[roomId];
        if (!roomState) return;
        
        const text = data.text;
        if (!text || text.trim().length === 0) return;
        
        const nickname = roomState.playerNames[socket.id] || 'Anonimo';
        const playerColor = roomState.players[socket.id] || 'white';
        
        const sanitizedText = text.trim().substring(0, 100);
        
        io.to(roomId).emit('new_message', {
            nickname: nickname,
            text: sanitizedText,
            color: playerColor,
            timestamp: Date.now()
        });
    });

    socket.on('get_ranking', () => {
        const ranking = getTopRanking(10);
        socket.emit('ranking_data', { ranking: ranking });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('GridLords server running on port ' + PORT);
});
