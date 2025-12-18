const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const playerInfoEl = document.getElementById('player-info');
const resetBtn = document.getElementById('resetBtn');
const classModal = document.getElementById('class-modal');
const tankBtn = document.getElementById('tank-btn');
const rusherBtn = document.getElementById('rusher-btn');
const playerCounterEl = document.getElementById('player-counter');
const gameOverOverlay = document.getElementById('game-over-overlay');
const gameOverTitle = document.getElementById('game-over-title');
const gameOverMessage = document.getElementById('game-over-message');
const playAgainBtn = document.getElementById('play-again-btn');

const GRID_SIZE = 20;
const CELL_SIZE = 30;
canvas.width = GRID_SIZE * CELL_SIZE;
canvas.height = GRID_SIZE * CELL_SIZE;

const COLORS = {
    empty: '#2d3436',
    mountain: '#636e72',
    red: '#e74c3c',
    blue: '#3498db',
    redLight: '#ff7675',
    blueLight: '#74b9ff',
    grid: '#1a1a2e',
    text: '#ffffff',
    selected: '#f1c40f',
    selectedSplit: '#e67e22',
    general: '#ffd700',
    fog: '#0a0a0a',
    outpost: '#444444',
    outpostRed: '#c0392b',
    outpostBlue: '#2980b9',
    outpostBorder: '#ffd700'
};

const TERRAIN = {
    EMPTY: 0,
    MOUNTAIN: 1,
    GENERAL: 2,
    OUTPOST: 3
};

let socket;
let gameState = null;
let playerColor = null;
let playerClass = null;
let selectedCell = null;
let gameStarted = false;
let isSplitMove = false;

function connectToServer(selectedClass) {
    playerClass = selectedClass;

    socket = io('https://gridlords.onrender.com', {
                transports: ['websocket'], 
                upgrade: false,
                timeout: 2000,
                query: { playerClass: selectedClass }
    });

    socket.on('connect', () => {
        console.log('Socket connected:', socket.id);
        statusEl.textContent = 'Connected! Waiting for opponent...';
        statusEl.style.background = '#27ae60';
    });

    socket.on('connect_error', (err) => {
        console.error('Connection error:', err.message);
        statusEl.textContent = 'Connection error: ' + err.message;
        statusEl.style.background = '#e74c3c';
    });

    socket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
        statusEl.textContent = 'Disconnected: ' + reason;
        statusEl.style.background = '#e74c3c';
    });

    socket.on('playerAssigned', (data) => {
        playerColor = data.color;
        const classLabel = playerClass === 'tank' ? 'Tank' : 'Rusher';
        const classIcon = playerClass === 'tank' ? '🛡️' : '⚡';
        playerInfoEl.textContent = `You are: ${playerColor.toUpperCase()} ${classIcon} ${classLabel}`;
        playerInfoEl.className = playerColor;
    });

    socket.on('gameFull', () => {
        statusEl.textContent = 'Game is full! Try again later.';
        statusEl.style.background = '#e74c3c';
    });

    socket.on('gameStart', () => {
        gameStarted = true;
        statusEl.textContent = 'Game Started! Your turn to conquer!';
        statusEl.style.background = '#9b59b6';
        resetBtn.style.display = 'none';
    });

    socket.on('gameState', (state) => {
        gameState = state;
        render();
    });

    socket.on('gameOver', (data) => {
        gameStarted = false;
        const isWinner = data.winner === playerColor;
        
        gameOverOverlay.classList.remove('hidden', 'victory', 'defeat');
        gameOverOverlay.classList.add(isWinner ? 'victory' : 'defeat');
        
        if (data.reason === 'disconnect') {
            gameOverTitle.textContent = isWinner ? 'VICTORIA!' : 'DERROTA...';
            gameOverMessage.textContent = isWinner ? 'Tu oponente se desconecto.' : 'Te desconectaste.';
        } else {
            gameOverTitle.textContent = isWinner ? 'VICTORIA!' : 'DERROTA...';
            gameOverMessage.textContent = isWinner ? 'Capturaste al General enemigo!' : 'Tu General fue capturado!';
        }
        
        statusEl.textContent = isWinner ? 'VICTORY!' : 'DEFEAT!';
        statusEl.style.background = isWinner ? '#27ae60' : '#e74c3c';
        resetBtn.style.display = 'none';
    });

    socket.on('gameReset', () => {
        selectedCell = null;
        isSplitMove = false;
        gameStarted = false;
        statusEl.textContent = 'Game Reset! Waiting for players...';
        statusEl.style.background = '#f39c12';
        resetBtn.style.display = 'none';
        gameOverOverlay.classList.add('hidden');
    });

    socket.on('playerCount', (data) => {
        const { current, required } = data;
        if (current === required) {
            playerCounterEl.textContent = `Jugadores: ${current}/${required} - Iniciando...`;
            playerCounterEl.style.color = '#27ae60';
        } else {
            playerCounterEl.textContent = `Jugadores: ${current}/${required}`;
            playerCounterEl.style.color = '#f39c12';
        }
    });
}

