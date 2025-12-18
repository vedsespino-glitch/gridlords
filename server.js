const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
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
    res.json({ status: 'ok', players: gameState.playerCount });
});

const GRID_SIZE = 20;
const TICK_INTERVAL = 1000;
const MOUNTAIN_DENSITY = 0.15;

let gameLoopInterval = null;
let artilleryLoopInterval = null;

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
    MIN_COUNT: 4,
    MAX_COUNT: 6,
    INITIAL_TROOPS: 10,
    MIN_DISTANCE_FROM_SPAWN: 5,
    TROOP_PRODUCTION: 1
};

const ARTILLERY_CONFIG = {
    MIN_COUNT: 2,
    MAX_COUNT: 3,
    INITIAL_TROOPS: 50,
    MIN_DISTANCE_FROM_SPAWN: 6,
    FIRE_INTERVAL: 1000,
    DAMAGE: 5
};

const PLAYER_COLORS = ['red', 'blue', 'green', 'yellow', 'purple'];
const MAX_PLAYERS = 4;
const MIN_PLAYERS_TO_START = 2;

let gameState = {
    grid: [],
    players: {},
    playerClasses: {},
    playerNames: {},
    playerColors: {},
    deadPlayers: {},
    playerCount: 0,
    gameStarted: false,
    winner: null,
    alivePlayers: 0
};

const MIN_SPAWN_DISTANCE = 10;

function getCornerSpawnPositions() {
    const margin = 2;
    return [
        { x: margin, y: margin },
        { x: GRID_SIZE - margin - 1, y: margin },
        { x: margin, y: GRID_SIZE - margin - 1 },
        { x: GRID_SIZE - margin - 1, y: GRID_SIZE - margin - 1 }
    ];
}

function getRandomSpawnPositions() {
    const margin = 2;
    const maxAttempts = 100;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const x1 = margin + Math.floor(Math.random() * (GRID_SIZE - 2 * margin));
        const y1 = margin + Math.floor(Math.random() * (GRID_SIZE - 2 * margin));
        const x2 = margin + Math.floor(Math.random() * (GRID_SIZE - 2 * margin));
        const y2 = margin + Math.floor(Math.random() * (GRID_SIZE - 2 * margin));
        
        const manhattanDistance = Math.abs(x2 - x1) + Math.abs(y2 - y1);
        
        if (manhattanDistance > MIN_SPAWN_DISTANCE) {
            return { pos1: { x: x1, y: y1 }, pos2: { x: x2, y: y2 } };
        }
    }
    
    return { pos1: { x: 2, y: 2 }, pos2: { x: GRID_SIZE - 3, y: GRID_SIZE - 3 } };
}

function clearMountainsAround(x, y) {
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (gameState.grid[ny] && gameState.grid[ny][nx]) {
                if (gameState.grid[ny][nx].terrain === TERRAIN.MOUNTAIN) {
                    gameState.grid[ny][nx].terrain = TERRAIN.EMPTY;
                }
            }
        }
    }
}

function getManhattanDistance(x1, y1, x2, y2) {
    return Math.abs(x2 - x1) + Math.abs(y2 - y1);
}

function generateOutposts(redSpawn, blueSpawn) {
    const outpostCount = OUTPOST_CONFIG.MIN_COUNT + Math.floor(Math.random() * (OUTPOST_CONFIG.MAX_COUNT - OUTPOST_CONFIG.MIN_COUNT + 1));
    const outposts = [];
    const maxAttempts = 100;
    
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
            
            const cell = gameState.grid[y][x];
            if (cell.terrain !== TERRAIN.EMPTY || cell.owner !== null) {
                continue;
            }
            
            const tooCloseToOther = outposts.some(op => 
                getManhattanDistance(x, y, op.x, op.y) < 3
            );
            if (tooCloseToOther) {
                continue;
            }
            
            gameState.grid[y][x] = {
                terrain: TERRAIN.OUTPOST,
                owner: null,
                troops: OUTPOST_CONFIG.INITIAL_TROOPS,
                unit: null
            };
            outposts.push({ x, y });
            placed = true;
        }
    }
    
    console.log(`Generated ${outposts.length} Outposts at positions:`, outposts.map(o => `(${o.x},${o.y})`).join(', '));
    return outposts;
}

