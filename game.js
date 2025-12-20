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
const loginOverlay = document.getElementById('login-overlay');
const nicknameInput = document.getElementById('nicknameInput');
const matchInfoEl = document.getElementById('match-info');

// Room UI elements
const createRoomBtn = document.getElementById('createRoomBtn');
const roomCodeInput = document.getElementById('roomCodeInput');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const lobbyOverlay = document.getElementById('lobby-overlay');
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const lobbyPlayerCount = document.getElementById('lobbyPlayerCount');
const lobbyPlayerList = document.getElementById('lobbyPlayerList');
const startGameBtn = document.getElementById('startGameBtn');
const waitingMessage = document.getElementById('waitingMessage');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');
const roomInfoEl = document.getElementById('room-info');
const currentRoomCodeEl = document.getElementById('currentRoomCode');

const GRID_SIZE = 30;
const CELL_SIZE = 20;
canvas.width = GRID_SIZE * CELL_SIZE;
canvas.height = GRID_SIZE * CELL_SIZE;

const COLORS = {
    empty: '#2d3436',
    mountain: '#636e72',
    red: '#e74c3c',
    blue: '#3498db',
    green: '#27ae60',
    yellow: '#f1c40f',
    purple: '#9b59b6',
    redLight: '#ff7675',
    blueLight: '#74b9ff',
    greenLight: '#2ecc71',
    yellowLight: '#f39c12',
    purpleLight: '#a569bd',
    grid: '#1a1a2e',
    text: '#ffffff',
    selected: '#f1c40f',
    selectedSplit: '#e67e22',
    general: '#ffd700',
    fog: '#0a0a0a',
    outpost: '#444444',
    outpostRed: '#c0392b',
    outpostBlue: '#2980b9',
    outpostGreen: '#1e8449',
    outpostYellow: '#d4ac0d',
    outpostPurple: '#7d3c98',
    outpostBorder: '#ffd700',
    artillery: '#ff8c00',
    artilleryRed: '#d35400',
    artilleryBlue: '#2471a3',
    artilleryGreen: '#196f3d',
    artilleryYellow: '#b7950b',
    artilleryPurple: '#6c3483',
    artilleryBorder: '#ffa500'
};

function getPlayerColor(owner) {
    if (!owner) return COLORS.empty;
    return COLORS[owner] || COLORS.empty;
}

function getPlayerLightColor(owner) {
    if (!owner) return COLORS.empty;
    const lightKey = owner + 'Light';
    return COLORS[lightKey] || COLORS[owner] || COLORS.empty;
}

function getOutpostColor(owner) {
    if (!owner) return COLORS.outpost;
    const key = 'outpost' + owner.charAt(0).toUpperCase() + owner.slice(1);
    return COLORS[key] || COLORS.outpost;
}

function getArtilleryColor(owner) {
    if (!owner) return COLORS.artillery;
    const key = 'artillery' + owner.charAt(0).toUpperCase() + owner.slice(1);
    return COLORS[key] || COLORS.artillery;
}

const TERRAIN = {
    EMPTY: 0,
    MOUNTAIN: 1,
    OUTPOST: 2,
    ARTILLERY: 3
};

let socket;
let gameState = null;
let playerColor = null;
let playerClass = null;
let selectedCell = null;
let gameStarted = false;
let isSplitMove = false;
let playerNickname = null;
let playerNames = {};

// Room state
let currentRoomId = null;
let isHost = false;
let pendingAction = null; // 'create' or 'join'