function render() {
    if (!gameState) return;

    ctx.fillStyle = COLORS.grid;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = gameState.grid[y][x];
            const px = x * CELL_SIZE;
            const py = y * CELL_SIZE;

            if (cell.isFog) {
                ctx.fillStyle = COLORS.fog;
                ctx.fillRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);
                continue;
            }

            let fillColor = COLORS.empty;

            if (cell.terrain === TERRAIN.MOUNTAIN) {
                fillColor = COLORS.mountain;
            } else if (cell.terrain === TERRAIN.OUTPOST && !cell.owner) {
                fillColor = COLORS.outpost;
            } else if (cell.owner === 'red') {
                if (cell.terrain === TERRAIN.GENERAL) {
                    fillColor = '#c0392b';
                } else if (cell.terrain === TERRAIN.OUTPOST) {
                    fillColor = COLORS.outpostRed;
                } else {
                    fillColor = COLORS.red;
                }
            } else if (cell.owner === 'blue') {
                if (cell.terrain === TERRAIN.GENERAL) {
                    fillColor = '#2980b9';
                } else if (cell.terrain === TERRAIN.OUTPOST) {
                    fillColor = COLORS.outpostBlue;
                } else {
                    fillColor = COLORS.blue;
                }
            }

            ctx.fillStyle = fillColor;
            ctx.fillRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);

            if (cell.terrain === TERRAIN.GENERAL && cell.owner) {
                ctx.strokeStyle = COLORS.general;
                ctx.lineWidth = 3;
                ctx.strokeRect(px + 2, py + 2, CELL_SIZE - 4, CELL_SIZE - 4);
                
                ctx.font = '14px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText('👑', px + CELL_SIZE / 2, py + 2);
            }

            if (cell.terrain === TERRAIN.OUTPOST) {
                ctx.strokeStyle = COLORS.outpostBorder;
                ctx.lineWidth = 3;
                ctx.strokeRect(px + 2, py + 2, CELL_SIZE - 4, CELL_SIZE - 4);
                
                ctx.font = '14px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillStyle = COLORS.text;
                ctx.fillText('🏯', px + CELL_SIZE / 2, py + 1);
            }

            if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
                ctx.strokeStyle = isSplitMove ? COLORS.selectedSplit : COLORS.selected;
                ctx.lineWidth = 3;
                if (isSplitMove) {
                    ctx.setLineDash([4, 2]);
                }
                ctx.strokeRect(px + 2, py + 2, CELL_SIZE - 4, CELL_SIZE - 4);
                ctx.setLineDash([]);
            }

            if (cell.troops > 0 && cell.terrain !== TERRAIN.MOUNTAIN) {
                ctx.fillStyle = COLORS.text;
                ctx.font = 'bold 11px Arial';
                ctx.textAlign = 'center';
                const hasTopIcon = cell.terrain === TERRAIN.GENERAL || cell.terrain === TERRAIN.OUTPOST;
                ctx.textBaseline = hasTopIcon ? 'bottom' : 'middle';
                const textY = hasTopIcon ? py + CELL_SIZE - 3 : py + CELL_SIZE / 2;
                ctx.fillText(cell.troops.toString(), px + CELL_SIZE / 2, textY);
            }

            if (cell.terrain === TERRAIN.MOUNTAIN) {
                ctx.fillStyle = '#4a5568';
                ctx.beginPath();
                ctx.moveTo(px + CELL_SIZE / 2, py + 5);
                ctx.lineTo(px + CELL_SIZE - 5, py + CELL_SIZE - 5);
                ctx.lineTo(px + 5, py + CELL_SIZE - 5);
                ctx.closePath();
                ctx.fill();
            }
        }
    }

    ctx.strokeStyle = '#0f3460';
    ctx.lineWidth = 1;
    for (let i = 0; i <= GRID_SIZE; i++) {
        ctx.beginPath();
        ctx.moveTo(i * CELL_SIZE, 0);
        ctx.lineTo(i * CELL_SIZE, canvas.height);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, i * CELL_SIZE);
        ctx.lineTo(canvas.width, i * CELL_SIZE);
        ctx.stroke();
    }
}