function generateArtillery(redSpawn, blueSpawn, existingStructures) {
    const artilleryCount = ARTILLERY_CONFIG.MIN_COUNT + Math.floor(Math.random() * (ARTILLERY_CONFIG.MAX_COUNT - ARTILLERY_CONFIG.MIN_COUNT + 1));
    const artillery = [];
    const maxAttempts = 100;
    
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
            
            const cell = gameState.grid[y][x];
            if (cell.terrain !== TERRAIN.EMPTY || cell.owner !== null) {
                continue;
            }
            
            const tooCloseToOther = [...existingStructures, ...artillery].some(s => 
                getManhattanDistance(x, y, s.x, s.y) < 4
            );
            if (tooCloseToOther) {
                continue;
            }
            
            gameState.grid[y][x] = {
                terrain: TERRAIN.ARTILLERY,
                owner: null,
                troops: ARTILLERY_CONFIG.INITIAL_TROOPS,
                unit: null
            };
            artillery.push({ x, y });
            placed = true;
        }
    }
    
    console.log(`Generated ${artillery.length} Artillery at positions:`, artillery.map(a => `(${a.x},${a.y})`).join(', '));
    return artillery;
}

function initializeGame(){
    gameState = {
        grid: [],
        players: {},
        playerClasses: {},
        playerNames: {},
        playerColors: {},
        deadPlayers: {},
        playerCount: 0,
        gameStarted: false,
        winner: null,
        alivePlayers: 0,
        spawnPositions: getCornerSpawnPositions()
    };

    for (let y = 0; y < GRID_SIZE; y++) {
        gameState.grid[y] = [];
        for (let x = 0; x < GRID_SIZE; x++) {
            const isMountain = Math.random() < MOUNTAIN_DENSITY;
            gameState.grid[y][x] = {
                terrain: isMountain ? TERRAIN.MOUNTAIN : TERRAIN.EMPTY,
                owner: null,
                troops: 0,
                unit: null
            };
        }
    }

    for (let i = 0; i < MAX_PLAYERS; i++) {
        const spawn = gameState.spawnPositions[i];
        const color = PLAYER_COLORS[i];
        
        gameState.grid[spawn.y][spawn.x] = {
            terrain: TERRAIN.EMPTY,
            owner: color,
            troops: 10,
            unit: UNIT.GENERAL
        };
        
        clearMountainsAround(spawn.x, spawn.y);
        console.log(`Spawn position for ${color}: (${spawn.x},${spawn.y})`);
    }

    const outposts = generateOutposts(gameState.spawnPositions[0], gameState.spawnPositions[1]);
    generateArtillery(gameState.spawnPositions[0], gameState.spawnPositions[1], outposts);
}

function gameTick(){
    if (!gameState.gameStarted || gameState.winner) return;

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = gameState.grid[y][x];
            
            if (cell.unit === UNIT.GENERAL && cell.owner) {
                const playerId = Object.keys(gameState.players).find(
                    id => gameState.players[id] === cell.owner
                );
                const playerClass = playerId ? gameState.playerClasses[playerId] : null;
                const troopProduction = playerClass === 'tank' ? 2 : 1;
                cell.troops += troopProduction;
            }
            
            if (cell.terrain === TERRAIN.OUTPOST && cell.owner) {
                cell.troops += OUTPOST_CONFIG.TROOP_PRODUCTION;
            }
        }
    }

    emitGameStateToAll();
}