// Audio Manager for game sound effects
const AudioManager = {
    sounds: {},
    muted: false,
    volume: 0.5,
    
    // Sound URLs from free sources (Pixabay CDN)
    soundUrls: {
        move: 'https://cdn.pixabay.com/audio/2022/03/15/audio_115b9b87e4.mp3',      // Soft step/move sound
        attack: 'https://cdn.pixabay.com/audio/2022/03/10/audio_c8c8a73467.mp3',    // Hit/sword sound
        cannon: 'https://cdn.pixabay.com/audio/2022/03/15/audio_8cb749bf56.mp3',    // Explosion sound
        split: 'https://cdn.pixabay.com/audio/2021/08/04/audio_0625c1539c.mp3',     // Whoosh/cut sound
        win: 'https://cdn.pixabay.com/audio/2021/08/04/audio_12b0c7443c.mp3',       // Victory fanfare
        lose: 'https://cdn.pixabay.com/audio/2022/03/15/audio_942694a069.mp3'       // Game over sound
    },
    
    init: function() {
        // Preload all sounds
        for (const [name, url] of Object.entries(this.soundUrls)) {
            this.sounds[name] = new Audio(url);
            this.sounds[name].volume = this.volume;
            this.sounds[name].preload = 'auto';
        }
        console.log('AudioManager initialized with', Object.keys(this.sounds).length, 'sounds');
    },
    
    play: function(soundName) {
        if (this.muted) return;
        
        const sound = this.sounds[soundName];
        if (sound) {
            // Clone the audio to allow overlapping sounds
            const clone = sound.cloneNode();
            clone.volume = this.volume;
            clone.play().catch(err => {
                // Ignore autoplay errors (user hasn't interacted yet)
                console.log('Audio play blocked:', err.message);
            });
        }
    },
    
    toggleMute: function() {
        this.muted = !this.muted;
        return this.muted;
    },
    
    setVolume: function(vol) {
        this.volume = Math.max(0, Math.min(1, vol));
        for (const sound of Object.values(this.sounds)) {
            sound.volume = this.volume;
        }
    }
};

// Track previous game state for detecting changes
let previousGameState = null;