function getCellFromMouse(event) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / CELL_SIZE);
    const y = Math.floor((event.clientY - rect.top) / CELL_SIZE);

    if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
        return { x, y };
    }
    return null;
}

function isAdjacent(cell1, cell2) {
    const dx = Math.abs(cell1.x - cell2.x);
    const dy = Math.abs(cell1.y - cell2.y);
    return dx + dy === 1;
}

canvas.addEventListener('click', (event) => {
    if (!gameState || !gameStarted || gameState.winner) return;

    const clickedCell = getCellFromMouse(event);
    if (!clickedCell) return;

    const cell = gameState.grid[clickedCell.y][clickedCell.x];

    if (selectedCell) {
        if (clickedCell.x === selectedCell.x && clickedCell.y === selectedCell.y) {
            selectedCell = null;
            isSplitMove = false;
        } else if (isAdjacent(selectedCell, clickedCell)) {
            socket.emit('move', {
                from: selectedCell,
                to: clickedCell,
                splitMove: isSplitMove
            });
            selectedCell = null;
            isSplitMove = false;
        } else if (cell.owner === playerColor && cell.troops > 1) {
            selectedCell = clickedCell;
            isSplitMove = false;
        } else {
            selectedCell = null;
            isSplitMove = false;
        }
    } else {
        if (cell.owner === playerColor && cell.troops > 1) {
            selectedCell = clickedCell;
            isSplitMove = false;
        }
    }

    render();
});

canvas.addEventListener('dblclick', (event) => {
    if (!gameState || !gameStarted || gameState.winner) return;

    const clickedCell = getCellFromMouse(event);
    if (!clickedCell) return;

    const cell = gameState.grid[clickedCell.y][clickedCell.x];

    if (cell.owner === playerColor && cell.troops >= 2) {
        selectedCell = clickedCell;
        isSplitMove = true;
        const splitTroops = Math.floor(cell.troops / 2);
        statusEl.textContent = `Split Move: ${splitTroops} tropas listas para mover`;
        statusEl.style.background = '#e67e22';
        render();
    }
});

canvas.addEventListener('mousemove', (event) => {
    if (!gameState || !gameStarted) return;

    const hoveredCell = getCellFromMouse(event);
    if (hoveredCell) {
        const cell = gameState.grid[hoveredCell.y][hoveredCell.x];
        if (cell.owner === playerColor && cell.troops > 1) {
            canvas.style.cursor = 'pointer';
        } else if (selectedCell && isAdjacent(selectedCell, hoveredCell) && cell.terrain !== TERRAIN.MOUNTAIN) {
            canvas.style.cursor = 'crosshair';
        } else {
            canvas.style.cursor = 'default';
        }
    }
});

resetBtn.addEventListener('click', () => {
    socket.emit('requestReset');
});

// Class selection event handlers
tankBtn.addEventListener('click', () => {
    classModal.classList.add('hidden');
    statusEl.textContent = 'Connecting...';
    connectToServer('tank');
});

rusherBtn.addEventListener('click', () => {
    classModal.classList.add('hidden');
    statusEl.textContent = 'Connecting...';
    connectToServer('rusher');
});

playAgainBtn.addEventListener('click', () => {
    if (socket) {
        socket.emit('requestReset');
    }
});

// Initial render (without connection - wait for class selection)
render();