function artilleryTick() {
    if (!gameState.gameStarted || gameState.winner) return;

    const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    let stateChanged = false;

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = gameState.grid[y][x];
            
            if (cell.terrain !== TERRAIN.ARTILLERY) continue;
            
            const artilleryOwner = cell.owner;
            
            for (const [dx, dy] of directions) {
                const nx = x + dx;
                const ny = y + dy;
                
                if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
                
                const targetCell = gameState.grid[ny][nx];
                
                if (!targetCell.owner) continue;
                
                const isEnemy = artilleryOwner === null || targetCell.owner !== artilleryOwner;
                
                if (isEnemy && targetCell.troops > 0) {
                    const targetOwner = targetCell.owner;
                    targetCell.troops -= ARTILLERY_CONFIG.DAMAGE;
                    
                    io.emit('artilleryFire', {
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
                            const winningColor = targetOwner === 'red' ? 'blue' : 'red';
                            gameState.winner = winningColor;
                            io.emit('gameOver', { winner: winningColor });
                            targetCell.unit = null;
                        }
                    }
                    
                    stateChanged = true;
                    console.log(`Artillery at (${x},${y}) fired at (${nx},${ny}), damage: ${ARTILLERY_CONFIG.DAMAGE}`);
                }
            }
        }
    }

    if (stateChanged) {
        emitGameStateToAll();
    }
}

function startGameLoop(){
    if (gameLoopInterval) {
        console.log('Game loop already running, skipping start');
        return;
    }
    console.log('--- GAME LOOP STARTED ---');
    gameLoopInterval = setInterval(gameTick, TICK_INTERVAL);
    artilleryLoopInterval = setInterval(artilleryTick, ARTILLERY_CONFIG.FIRE_INTERVAL);
}

function stopGameLoop() {
    if (gameLoopInterval) {
        clearInterval(gameLoopInterval);
        gameLoopInterval = null;
        console.log('--- GAME LOOP STOPPED ---');
    }
    if (artilleryLoopInterval) {
        clearInterval(artilleryLoopInterval);
        artilleryLoopInterval = null;
        console.log('--- ARTILLERY LOOP STOPPED ---');
    }
}

function checkAndStartGame() {
    const actualPlayerCount = Object.keys(gameState.players).length;
    const allPlayersHaveClass = Object.keys(gameState.players).every(
        id => gameState.playerClasses[id]
    );
    
    console.log(`Checking game start: players=${actualPlayerCount}, allHaveClass=${allPlayersHaveClass}, gameStarted=${gameState.gameStarted}`);
    
    if (actualPlayerCount === MAX_PLAYERS && allPlayersHaveClass && !gameState.gameStarted) {
        startBattleRoyale();
    }
    
    broadcastPlayerCount();
}

function forceStartGame() {
    const actualPlayerCount = Object.keys(gameState.players).length;
    if (actualPlayerCount >= MIN_PLAYERS_TO_START && !gameState.gameStarted) {
        startBattleRoyale();
        return true;
    }
    return false;
}

function startBattleRoyale() {
    gameState.gameStarted = true;
    gameState.alivePlayers = Object.keys(gameState.players).length;
    gameState.playerCount = gameState.alivePlayers;
    
    for (const socketId of Object.keys(gameState.players)) {
        gameState.deadPlayers[socketId] = false;
    }
    
    io.emit('gameStart', { 
        totalPlayers: gameState.alivePlayers,
        mode: 'battle_royale'
    });
    emitGameStateToAll();
    startGameLoop();
    console.log(`Battle Royale started with ${gameState.alivePlayers} players!`);
}

function broadcastPlayerCount() {
    const count = Object.keys(gameState.players).length;
    const alive = gameState.gameStarted ? gameState.alivePlayers : count;
    io.emit('playerCount', { 
        current: count, 
        required: MAX_PLAYERS,
        minRequired: MIN_PLAYERS_TO_START,
        alive: alive,
        canForceStart: count >= MIN_PLAYERS_TO_START && !gameState.gameStarted
    });
}

function resetGameForNewMatch() {
    console.log('Resetting game for new match...');
    stopGameLoop();
    initializeGame();
    io.emit('gameReset');
    emitGameStateToAll();
    broadcastPlayerCount();
}

function getVisibleCells(playerColor) {
    const visible = new Set();
    
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = gameState.grid[y][x];
            if (cell.owner === playerColor) {
                visible.add(`${x},${y}`);
                const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
                for (const [dx, dy] of directions) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
                        visible.add(`${nx},${ny}`);
                    }
                }
            }
        }
    }
    
    return visible;
}

