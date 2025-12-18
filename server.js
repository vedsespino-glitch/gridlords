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

const TERRAIN = {
    EMPTY: 0,
    MOUNTAIN: 1,
    GENERAL: 2,
    OUTPOST: 3
};

const OUTPOST_CONFIG = {
    MIN_COUNT: 4,
    MAX_COUNT: 6,
    INITIAL_TROOPS: 10,
    MIN_DISTANCE_FROM_SPAWN: 5,
    TROOP_PRODUCTION: 1
};

let gameState = {
    grid: [],
    players: {},
    playerClasses: {},
    playerCount: 0,
    gameStarted: false,
    winner: null
};

const MIN_SPAWN_DISTANCE = 10;

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
                troops: OUTPOST_CONFIG.INITIAL_TROOPS
            };
            outposts.push({ x, y });
            placed = true;
        }
    }
    
    console.log(`Generated ${outposts.length} Outposts at positions:`, outposts.map(o => `(${o.x},${o.y})`).join(', '));
    return outposts;
}

function initializeGame() {
    gameState = {
        grid: [],
        players: {},
        playerClasses: {},
        playerCount: 0,
        gameStarted: false,
        winner: null
    };

    for (let y = 0; y < GRID_SIZE; y++) {
        gameState.grid[y] = [];
        for (let x = 0; x < GRID_SIZE; x++) {
            const isMountain = Math.random() < MOUNTAIN_DENSITY;
            gameState.grid[y][x] = {
                terrain: isMountain ? TERRAIN.MOUNTAIN : TERRAIN.EMPTY,
                owner: null,
                troops: 0
            };
        }
    }

    const spawnPositions = getRandomSpawnPositions();
    const redSpawn = spawnPositions.pos1;
    const blueSpawn = spawnPositions.pos2;
    
    console.log(`Random spawn positions: Red(${redSpawn.x},${redSpawn.y}) Blue(${blueSpawn.x},${blueSpawn.y})`);

    gameState.grid[redSpawn.y][redSpawn.x] = {
        terrain: TERRAIN.GENERAL,
        owner: 'red',
        troops: 10
    };

    gameState.grid[blueSpawn.y][blueSpawn.x] = {
        terrain: TERRAIN.GENERAL,
        owner: 'blue',
        troops: 10
    };

    clearMountainsAround(redSpawn.x, redSpawn.y);
    clearMountainsAround(blueSpawn.x, blueSpawn.y);

    generateOutposts(redSpawn, blueSpawn);
}

function gameTick(){
    if (!gameState.gameStarted || gameState.winner) return;

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = gameState.grid[y][x];
            
            if (cell.terrain === TERRAIN.GENERAL && cell.owner) {
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

function startGameLoop(){
    if (gameLoopInterval) {
        console.log('Game loop already running, skipping start');
        return;
    }
    console.log('--- GAME LOOP STARTED ---');
    gameLoopInterval = setInterval(gameTick, TICK_INTERVAL);
}

function stopGameLoop() {
    if (gameLoopInterval) {
        clearInterval(gameLoopInterval);
        gameLoopInterval = null;
        console.log('--- GAME LOOP STOPPED ---');
    }
}

function checkAndStartGame() {
    const actualPlayerCount = Object.keys(gameState.players).length;
    const allPlayersHaveClass = Object.keys(gameState.players).every(
        id => gameState.playerClasses[id]
    );
    
    console.log(`Checking game start: players=${actualPlayerCount}, allHaveClass=${allPlayersHaveClass}, gameStarted=${gameState.gameStarted}`);
    
    if (actualPlayerCount === 2 && allPlayersHaveClass && !gameState.gameStarted) {
        gameState.gameStarted = true;
        gameState.playerCount = 2;
        io.emit('gameStart');
        emitGameStateToAll();
        startGameLoop();
        console.log('Game started with 2 players!');
    }
    
    broadcastPlayerCount();
}

function broadcastPlayerCount() {
    const count = Object.keys(gameState.players).length;
    io.emit('playerCount', { current: count, required: 2 });
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
    
    const isMovingGeneral = fromCell.terrain === TERRAIN.GENERAL;
    
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

    if (toCell.owner === playerColor) {
        toCell.troops += troopsToMove;
        moveSuccessful = true;
    } else {
        const result = troopsToMove - toCell.troops;
        if (result > 0) {
            if (toCell.terrain === TERRAIN.GENERAL && toCell.owner) {
                gameState.winner = playerColor;
                io.emit('gameOver', { winner: playerColor });
            }

            toCell.owner = playerColor;
            toCell.troops = result;
            if (toCell.terrain !== TERRAIN.GENERAL && toCell.terrain !== TERRAIN.OUTPOST) {
                toCell.terrain = TERRAIN.EMPTY;
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
        fromCell.terrain = TERRAIN.EMPTY;
        toCell.terrain = TERRAIN.GENERAL;
        console.log(`General moved from (${from.x},${from.y}) to (${to.x},${to.y}) for ${playerColor}`);
    }

    emitGameStateToAll();
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    const playerClass = socket.handshake.query.playerClass || 'rusher';
    console.log(`Player ${socket.id} selected class: ${playerClass}`);

    const actualPlayerCount = Object.keys(gameState.players).length;
    if (actualPlayerCount >= 2 || gameState.gameStarted) {
        console.log(`Game full or in progress. Rejecting player ${socket.id}`);
        socket.emit('gameFull');
        socket.disconnect();
        return;
    }

    let playerColor;
    if (!Object.values(gameState.players).includes('red')) {
        playerColor = 'red';
    } else {
        playerColor = 'blue';
    }

    gameState.players[socket.id] = playerColor;
    gameState.playerClasses[socket.id] = playerClass;
    gameState.playerCount = Object.keys(gameState.players).length;

    if (playerClass === 'rusher') {
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const cell = gameState.grid[y][x];
                if (cell.terrain === TERRAIN.GENERAL && cell.owner === playerColor) {
                    cell.troops = 30;
                    console.log(`Rusher bonus applied: ${playerColor} general now has 30 troops`);
                }
            }
        }
    }

    socket.emit('playerAssigned', { color: playerColor, playerClass: playerClass });
    console.log(`Player ${socket.id} assigned color: ${playerColor}, total players: ${gameState.playerCount}`);

    socket.emit('gameState', getFilteredGameState(playerColor));
    checkAndStartGame();

    socket.on('move', (data) => {
        if (!gameState.gameStarted || gameState.winner) return;

        const { from, to, splitMove } = data;
        if (isValidMove(socket.id, from, to)) {
            executeMove(socket.id, from, to, splitMove || false);
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        const disconnectedColor = gameState.players[socket.id];
        delete gameState.players[socket.id];
        delete gameState.playerClasses[socket.id];
        gameState.playerCount = Object.keys(gameState.players).length;

        console.log(`Player count after disconnect: ${gameState.playerCount}, gameStarted: ${gameState.gameStarted}`);

        if (gameState.gameStarted && gameState.playerCount < 2) {
            console.log('Player disconnected during game. Resetting for new match...');
            resetGameForNewMatch();
        } else {
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