function connectToServer(selectedClass) {
    playerClass = selectedClass;

    socket = io(window.location.origin, {
        transports: ['websocket'], 
        upgrade: false,
        timeout: 5000
    });

    socket.on('connect', () => {
        console.log('Socket connected:', socket.id);
        
        // Execute pending action after connection
        if (pendingAction === 'create') {
            socket.emit('createRoom', { nickname: playerNickname, playerClass: playerClass });
        } else if (pendingAction === 'join') {
            const roomCode = roomCodeInput.value.trim().toUpperCase();
            socket.emit('joinRoom', { roomId: roomCode, nickname: playerNickname, playerClass: playerClass });
        }
        pendingAction = null;
    });

    socket.on('connect_error', (err) => {
        console.error('Connection error:', err.message);
        statusEl.textContent = 'Connection error: ' + err.message;
        statusEl.style.background = '#e74c3c';
        // Show login overlay again on error
        loginOverlay.classList.remove('hidden');
        lobbyOverlay.classList.add('hidden');
        classModal.classList.add('hidden');
    });

    socket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
        statusEl.textContent = 'Disconnected: ' + reason;
        statusEl.style.background = '#e74c3c';
    });

    socket.on('error', (data) => {
        console.error('Server error:', data.message);
        alert(data.message);
        // Return to login if not in a room
        if (!currentRoomId) {
            loginOverlay.classList.remove('hidden');
            lobbyOverlay.classList.add('hidden');
            classModal.classList.add('hidden');
        }
    });

    // Room events
    socket.on('roomCreated', (data) => {
        currentRoomId = data.roomId;
        isHost = true;
        roomCodeDisplay.textContent = data.roomId;
        currentRoomCodeEl.textContent = data.roomId;
        
        classModal.classList.add('hidden');
        lobbyOverlay.classList.remove('hidden');
        
        // Show start button for host
        startGameBtn.classList.remove('hidden');
        startGameBtn.disabled = true; // Disabled until min players
        waitingMessage.textContent = 'Esperando mas jugadores...';
        
        console.log('Room created:', data.roomId);
    });

    socket.on('roomJoined', (data) => {
        currentRoomId = data.roomId;
        roomCodeDisplay.textContent = data.roomId;
        currentRoomCodeEl.textContent = data.roomId;
        
        classModal.classList.add('hidden');
        lobbyOverlay.classList.remove('hidden');
        
        console.log('Joined room:', data.roomId);
    });

    socket.on('roomInfo', (data) => {
        currentRoomId = data.roomId;
        isHost = socket.id === data.hostSocketId;
        
        // Update player count
        lobbyPlayerCount.textContent = data.playerCount + '/' + data.maxPlayers;
        
        // Update player list
        lobbyPlayerList.innerHTML = '';
        data.players.forEach(player => {
            const li = document.createElement('li');
            li.className = player.isHost ? 'host' : '';
            
            const colorDot = document.createElement('span');
            colorDot.className = 'player-color';
            colorDot.style.backgroundColor = COLORS[player.color] || '#888';
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = player.name;
            nameSpan.style.color = COLORS[player.color] || '#fff';
            
            const leftDiv = document.createElement('div');
            leftDiv.appendChild(colorDot);
            leftDiv.appendChild(nameSpan);
            
            li.appendChild(leftDiv);
            
            if (player.isHost) {
                const hostBadge = document.createElement('span');
                hostBadge.className = 'host-badge';
                hostBadge.textContent = 'HOST';
                li.appendChild(hostBadge);
            }
            
            lobbyPlayerList.appendChild(li);
        });
        
        // Update host controls
        if (isHost) {
            startGameBtn.classList.remove('hidden');
            startGameBtn.disabled = data.playerCount < data.minPlayers;
            waitingMessage.textContent = data.playerCount < data.minPlayers 
                ? 'Necesitas al menos ' + data.minPlayers + ' jugadores para iniciar'
                : 'Listo para iniciar!';
            waitingMessage.classList.remove('hidden');
        } else {
            startGameBtn.classList.add('hidden');
            waitingMessage.textContent = 'Esperando al host para iniciar...';
            waitingMessage.classList.remove('hidden');
        }
    });

    socket.on('leftRoom', () => {
        currentRoomId = null;
        isHost = false;
        gameState = null;
        playerColor = null;
        gameStarted = false;
        
        lobbyOverlay.classList.add('hidden');
        loginOverlay.classList.remove('hidden');
        roomInfoEl.classList.add('hidden');
    });

    socket.on('playerAssigned', (data) => {
        playerColor = data.color;
        isHost = data.isHost;
        const classLabel = playerClass === 'tank' ? 'Tank' : 'Rusher';
        const classIcon = playerClass === 'tank' ? '🛡️' : '⚡';
        playerInfoEl.textContent = 'You are: ' + playerColor.toUpperCase() + ' ' + classIcon + ' ' + classLabel;
        playerInfoEl.className = playerColor;
    });

    socket.on('gameStart', (data) => {
        gameStarted = true;
        lobbyOverlay.classList.add('hidden');
        roomInfoEl.classList.remove('hidden');
        statusEl.textContent = 'Game Started! Your turn to conquer!';
        statusEl.style.background = '#9b59b6';
        resetBtn.style.display = 'none';
        
        console.log('Battle Royale started with', data.totalPlayers, 'players');
    });

    socket.on('gameState', (state) => {
        // Detect ownership changes (attacks) by comparing with previous state
        if (previousGameState && previousGameState.grid && state.grid) {
            for (let y = 0; y < state.grid.length; y++) {
                for (let x = 0; x < state.grid[y].length; x++) {
                    const prevCell = previousGameState.grid[y][x];
                    const newCell = state.grid[y][x];
                    // If cell changed owner and new owner is the player, play attack sound
                    if (prevCell && newCell && prevCell.owner !== newCell.owner && newCell.owner === playerColor) {
                        AudioManager.play('attack');
                        break;
                    }
                }
            }
        }
        previousGameState = JSON.parse(JSON.stringify(state));
        gameState = state;
        render();
    });

    socket.on('gameOver', (data) => {
        gameStarted = false;
        const isWinner = data.winner === playerColor;
        const winnerName = playerNames[data.winner] || (data.winner ? data.winner.toUpperCase() : 'NADIE');
        
        // Play win or lose sound
        AudioManager.play(isWinner ? 'win' : 'lose');
        
        gameOverOverlay.classList.remove('hidden', 'victory', 'defeat');
        gameOverOverlay.classList.add(isWinner ? 'victory' : 'defeat');
        
        if (data.reason === 'last_man_standing') {
            gameOverTitle.textContent = isWinner ? 'VICTORIA!' : 'VICTORIA DE ' + winnerName + '!';
            gameOverMessage.textContent = isWinner ? 'Eres el ultimo superviviente! Conquistaste todos los reinos!' : 'El juego ha terminado.';
        } else if (data.reason === 'disconnect') {
            gameOverTitle.textContent = isWinner ? 'VICTORIA!' : 'DERROTA...';
            gameOverMessage.textContent = isWinner ? 'Tu oponente se desconecto.' : 'Te desconectaste.';
        } else if (data.reason === 'draw') {
            gameOverTitle.textContent = 'EMPATE';
            gameOverMessage.textContent = 'No quedan supervivientes!';
        } else {
            gameOverTitle.textContent = 'VICTORIA DE ' + winnerName + '!';
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
        
        // Show lobby again
        lobbyOverlay.classList.remove('hidden');
        roomInfoEl.classList.add('hidden');
    });

    socket.on('playerCount', (data) => {
        const { current, required, alive } = data;
        
        if (gameStarted) {
            playerCounterEl.textContent = 'Jugadores vivos: ' + alive;
            playerCounterEl.style.color = '#27ae60';
        } else {
            playerCounterEl.textContent = 'Jugadores: ' + current + '/' + required;
            playerCounterEl.style.color = '#f39c12';
        }
    });

    socket.on('playerNames', (data) => {
        playerNames = data;
        updateMatchInfo();
    });

    socket.on('eliminated', (data) => {
        console.log('%c☠️ ELIMINADO! %cPosicion: #' + data.placement, 
            'background: #e74c3c; color: white; font-weight: bold; padding: 2px 6px; border-radius: 3px;',
            'color: #e74c3c; font-weight: bold;'
        );
        
        gameOverOverlay.classList.remove('hidden', 'victory', 'defeat');
        gameOverOverlay.classList.add('defeat');
        gameOverTitle.textContent = 'ELIMINADO';
        gameOverMessage.textContent = 'Quedaste en posicion #' + data.placement + '. ' + (data.killedBy ? playerNames[data.killedBy] + ' absorbio tu reino!' : 'Te desconectaste.');
        statusEl.textContent = 'Eliminado - #' + data.placement;
        statusEl.style.background = '#e74c3c';
    });

    socket.on('playerEliminated', (data) => {
        const eliminatedName = playerNames[data.eliminatedColor] || data.eliminatedColor.toUpperCase();
        const killerName = data.eliminatedBy ? (playerNames[data.eliminatedBy] || data.eliminatedBy.toUpperCase()) : 'Desconexion';
        
        console.log('%c⚔️ ELIMINACION! %c' + eliminatedName + ' fue eliminado por ' + killerName + '. Quedan ' + data.alivePlayers + ' jugadores.', 
            'background: #9b59b6; color: white; font-weight: bold; padding: 2px 6px; border-radius: 3px;',
            'color: #9b59b6; font-weight: bold;'
        );
        
        statusEl.textContent = eliminatedName + ' eliminado! Quedan ' + data.alivePlayers;
        statusEl.style.background = '#9b59b6';
    });

    socket.on('artilleryFire', (data) => {
        // Play cannon sound when artillery fires
        AudioManager.play('cannon');
        
        const ownerLabel = data.artilleryOwner === 'neutral' ? 'NEUTRAL' : data.artilleryOwner.toUpperCase();
        console.log('%c💣 ARTILLERY FIRE! %c' + ownerLabel + ' artillery at (' + data.from.x + ',' + data.from.y + ') hit ' + data.targetOwner.toUpperCase() + ' at (' + data.to.nx + ',' + data.to.ny + ') for ' + data.damage + ' damage!', 
            'background: #ff8c00; color: white; font-weight: bold; padding: 2px 6px; border-radius: 3px;',
            'color: #ff8c00; font-weight: bold;'
        );
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
            } else if (cell.terrain === TERRAIN.OUTPOST) {
                fillColor = getOutpostColor(cell.owner);
            } else if (cell.terrain === TERRAIN.ARTILLERY) {
                fillColor = getArtilleryColor(cell.owner);
            } else if (cell.owner) {
                fillColor = getPlayerColor(cell.owner);
            }

            ctx.fillStyle = fillColor;
            ctx.fillRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);

            if (cell.unit === 'general' && cell.owner) {
                ctx.strokeStyle = COLORS.general;
                ctx.lineWidth = 2;
                ctx.strokeRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);
                
                ctx.font = '10px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText('👑', px + CELL_SIZE / 2, py + 1);
            }

            if (cell.terrain === TERRAIN.OUTPOST) {
                ctx.strokeStyle = COLORS.outpostBorder;
                ctx.lineWidth = 2;
                ctx.strokeRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);
                
                ctx.font = '10px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillStyle = COLORS.text;
                ctx.fillText('🏯', px + CELL_SIZE / 2, py + 1);
            }

            if (cell.terrain === TERRAIN.ARTILLERY) {
                ctx.strokeStyle = COLORS.artilleryBorder;
                ctx.lineWidth = 2;
                ctx.strokeRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);
                
                ctx.font = '10px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillStyle = COLORS.text;
                ctx.fillText('💣', px + CELL_SIZE / 2, py + 1);
            }

            if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
                ctx.strokeStyle = isSplitMove ? COLORS.selectedSplit : COLORS.selected;
                ctx.lineWidth = 2;
                if (isSplitMove) {
                    ctx.setLineDash([3, 2]);
                }
                ctx.strokeRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);
                ctx.setLineDash([]);
            }

            if (cell.troops > 0 && cell.terrain !== TERRAIN.MOUNTAIN) {
                ctx.fillStyle = COLORS.text;
                ctx.font = 'bold 8px Arial';
                ctx.textAlign = 'center';
                const hasTopIcon = cell.unit === 'general' || cell.terrain === TERRAIN.OUTPOST || cell.terrain === TERRAIN.ARTILLERY;
                ctx.textBaseline = hasTopIcon ? 'bottom' : 'middle';
                const textY = hasTopIcon ? py + CELL_SIZE - 2 : py + CELL_SIZE / 2;
                ctx.fillText(cell.troops.toString(), px + CELL_SIZE / 2, textY);
            }

            if (cell.terrain === TERRAIN.MOUNTAIN) {
                ctx.fillStyle = '#4a5568';
                ctx.beginPath();
                ctx.moveTo(px + CELL_SIZE / 2, py + 3);
                ctx.lineTo(px + CELL_SIZE - 3, py + CELL_SIZE - 3);
                ctx.lineTo(px + 3, py + CELL_SIZE - 3);
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

function updateMatchInfo() {
    if (!playerColor || !playerNames) {
        matchInfoEl.innerHTML = '';
        return;
    }
    
    const allColors = ['red', 'blue', 'green', 'yellow', 'purple'];
    const activePlayers = allColors.filter(color => playerNames[color]);
    
    if (activePlayers.length === 0) {
        matchInfoEl.innerHTML = '';
        return;
    }
    
    const playerSpans = activePlayers.map(color => {
        const name = playerNames[color] || color.toUpperCase();
        const isYou = color === playerColor;
        return `<span class="player-name ${color}${isYou ? ' you' : ''}">${name}${isYou ? ' (Tu)' : ''}</span>`;
    });
    
    matchInfoEl.innerHTML = playerSpans.join('<span style="color: #888;"> vs </span>');
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
            // Play move sound when moving troops
            AudioManager.play('move');
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
        // Play split sound when activating split move
        AudioManager.play('split');
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

// Room creation/joining event handlers
createRoomBtn.addEventListener('click', () => {
    const nickname = nicknameInput.value.trim();
    if (!nickname) {
        alert('Por favor ingresa un nickname');
        nicknameInput.focus();
        return;
    }
    playerNickname = nickname;
    pendingAction = 'create';
    loginOverlay.classList.add('hidden');
    classModal.classList.remove('hidden');
});

joinRoomBtn.addEventListener('click', () => {
    const nickname = nicknameInput.value.trim();
    const roomCode = roomCodeInput.value.trim().toUpperCase();
    
    if (!nickname) {
        alert('Por favor ingresa un nickname');
        nicknameInput.focus();
        return;
    }
    if (!roomCode || roomCode.length !== 4) {
        alert('Por favor ingresa un codigo de sala valido (4 letras)');
        roomCodeInput.focus();
        return;
    }
    
    playerNickname = nickname;
    pendingAction = 'join';
    loginOverlay.classList.add('hidden');
    classModal.classList.remove('hidden');
});

roomCodeInput.addEventListener('input', (event) => {
    // Auto-uppercase and limit to 4 characters
    event.target.value = event.target.value.toUpperCase().slice(0, 4);
});

roomCodeInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        joinRoomBtn.click();
    }
});

nicknameInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        createRoomBtn.click();
    }
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

// Lobby event handlers
startGameBtn.addEventListener('click', () => {
    if (socket && isHost) {
        socket.emit('hostStartGame');
    }
});

leaveRoomBtn.addEventListener('click', () => {
    if (socket) {
        socket.emit('leaveRoom');
    }
});

playAgainBtn.addEventListener('click', () => {
    if (socket) {
        socket.emit('requestReset');
    }
});

// Initialize AudioManager
AudioManager.init();

// Mute button handler
const muteBtn = document.getElementById('muteBtn');
if (muteBtn) {
    muteBtn.addEventListener('click', () => {
        const isMuted = AudioManager.toggleMute();
        muteBtn.textContent = isMuted ? '🔇' : '🔈';
        muteBtn.title = isMuted ? 'Activar sonido' : 'Silenciar';
    });
}

// Initial render (without connection - wait for login)
render();