function getFilteredGameState(playerColor) {
    const visible = getVisibleCells(playerColor);
    const filteredGrid = [];
    
    for (let y = 0; y < GRID_SIZE; y++) {
        filteredGrid[y] = [];
        for (let x = 0; x < GRID_SIZE; x++) {
            const key = `${x},${y}`;
            if (visible.has(key)) {
                filteredGrid[y][x] = { ...gameState.grid[y][x] };
            } else {
                filteredGrid[y][x] = { isFog: true };
            }
        }
    }
    
    return {
        grid: filteredGrid,
        gameStarted: gameState.gameStarted,
        winner: gameState.winner,
        playerCount: gameState.playerCount
    };
}

function emitGameStateToAll() {
    for (const [socketId, playerColor] of Object.entries(gameState.players)) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
            socket.emit('gameState', getFilteredGameState(playerColor));
        }
    }
}

function getPublicGameState() {
    return {
        grid: gameState.grid,
        gameStarted: gameState.gameStarted,
        winner: gameState.winner,
        playerCount: gameState.playerCount
    };
}

function isValidMove(playerId, from, to) {
    const playerColor = gameState.players[playerId];
    if (!playerColor) return false;

    const fromCell = gameState.grid[from.y]?.[from.x];
    if (!fromCell || fromCell.owner !== playerColor) return false;

    if (fromCell.troops <= 1) return false;

    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    if (dx + dy !== 1) return false;

    const toCell = gameState.grid[to.y]?.[to.x];
    if (!toCell || toCell.terrain === TERRAIN.MOUNTAIN) return false;

    return true;
}

function executeMove(playerId, from, to, splitMove = false) {
    const playerColor = gameState.players[playerId];
    const fromCell = gameState.grid[from.y][from.x];
    const toCell = gameState.grid[to.y][to.x];
    
    const isMovingGeneral = fromCell.unit === UNIT.GENERAL;
    
    let troopsToMove;
    if (splitMove) {
        troopsToMove = Math.floor(fromCell.troops / 2);
        if (troopsToMove < 1) {
            console.log(`Split move rejected: not enough troops (${fromCell.troops})`);
            return;
        }
        fromCell.troops = fromCell.troops - troopsToMove;
        console.log(`Split move: ${troopsToMove} troops moving, ${fromCell.troops} staying`);
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
        console.log(`General moved from (${from.x},${from.y}) to (${to.x},${to.y}) for ${playerColor}`);
    }

    if (capturedEnemyGeneral && capturedOwner) {
        const loserSocketId = Object.keys(gameState.players).find(
            id => gameState.players[id] === capturedOwner
        );
        if (loserSocketId) {
            eliminatePlayer(loserSocketId, playerId, 'captured');
        }
    }

    emitGameStateToAll();
}

function getPlayerNamesForBroadcast() {
    const names = {};
    for (const [socketId, color] of Object.entries(gameState.players)) {
        names[color] = gameState.playerNames[socketId] || color.toUpperCase();
    }
    return names;
}

function broadcastPlayerNames() {
    const names = getPlayerNamesForBroadcast();
    io.emit('playerNames', names);
}

function eliminatePlayer(loserSocketId, attackerSocketId, reason = 'captured') {
    const loserColor = gameState.players[loserSocketId];
    const attackerColor = attackerSocketId ? gameState.players[attackerSocketId] : null;
    
    console.log(`Eliminating player ${loserColor} (reason: ${reason})`);
    
    gameState.deadPlayers[loserSocketId] = true;
    gameState.alivePlayers--;
    
    if (attackerColor && reason === 'captured') {
        let cellsTransferred = 0;
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const cell = gameState.grid[y][x];
                if (cell.owner === loserColor) {
                    cell.owner = attackerColor;
                    cellsTransferred++;
                }
            }
        }
        console.log(`Transferred ${cellsTransferred} cells from ${loserColor} to ${attackerColor}`);
    }
    
    const loserSocket = io.sockets.sockets.get(loserSocketId);
    if (loserSocket) {
        loserSocket.emit('eliminated', { 
            reason: reason,
            killedBy: attackerColor,
            placement: gameState.alivePlayers + 1
        });
    }
    
    io.emit('playerEliminated', {
        eliminatedColor: loserColor,
        eliminatedBy: attackerColor,
        alivePlayers: gameState.alivePlayers
    });
    
    checkForWinner();
}

