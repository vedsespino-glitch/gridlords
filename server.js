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
    GENERAL: 2
};

let gameState = {
    grid: [],
    players: {},
    playerClasses: {},
    playerCount: 0,
    gameStarted: false,
    winner: null
};

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

    gameState.grid[2][2] = {
        terrain: TERRAIN.GENERAL,
        owner: 'red',
        troops: 10
    };

    gameState.grid[GRID_SIZE - 3][GRID_SIZE - 3] = {
        terrain: TERRAIN.GENERAL,
        owner: 'blue',
        troops: 10
    };

    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (gameState.grid[2 + dy] && gameState.grid[2 + dy][2 + dx]) {
                if (gameState.grid[2 + dy][2 + dx].terrain === TERRAIN.MOUNTAIN) {
                    gameState.grid[2 + dy][2 + dx].terrain = TERRAIN.EMPTY;
                }
            }
            const by = GRID_SIZE - 3 + dy;
            const bx = GRID_SIZE - 3 + dx;
            if (gameState.grid[by] && gameState.grid[by][bx]) {
                if (gameState.grid[by][bx].terrain === TERRAIN.MOUNTAIN) {
                    gameState.grid[by][bx].terrain = TERRAIN.EMPTY;
                }
            }
        }
    }
}

function gameTick() {
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
        }
    }

    io.emit('gameState', getPublicGameState());
}

function startGameLoop() {
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
        io.emit('gameState', getPublicGameState());
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
    io.emit('gameState', getPublicGameState());
    broadcastPlayerCount();
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

function executeMove(playerId, from, to) {
    const playerColor = gameState.players[playerId];
    const fromCell = gameState.grid[from.y][from.x];
    const toCell = gameState.grid[to.y][to.x];

    const attackingTroops = fromCell.troops - 1;
    fromCell.troops = 1;

    if (toCell.owner === playerColor) {
        toCell.troops += attackingTroops;
    } else {
        const result = attackingTroops - toCell.troops;
        if (result > 0) {
            if (toCell.terrain === TERRAIN.GENERAL && toCell.owner) {
                gameState.winner = playerColor;
                io.emit('gameOver', { winner: playerColor });
            }

            toCell.owner = playerColor;
            toCell.troops = result;
            if (toCell.terrain !== TERRAIN.GENERAL) {
                toCell.terrain = TERRAIN.EMPTY;
            }
        } else if (result < 0) {
            toCell.troops = Math.abs(result);
        } else {
            toCell.troops = 0;
            toCell.owner = null;
        }
    }

    io.emit('gameState', getPublicGameState());
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

    socket.emit('gameState', getPublicGameState());
    checkAndStartGame();

    socket.on('move', (data) => {
        if (!gameState.gameStarted || gameState.winner) return;

        const { from, to } = data;
        if (isValidMove(socket.id, from, to)) {
            executeMove(socket.id, from, to);
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