function checkForWinner() {
    if (gameState.alivePlayers === 1) {
        const winnerSocketId = Object.keys(gameState.players).find(
            id => !gameState.deadPlayers[id]
        );
        
        if (winnerSocketId) {
            const winnerColor = gameState.players[winnerSocketId];
            gameState.winner = winnerColor;
            
            io.emit('gameOver', { 
                winner: winnerColor,
                reason: 'last_man_standing'
            });
            
            console.log(`Game Over! Winner: ${winnerColor} (Last Man Standing)`);
        }
    } else if (gameState.alivePlayers === 0) {
        gameState.winner = 'draw';
        io.emit('gameOver', { winner: null, reason: 'draw' });
        console.log('Game Over! Draw - no survivors');
    }
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    const playerClass = socket.handshake.query.playerClass || 'rusher';
    const nickname = socket.handshake.query.nickname || null;
    console.log(`Player ${socket.id} selected class: ${playerClass}, nickname: ${nickname || 'none'}`);

    const actualPlayerCount = Object.keys(gameState.players).length;
    if (actualPlayerCount >= MAX_PLAYERS || gameState.gameStarted) {
        console.log(`Game full or in progress. Rejecting player ${socket.id}`);
        socket.emit('gameFull');
        socket.disconnect();
        return;
    }

    const usedColors = Object.values(gameState.players);
    const playerColor = PLAYER_COLORS.find(color => !usedColors.includes(color));
    
    if (!playerColor) {
        console.log(`No available colors. Rejecting player ${socket.id}`);
        socket.emit('gameFull');
        socket.disconnect();
        return;
    }

    const playerNumber = Object.keys(gameState.players).length + 1;
    const defaultName = `General ${playerNumber}`;
    
    gameState.players[socket.id] = playerColor;
    gameState.playerClasses[socket.id] = playerClass;
    gameState.playerNames[socket.id] = nickname || defaultName;
    gameState.playerColors[socket.id] = playerColor;
    gameState.playerCount = Object.keys(gameState.players).length;

    if (playerClass === 'rusher') {
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const cell = gameState.grid[y][x];
                if (cell.unit === UNIT.GENERAL && cell.owner === playerColor) {
                    cell.troops = 30;
                    console.log(`Rusher bonus applied: ${playerColor} general now has 30 troops`);
                }
            }
        }
    }

    socket.emit('playerAssigned', { color: playerColor, playerClass: playerClass });
    console.log(`Player ${socket.id} assigned color: ${playerColor}, total players: ${gameState.playerCount}`);

    socket.emit('gameState', getFilteredGameState(playerColor));
    broadcastPlayerNames();
    checkAndStartGame();

    socket.on('move', (data) => {
        if (!gameState.gameStarted || gameState.winner) return;
        if (gameState.deadPlayers[socket.id]) return;

        const { from, to, splitMove } = data;
        if (isValidMove(socket.id, from, to)) {
            executeMove(socket.id, from, to, splitMove || false);
        }
    });

    socket.on('forceStart', () => {
        console.log(`Player ${socket.id} requested force start`);
        if (forceStartGame()) {
            console.log('Force start successful');
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        const disconnectedColor = gameState.players[socket.id];
        
        if (gameState.gameStarted && !gameState.deadPlayers[socket.id]) {
            eliminatePlayer(socket.id, null, 'disconnect');
        }
        
        delete gameState.players[socket.id];
        delete gameState.playerClasses[socket.id];
        delete gameState.playerNames[socket.id];
        delete gameState.playerColors[socket.id];
        delete gameState.deadPlayers[socket.id];
        gameState.playerCount = Object.keys(gameState.players).length;

        console.log(`Player count after disconnect: ${gameState.playerCount}, gameStarted: ${gameState.gameStarted}`);

        if (!gameState.gameStarted) {
            broadcastPlayerCount();
        }
    });

    socket.on('requestReset', () => {
        if (gameState.winner || !gameState.gameStarted) {
            resetGameForNewMatch();
        }
    });
});

initializeGame();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`GridLords server running on port ${PORT}`);
});
