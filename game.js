const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const playerInfoEl = document.getElementById('player-info');
const resetBtn = document.getElementById('resetBtn');
const classModal = document.getElementById('class-modal');
const tankBtn = document.getElementById('tank-btn');
const rusherBtn = document.getElementById('rusher-btn');
const scoutBtn = document.getElementById('scout-btn');
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

// Chat UI elements
const chatContainer = document.getElementById('chat-container');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const toggleChatBtn = document.getElementById('toggleChatBtn');

// Help Modal UI elements
const helpBtn = document.getElementById('helpBtn');
const helpModal = document.getElementById('help-modal');
const closeHelpBtn = document.getElementById('closeHelpBtn');

// Ranking Modal UI elements
const rankingBtn = document.getElementById('rankingBtn');
const rankingModal = document.getElementById('ranking-modal');
const closeRankingBtn = document.getElementById('closeRankingBtn');
const rankingList = document.getElementById('ranking-list');

const GRID_SIZE = 30;

// Zoom configuration
const MIN_CELL_SIZE = 20;
const MAX_CELL_SIZE = 50;
const DEFAULT_CELL_SIZE_PC = 25;
const DEFAULT_CELL_SIZE_MOBILE = 35;
const ZOOM_STEP = 5;

// Detect if mobile or tablet device (includes tablets up to 1024px for touch support)
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 1024 || ('ontouchstart' in window);

// Set initial cell size based on device (35px minimum for mobile for touch-friendly cells)
let cellSize = isMobile ? DEFAULT_CELL_SIZE_MOBILE : DEFAULT_CELL_SIZE_PC;

// Update canvas size based on current cell size
function updateCanvasSize() {
    canvas.width = GRID_SIZE * cellSize;
    canvas.height = GRID_SIZE * cellSize;
}

// Calculate scaled font size based on cell size (baseline is 20px cell)
const BASE_CELL_SIZE = 20;
function getScaledFontSize(baseFontSize) {
    const scale = cellSize / BASE_CELL_SIZE;
    return Math.floor(baseFontSize * scale) + 'px';
}

// Center camera on player's General/King at game start
let hasCenteredOnPlayer = false;
function centerCameraOnPlayer() {
    if (!gameState || !gameState.grid || !playerColor) return;
    
    const gameContainer = document.getElementById('game-container');
    if (!gameContainer) return;
    
    // Find the player's General position
    let generalX = -1;
    let generalY = -1;
    
    for (let y = 0; y < gameState.grid.length; y++) {
        for (let x = 0; x < gameState.grid[y].length; x++) {
            const cell = gameState.grid[y][x];
            if (cell.unit === 'general' && cell.owner === playerColor) {
                generalX = x;
                generalY = y;
                break;
            }
        }
        if (generalX !== -1) break;
    }
    
    if (generalX === -1 || generalY === -1) return;
    
    // Calculate pixel position of the General
    const pixelX = generalX * cellSize;
    const pixelY = generalY * cellSize;
    
    // Calculate scroll position to center the General in the viewport
    const containerWidth = gameContainer.clientWidth;
    const containerHeight = gameContainer.clientHeight;
    
    const scrollX = Math.max(0, pixelX - containerWidth / 2 + cellSize / 2);
    const scrollY = Math.max(0, pixelY - containerHeight / 2 + cellSize / 2);
    
    // Smooth scroll to the General's position
    gameContainer.scrollTo({
        left: scrollX,
        top: scrollY,
        behavior: 'smooth'
    });
}

// Initialize canvas size
updateCanvasSize();

const COLORS = {
    empty: '#f0f0f0',
    mountain: '#6a6a6a',
    red: '#c0392b',
    blue: '#2980b9',
    green: '#1e8449',
    yellow: '#d4ac0d',
    purple: '#7d3c98',
    redLight: 'rgba(192, 57, 43, 0.7)',
    blueLight: 'rgba(41, 128, 185, 0.7)',
    greenLight: 'rgba(30, 132, 73, 0.7)',
    yellowLight: 'rgba(212, 172, 13, 0.7)',
    purpleLight: 'rgba(125, 60, 152, 0.7)',
    grid: '#e0e0e0',
    text: '#1a1a1a',
    textLight: '#ffffff',
    selected: '#f1c40f',
    selectedSplit: '#e67e22',
    general: '#ffd700',
    fog: '#1a1a1a',
    fogPattern: '#252525',
    outpost: '#3d3d3d',
    outpostRed: '#922b21',
    outpostBlue: '#1a5276',
    outpostGreen: '#145a32',
    outpostYellow: '#9a7d0a',
    outpostPurple: '#5b2c6f',
    outpostBorder: '#ffd700',
    artillery: '#8b4513',
    artilleryRed: '#a93226',
    artilleryBlue: '#1f618d',
    artilleryGreen: '#196f3d',
    artilleryYellow: '#b7950b',
    artilleryPurple: '#6c3483',
    artilleryBorder: '#ff6600',
    territoryBorder: '#ffffff'
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
let playerClasses = {};

// Mobile mode toggle state
let mobileSplitMode = false; // When true, taps will do split moves instead of full moves

// Room state
let currentRoomId = null;
let isHost = false;
let pendingAction = null; // 'create' or 'join'

// Session token for reconnection support
function generateSessionToken() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function getOrCreateSessionToken() {
    let token = localStorage.getItem('pixelking_session_token');
    if (!token) {
        token = generateSessionToken();
        localStorage.setItem('pixelking_session_token', token);
    }
    return token;
}

const sessionToken = getOrCreateSessionToken();

// Audio Manager for game sound effects
// MP3-based Audio Manager - Uses local assets to avoid external CDN issues
const AudioManager = {
    sounds: {},
    failedSounds: {}, // Track sounds that failed to load
    muted: false,
    volume: 0.8,
    
    // Local sound paths (place audio files in ./assets/sounds/)
    // If files don't exist, audio will fail silently without blocking gameplay
    soundUrls: {
        move: './assets/sounds/move.mp3',
        attack: './assets/sounds/attack.mp3',
        cannon: './assets/sounds/cannon.mp3',
        split: './assets/sounds/split.mp3',
        win: './assets/sounds/win.mp3',
        lose: './assets/sounds/lose.mp3',
        alarm: './assets/sounds/alarm.mp3',
        radar: './assets/sounds/radar.mp3'
    },
    
    init: function() {
        // Preload all sounds with error handling
        for (const [name, url] of Object.entries(this.soundUrls)) {
            try {
                this.sounds[name] = new Audio(url);
                this.sounds[name].volume = this.volume;
                this.sounds[name].preload = 'auto';
                
                // Mark sound as failed if it errors during load
                this.sounds[name].addEventListener('error', () => {
                    this.failedSounds[name] = true;
                    console.warn('Audio file not found or failed to load:', name);
                });
            } catch (error) {
                this.failedSounds[name] = true;
                console.warn('Failed to initialize audio:', name, error);
            }
        }
        console.log('AudioManager initialized with', Object.keys(this.sounds).length, 'sounds');
    },
    
    play: function(soundName) {
        if (this.muted) return;
        
        // Skip if sound failed to load
        if (this.failedSounds[soundName]) return;
        
        const sound = this.sounds[soundName];
        if (sound) {
            try {
                // Clone the audio to allow overlapping sounds
                const clone = sound.cloneNode();
                clone.volume = this.volume;
                clone.play().catch(err => {
                    // Ignore autoplay errors (user hasn't interacted yet)
                    console.log('Audio play blocked:', err.message);
                });
            } catch (error) {
                // Mark as failed and ignore future attempts
                this.failedSounds[soundName] = true;
                console.warn('Audio error ignorado:', error);
            }
        }
    },
    
    toggleMute: function() {
        this.muted = !this.muted;
        return this.muted;
    },
    
    setVolume: function(vol) {
        this.volume = Math.max(0, Math.min(1, vol));
        for (const sound of Object.values(this.sounds)) {
            if (sound && sound.volume !== undefined) {
                sound.volume = this.volume;
            }
        }
    }
};

// Track previous game state for detecting changes
let previousGameState = null;

// Under attack alert cooldown (5 seconds)
let lastUnderAttackAlert = 0;
const UNDER_ATTACK_COOLDOWN = 5000;

// Function to trigger under attack alert
function triggerUnderAttackAlert() {
    const now = Date.now();
    if (now - lastUnderAttackAlert < UNDER_ATTACK_COOLDOWN) {
        return; // Still in cooldown
    }
    lastUnderAttackAlert = now;
    
    // Play alarm sound (non-blocking, wrapped in try/catch)
    try {
        AudioManager.play('alarm');
    } catch (error) {
        console.warn('Audio error ignorado:', error);
    }
    
    // Add visual effect
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
        gameContainer.classList.add('under-attack');
        // Remove the class after animation completes
        setTimeout(() => {
            gameContainer.classList.remove('under-attack');
        }, 1000);
    }
}

// Enemy spotted alert cooldown (10 seconds)
let lastEnemySpottedAlert = 0;
const ENEMY_SPOTTED_COOLDOWN = 10000;
let previouslyHadVisibleEnemies = false;

// Function to trigger enemy spotted alert
function triggerEnemySpottedAlert() {
    const now = Date.now();
    if (now - lastEnemySpottedAlert < ENEMY_SPOTTED_COOLDOWN) {
        return; // Still in cooldown
    }
    lastEnemySpottedAlert = now;
    
    // Play radar ping sound (non-blocking, wrapped in try/catch)
    try {
        AudioManager.play('radar');
    } catch (error) {
        console.warn('Audio error ignorado:', error);
    }
    
    // Add visual effect (orange flash)
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
        gameContainer.classList.add('enemy-spotted');
        // Remove the class after animation completes
        setTimeout(() => {
            gameContainer.classList.remove('enemy-spotted');
        }, 1000);
    }
}

// Function to check for visible enemies and trigger alert if needed
function checkForVisibleEnemies(state) {
    if (!state || !state.grid || !playerColor || !gameStarted) {
        return;
    }
    
    let hasVisibleEnemies = false;
    
    // Check all visible cells for enemy presence
    for (let y = 0; y < state.grid.length; y++) {
        for (let x = 0; x < state.grid[y].length; x++) {
            const cell = state.grid[y][x];
            // Cell is visible (not in fog) and belongs to an enemy
            if (cell && cell.owner && cell.owner !== playerColor) {
                hasVisibleEnemies = true;
                break;
            }
        }
        if (hasVisibleEnemies) break;
    }
    
    // Trigger alert if we just spotted enemies (weren't visible before, now they are)
    if (hasVisibleEnemies && !previouslyHadVisibleEnemies) {
        triggerEnemySpottedAlert();
    }
    
    // Update state for next check
    previouslyHadVisibleEnemies = hasVisibleEnemies;
}

function connectToServer(selectedClass) {
    playerClass = selectedClass;

    socket = io(window.location.origin, {
        transports: ['websocket'], 
        upgrade: false,
        timeout: 5000,
        auth: {
            sessionToken: sessionToken
        }
    });

    socket.on('connect', () => {
        console.log('Socket connected:', socket.id, 'with sessionToken:', sessionToken);
        
        // Execute pending action after connection
        if (pendingAction === 'create') {
            socket.emit('createRoom', { nickname: playerNickname, playerClass: playerClass, sessionToken: sessionToken });
        } else if (pendingAction === 'join') {
            const roomCode = roomCodeInput.value.trim().toUpperCase();
            socket.emit('joinRoom', { roomId: roomCode, nickname: playerNickname, playerClass: playerClass, sessionToken: sessionToken });
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
        
        // Show chat when joining a room
        if (chatContainer) {
            chatContainer.classList.remove('hidden');
            if (chatMessages) chatMessages.innerHTML = '';
        }
        
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
        
        // Show chat when joining a room
        if (chatContainer) {
            chatContainer.classList.remove('hidden');
            if (chatMessages) chatMessages.innerHTML = '';
        }
        
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
            
            const classIcon = player.playerClass === 'tank' ? '🛡️' : (player.playerClass === 'scout' ? '🐴' : '⚡');
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = classIcon + ' ' + player.name;
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
        hasCenteredOnPlayer = false;
        
        // Hide mobile mode toggle button when leaving room
        const modeToggleBtn = document.getElementById('modeToggleBtn');
        if (modeToggleBtn) {
            modeToggleBtn.classList.remove('game-active');
        }
        
        // Hide chat when leaving room
        if (chatContainer) {
            chatContainer.classList.add('hidden');
        }
        
        lobbyOverlay.classList.add('hidden');
        loginOverlay.classList.remove('hidden');
        roomInfoEl.classList.add('hidden');
    });

    socket.on('playerAssigned', (data) => {
        playerColor = data.color;
        isHost = data.isHost;
        const classLabel = playerClass === 'tank' ? 'Tank' : (playerClass === 'scout' ? 'Scout' : 'Rusher');
        const classIcon = playerClass === 'tank' ? '🛡️' : (playerClass === 'scout' ? '🐴' : '⚡');
        playerInfoEl.textContent = 'You are: ' + playerColor.toUpperCase() + ' ' + classIcon + ' ' + classLabel;
        playerInfoEl.className = playerColor;
    });

    socket.on('reconnected', (data) => {
        console.log('🔄 Successfully reconnected to game!', data);
        console.log('🔄 Reconnected as ID:', data.color, '| Socket:', socket.id, '| gameStarted:', data.gameStarted);
        
        // CRITICAL: Set player identity and game state
        playerColor = data.color;
        playerClass = data.playerClass;
        currentRoomId = data.roomId;
        gameStarted = data.gameStarted;
        isHost = data.isHost;
        
        // Reset selection state to avoid stale references
        selectedCell = null;
        isSplitMove = false;
        
        const classLabel = playerClass === 'tank' ? 'Tank' : (playerClass === 'scout' ? 'Scout' : 'Rusher');
        const classIcon = playerClass === 'tank' ? '🛡️' : (playerClass === 'scout' ? '🐴' : '⚡');
        playerInfoEl.textContent = 'You are: ' + playerColor.toUpperCase() + ' ' + classIcon + ' ' + classLabel;
        playerInfoEl.className = playerColor;
        
        statusEl.textContent = 'Reconnected! Welcome back!';
        statusEl.style.background = '#27ae60';
        
        loginOverlay.classList.add('hidden');
        lobbyOverlay.classList.add('hidden');
        classModal.classList.add('hidden');
        gameOverOverlay.classList.add('hidden');
        
        if (gameStarted) {
            roomInfoEl.classList.remove('hidden');
            const modeToggleBtn = document.getElementById('modeToggleBtn');
            if (modeToggleBtn) {
                modeToggleBtn.classList.add('game-active');
            }
            
            // Note: Server sends gameState immediately after reconnected event
            // No need to request it explicitly
            console.log('🔄 Game is active, waiting for gameState from server...');
        }
        
        if (chatContainer) {
            chatContainer.classList.remove('hidden');
        }
        
        // Force re-render to update canvas with any existing state
        if (gameState) {
            console.log('🔄 Re-rendering with existing gameState');
            render();
        } else {
            console.log('🔄 Waiting for gameState from server...');
        }
        
        // Verify canvas element is still valid
        const currentCanvas = document.getElementById('gameCanvas');
        if (currentCanvas !== canvas) {
            console.warn('⚠️ Canvas element reference changed! This may cause input issues.');
        }
        
        console.log('🔄 Reconnection complete. Controls should be active. playerColor:', playerColor, 'gameStarted:', gameStarted);
    });

    socket.on('playerReconnected', (data) => {
        console.log('Player reconnected:', data.nickname);
        addSystemMessage(data.nickname + ' ha vuelto!');
    });

    socket.on('playerDisconnecting', (data) => {
        console.log('Player disconnecting:', data.nickname, '- timeout in', data.timeout, 'seconds');
        addSystemMessage(data.nickname + ' se desconecto. Tiene ' + data.timeout + 's para volver.');
    });

    socket.on('gameStart', (data) => {
        gameStarted = true;
        lobbyOverlay.classList.add('hidden');
        roomInfoEl.classList.remove('hidden');
        statusEl.textContent = 'Game Started! Your turn to conquer!';
        statusEl.style.background = '#9b59b6';
        resetBtn.style.display = 'none';
        
        // Show mobile mode toggle button when game starts
        const modeToggleBtn = document.getElementById('modeToggleBtn');
        if (modeToggleBtn) {
            modeToggleBtn.classList.add('game-active');
        }
        
        console.log('Battle Royale started with', data.totalPlayers, 'players');
    });

    socket.on('gameState', (state) => {
        // Log gameState reception for debugging reconnection issues
        console.log('📊 gameState received - grid:', !!state?.grid, 'playerColor:', playerColor, 'gameStarted:', gameStarted);
        
        // Detect ownership changes (attacks) by comparing with previous state
        let playerLostCell = false;
        if (previousGameState && previousGameState.grid && state.grid) {
            for (let y = 0; y < state.grid.length; y++) {
                for (let x = 0; x < state.grid[y].length; x++) {
                    const prevCell = previousGameState.grid[y][x];
                    const newCell = state.grid[y][x];
                    
                    // If cell changed owner and new owner is the player, play attack sound
                    if (prevCell && newCell && prevCell.owner !== newCell.owner && newCell.owner === playerColor) {
                        try {
                            AudioManager.play('attack');
                        } catch (error) {
                            console.warn('Audio error ignorado:', error);
                        }
                    }
                    
                    // If player lost a cell (was theirs, now belongs to enemy), trigger under attack alert
                    if (prevCell && newCell && prevCell.owner === playerColor && newCell.owner !== playerColor && newCell.owner !== null) {
                        playerLostCell = true;
                    }
                }
            }
        }
        
        // Trigger under attack alert if player lost any cells
        if (playerLostCell && gameStarted) {
            triggerUnderAttackAlert();
        }
        
        // Check for visible enemies and trigger alert if newly spotted
        checkForVisibleEnemies(state);
        
        previousGameState = JSON.parse(JSON.stringify(state));
        gameState = state;
        render();
        
        // Center camera on player's General at game start (only once)
        if (gameStarted && !hasCenteredOnPlayer) {
            hasCenteredOnPlayer = true;
            setTimeout(() => centerCameraOnPlayer(), 100);
        }
    });

    socket.on('gameOver', (data) => {
        gameStarted = false;
        const isWinner = data.winner === playerColor;
        const winnerName = data.winnerName || playerNames[data.winner] || (data.winner ? data.winner.toUpperCase() : 'NADIE');
        
        // Hide mobile mode toggle button on game over
        const modeToggleBtn = document.getElementById('modeToggleBtn');
        if (modeToggleBtn) {
            modeToggleBtn.classList.remove('game-active');
        }
        
        // Play win or lose sound (non-blocking, wrapped in try/catch)
        try {
            AudioManager.play(isWinner ? 'win' : 'lose');
        } catch (error) {
            console.warn('Audio error ignorado:', error);
        }
        
        gameOverOverlay.classList.remove('hidden', 'victory', 'defeat');
        gameOverOverlay.classList.add(isWinner ? 'victory' : 'defeat');
        
        if (data.reason === 'last_man_standing') {
            gameOverTitle.textContent = isWinner ? 'VICTORIA!' : 'VICTORIA DE ' + winnerName + '!';
            if (isWinner && data.totalWins) {
                gameOverMessage.textContent = 'Tu victoria #' + data.totalWins + '! Eres el ultimo superviviente!';
            } else {
                gameOverMessage.textContent = isWinner ? 'Eres el ultimo superviviente! Conquistaste todos los reinos!' : 'El juego ha terminado.';
            }
        } else if (data.reason === 'disconnect') {
            gameOverTitle.textContent = isWinner ? 'VICTORIA!' : 'DERROTA...';
            if (isWinner && data.totalWins) {
                gameOverMessage.textContent = 'Tu victoria #' + data.totalWins + '! Tu oponente se desconecto.';
            } else {
                gameOverMessage.textContent = isWinner ? 'Tu oponente se desconecto.' : 'Te desconectaste.';
            }
        } else if (data.reason === 'draw') {
            gameOverTitle.textContent = 'EMPATE';
            gameOverMessage.textContent = 'No quedan supervivientes!';
        } else {
            gameOverTitle.textContent = 'VICTORIA DE ' + winnerName + '!';
            if (isWinner && data.totalWins) {
                gameOverMessage.textContent = 'Tu victoria #' + data.totalWins + '! Capturaste al General enemigo!';
            } else {
                gameOverMessage.textContent = isWinner ? 'Capturaste al General enemigo!' : 'Tu General fue capturado!';
            }
        }
        
        statusEl.textContent = isWinner ? 'VICTORY!' : 'DEFEAT!';
        statusEl.style.background = isWinner ? '#27ae60' : '#e74c3c';
        resetBtn.style.display = 'none';
    });

    socket.on('gameReset', () => {
        selectedCell = null;
        isSplitMove = false;
        gameStarted = false;
        hasCenteredOnPlayer = false;
        statusEl.textContent = 'Game Reset! Waiting for players...';
        statusEl.style.background = '#f39c12';
        resetBtn.style.display = 'none';
        gameOverOverlay.classList.add('hidden');
        
        // Hide mobile mode toggle button on game reset
        const modeToggleBtn = document.getElementById('modeToggleBtn');
        if (modeToggleBtn) {
            modeToggleBtn.classList.remove('game-active');
        }
        
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
        playerNames = data.names || data;
        playerClasses = data.classes || {};
        updateMatchInfo();
    });

    socket.on('eliminated', (data) => {
        console.log('%c☠️ ELIMINADO! %cPosicion: #' + data.placement, 
            'background: #e74c3c; color: white; font-weight: bold; padding: 2px 6px; border-radius: 3px;',
            'color: #e74c3c; font-weight: bold;'
        );
        
        // Hide mobile mode toggle button when eliminated
        const modeToggleBtn = document.getElementById('modeToggleBtn');
        if (modeToggleBtn) {
            modeToggleBtn.classList.remove('game-active');
        }
        
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
        // Play cannon sound when artillery fires (non-blocking, wrapped in try/catch)
        try {
            AudioManager.play('cannon');
        } catch (error) {
            console.warn('Audio error ignorado:', error);
        }
        
        const ownerLabel = data.artilleryOwner === 'neutral' ? 'NEUTRAL' : data.artilleryOwner.toUpperCase();
        console.log('%c💣 ARTILLERY FIRE! %c' + ownerLabel + ' artillery at (' + data.from.x + ',' + data.from.y + ') hit ' + data.targetOwner.toUpperCase() + ' at (' + data.to.nx + ',' + data.to.ny + ') for ' + data.damage + ' damage!', 
            'background: #ff8c00; color: white; font-weight: bold; padding: 2px 6px; border-radius: 3px;',
            'color: #ff8c00; font-weight: bold;'
        );
    });

    socket.on('new_message', (data) => {
        addChatMessage(data.nickname, data.text, data.color);
    });

    socket.on('ranking_data', (data) => {
        renderRanking(data.ranking);
    });
}

function render() {
    if (!gameState) return;

    ctx.fillStyle = COLORS.grid;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = gameState.grid[y][x];
            const px = x * cellSize;
            const py = y * cellSize;

            // Draw fog of war with subtle pattern
            if (cell.isFog) {
                ctx.fillStyle = COLORS.fog;
                ctx.fillRect(px + 1, py + 1, cellSize - 2, cellSize - 2);
                
                // Add subtle diagonal pattern for "unknown" effect
                ctx.strokeStyle = COLORS.fogPattern;
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(px + 1, py + cellSize - 1);
                ctx.lineTo(px + cellSize - 1, py + 1);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(px + cellSize / 2, py + cellSize - 1);
                ctx.lineTo(px + cellSize - 1, py + cellSize / 2);
                ctx.stroke();
                
                // Draw question mark for mystery
                ctx.fillStyle = '#333333';
                ctx.font = 'bold ' + getScaledFontSize(8) + ' Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('?', px + cellSize / 2, py + cellSize / 2);
                continue;
            }

            let fillColor = COLORS.empty;
            let hasOwner = false;

            if (cell.terrain === TERRAIN.MOUNTAIN) {
                fillColor = COLORS.mountain;
            } else if (cell.terrain === TERRAIN.OUTPOST) {
                fillColor = getOutpostColor(cell.owner);
                hasOwner = !!cell.owner;
            } else if (cell.terrain === TERRAIN.ARTILLERY) {
                fillColor = getArtilleryColor(cell.owner);
                hasOwner = !!cell.owner;
            } else if (cell.owner) {
                fillColor = getPlayerColor(cell.owner);
                hasOwner = true;
            }

            // Draw base cell color
            ctx.fillStyle = fillColor;
            ctx.fillRect(px + 1, py + 1, cellSize - 2, cellSize - 2);

            // Add glowing border for conquered territory
            if (hasOwner && cell.terrain !== TERRAIN.OUTPOST && cell.terrain !== TERRAIN.ARTILLERY && cell.unit !== 'general') {
                ctx.save();
                ctx.shadowColor = getPlayerColor(cell.owner);
                ctx.shadowBlur = 3;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.lineWidth = 1;
                ctx.strokeRect(px + 1, py + 1, cellSize - 2, cellSize - 2);
                ctx.restore();
            }

            // Draw General (King) with large castle emoji
            if (cell.unit === 'general' && cell.owner) {
                // Golden glow border for general
                ctx.save();
                ctx.shadowColor = COLORS.general;
                ctx.shadowBlur = 6;
                ctx.strokeStyle = COLORS.general;
                ctx.lineWidth = 2;
                ctx.strokeRect(px + 1, py + 1, cellSize - 2, cellSize - 2);
                ctx.restore();
                
                // Draw castle emoji (larger)
                ctx.font = getScaledFontSize(12) + ' Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText('🏰', px + cellSize / 2, py + 1);
            }

            // Draw Outpost (Tower) with fort emoji
            if (cell.terrain === TERRAIN.OUTPOST) {
                ctx.save();
                ctx.shadowColor = COLORS.outpostBorder;
                ctx.shadowBlur = 4;
                ctx.strokeStyle = COLORS.outpostBorder;
                ctx.lineWidth = 2;
                ctx.strokeRect(px + 1, py + 1, cellSize - 2, cellSize - 2);
                ctx.restore();
                
                // Draw tower emoji
                ctx.font = getScaledFontSize(11) + ' Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText('🏯', px + cellSize / 2, py + 1);
            }

            // Draw Artillery with cannon emoji
            if (cell.terrain === TERRAIN.ARTILLERY) {
                ctx.save();
                ctx.shadowColor = COLORS.artilleryBorder;
                ctx.shadowBlur = 4;
                ctx.strokeStyle = COLORS.artilleryBorder;
                ctx.lineWidth = 2;
                ctx.strokeRect(px + 1, py + 1, cellSize - 2, cellSize - 2);
                ctx.restore();
                
                // Draw cannon/bomb emoji
                ctx.font = getScaledFontSize(11) + ' Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText('🧨', px + cellSize / 2, py + 1);
            }

            // Draw selection highlight
            if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
                const isInSplitMode = isSplitMove || mobileSplitMode;
                const selectionColor = isInSplitMode ? COLORS.selectedSplit : COLORS.selected;
                
                // Draw semi-transparent highlight overlay
                ctx.fillStyle = isInSplitMode ? 'rgba(230, 126, 34, 0.4)' : 'rgba(241, 196, 15, 0.4)';
                ctx.fillRect(px + 1, py + 1, cellSize - 2, cellSize - 2);
                
                // Draw animated glow effect
                ctx.save();
                ctx.shadowColor = selectionColor;
                ctx.shadowBlur = 10;
                ctx.strokeStyle = selectionColor;
                ctx.lineWidth = 3;
                ctx.strokeRect(px + 1, py + 1, cellSize - 2, cellSize - 2);
                ctx.restore();
                
                // Draw inner bright border
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1;
                ctx.strokeRect(px + 2, py + 2, cellSize - 4, cellSize - 4);
            }

            // Draw troops with army icons for large armies
            if (cell.troops > 0 && cell.terrain !== TERRAIN.MOUNTAIN) {
                const hasTopIcon = cell.unit === 'general' || cell.terrain === TERRAIN.OUTPOST || cell.terrain === TERRAIN.ARTILLERY;
                // Use light text on colored backgrounds (owned cells), dark text on light backgrounds (empty cells)
                const textColor = cell.owner ? COLORS.textLight : COLORS.text;
                
                if (cell.troops > 10 && !hasTopIcon) {
                    // Large army: show swords emoji + number
                    ctx.font = getScaledFontSize(9) + ' Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    ctx.fillText('⚔️', px + cellSize / 2, py + 1);
                    
                    ctx.fillStyle = textColor;
                    ctx.font = 'bold ' + getScaledFontSize(7) + ' Arial';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(cell.troops.toString(), px + cellSize / 2, py + cellSize - 1);
                } else if (cell.troops > 5 && !hasTopIcon) {
                    // Medium army: show shield emoji + number
                    ctx.font = getScaledFontSize(9) + ' Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    ctx.fillText('🛡️', px + cellSize / 2, py + 1);
                    
                    ctx.fillStyle = textColor;
                    ctx.font = 'bold ' + getScaledFontSize(7) + ' Arial';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(cell.troops.toString(), px + cellSize / 2, py + cellSize - 1);
                } else {
                    // Small army or special building: just show number
                    ctx.fillStyle = textColor;
                    ctx.font = 'bold ' + getScaledFontSize(8) + ' Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = hasTopIcon ? 'bottom' : 'middle';
                    const textY = hasTopIcon ? py + cellSize - 1 : py + cellSize / 2;
                    ctx.fillText(cell.troops.toString(), px + cellSize / 2, textY);
                }
            }

            // Draw mountain with emoji
            if (cell.terrain === TERRAIN.MOUNTAIN) {
                ctx.font = getScaledFontSize(12) + ' Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('⛰️', px + cellSize / 2, py + cellSize / 2);
            }
        }
    }

    // Draw grid lines with subtle gray color for light map theme
    ctx.strokeStyle = '#d0d0d0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= GRID_SIZE; i++) {
        ctx.beginPath();
        ctx.moveTo(i * cellSize, 0);
        ctx.lineTo(i * cellSize, canvas.height);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, i * cellSize);
        ctx.lineTo(canvas.width, i * cellSize);
        ctx.stroke();
    }
}

function getCellFromMouse(event) {
    const rect = canvas.getBoundingClientRect();
    
    // Get coordinates - handle both mouse and touch events
    let clientX, clientY;
    if (event.touches && event.touches.length > 0) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
    } else {
        clientX = event.clientX;
        clientY = event.clientY;
    }
    
    // Use CSS cell size (rect.width / GRID_SIZE) instead of fixed cellSize
    // This handles CSS-scaled canvas on mobile correctly
    const cssCellWidth = rect.width / GRID_SIZE;
    const cssCellHeight = rect.height / GRID_SIZE;
    
    const x = Math.floor((clientX - rect.left) / cssCellWidth);
    const y = Math.floor((clientY - rect.top) / cssCellHeight);

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

function getClassIcon(classType) {
    if (classType === 'tank') return '🛡️';
    if (classType === 'scout') return '🐴';
    return '⚡';
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
        const classIcon = getClassIcon(playerClasses[color]);
        const isYou = color === playerColor;
        return `<span class="player-name ${color}${isYou ? ' you' : ''}">${name} ${classIcon}${isYou ? ' (Tu)' : ''}</span>`;
    });
    
    matchInfoEl.innerHTML = playerSpans.join('<span style="color: #888;"> vs </span>');
}

// Unified handler for both mouse and touch input
function handleCanvasInput(event) {
    // Debug logging to verify click detection
    const clickPos = getCellFromMouse(event);
    console.log('🖱️ Canvas clicked/touched at:', clickPos ? `(${clickPos.x}, ${clickPos.y})` : 'outside grid', 
        '| gameState:', !!gameState, 
        '| gameStarted:', gameStarted, 
        '| playerColor:', playerColor,
        '| socket:', socket ? socket.id : 'null');
    
    if (!gameState || !gameStarted || gameState.winner) {
        console.log('🚫 Input blocked - gameState:', !!gameState, 'gameStarted:', gameStarted, 'winner:', gameState?.winner);
        return;
    }

    const clickedCell = getCellFromMouse(event);
    if (!clickedCell) return;

    const cell = gameState.grid[clickedCell.y][clickedCell.x];

    if (selectedCell) {
        if (clickedCell.x === selectedCell.x && clickedCell.y === selectedCell.y) {
            // Tapping same cell deselects
            selectedCell = null;
            isSplitMove = false;
            statusEl.textContent = 'Seleccion cancelada';
            statusEl.style.background = '#9b59b6';
        } else if (isAdjacent(selectedCell, clickedCell)) {
            // Use mobileSplitMode if active, otherwise use isSplitMove (from double-click)
            const useSplitMove = mobileSplitMode || isSplitMove;
            
            // CRITICAL: Send move to server FIRST, before any audio
            console.log('🚀 Emitting move:', { from: selectedCell, to: clickedCell, splitMove: useSplitMove }, 'socket.connected:', socket?.connected);
            socket.emit('move', {
                from: selectedCell,
                to: clickedCell,
                splitMove: useSplitMove
            });
            selectedCell = null;
            isSplitMove = false;
            
            // Play appropriate sound (non-blocking, wrapped in try/catch)
            try {
                if (useSplitMove) {
                    AudioManager.play('split');
                } else {
                    AudioManager.play('move');
                }
            } catch (error) {
                console.warn('Audio error ignorado:', error);
            }
        } else if (cell.terrain !== 'mountain') {
            // CLIENT-SIDE BYPASS: Allow selecting ANY non-mountain cell
            // Server will validate if the move is legal
            selectedCell = clickedCell;
            isSplitMove = false;
            const modeLabel = mobileSplitMode ? 'DIVIDIR' : 'MOVER';
            const ownerInfo = cell.owner ? `(${cell.owner})` : '(vacía)';
            statusEl.textContent = `Celda seleccionada ${ownerInfo} - Toca una celda vecina`;
            statusEl.style.background = mobileSplitMode ? '#e67e22' : '#3498db';
            console.log('✅ Re-selected cell:', clickedCell, 'owner:', cell.owner, 'troops:', cell.troops);
        } else {
            // Mountain - deselect
            selectedCell = null;
            isSplitMove = false;
            console.log('🏔️ Montaña - deseleccionando');
        }
    } else {
        // CLIENT-SIDE BYPASS: Allow selecting ANY cell - server will validate ownership
        // This fixes reconnection issues where playerColor doesn't match cell.owner
        if (cell.terrain !== 'mountain') {
            selectedCell = clickedCell;
            isSplitMove = false;
            const modeLabel = mobileSplitMode ? 'DIVIDIR' : 'MOVER';
            const ownerInfo = cell.owner ? `(${cell.owner})` : '(vacía)';
            statusEl.textContent = `Celda seleccionada ${ownerInfo} - Toca una celda vecina`;
            statusEl.style.background = mobileSplitMode ? '#e67e22' : '#3498db';
            console.log('✅ Selected cell:', clickedCell, 'owner:', cell.owner, 'troops:', cell.troops, 'myColor:', playerColor);
        } else {
            console.log('🏔️ Montaña - no seleccionable');
        }
    }

    render();
}

// Use pointerdown for unified mouse/touch handling (better mobile support)
canvas.addEventListener('pointerdown', (event) => {
    // Prevent default to avoid double-firing on touch devices
    event.preventDefault();
    handleCanvasInput(event);
});

// Fallback click handler for older browsers
canvas.addEventListener('click', (event) => {
    // Only handle if pointerdown didn't fire (older browsers)
    if (!window.PointerEvent) {
        handleCanvasInput(event);
    }
});

canvas.addEventListener('dblclick', (event) => {
    if (!gameState || !gameStarted || gameState.winner) return;

    const clickedCell = getCellFromMouse(event);
    if (!clickedCell) return;

    const cell = gameState.grid[clickedCell.y][clickedCell.x];

    if (cell.owner === playerColor && cell.troops >= 2) {
        // Play split sound when activating split move (non-blocking, wrapped in try/catch)
        try {
            AudioManager.play('split');
        } catch (error) {
            console.warn('Audio error ignorado:', error);
        }
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
    AudioManager.init(); // Preload sounds on user interaction
    classModal.classList.add('hidden');
    statusEl.textContent = 'Connecting...';
    connectToServer('tank');
});

rusherBtn.addEventListener('click', () => {
    AudioManager.init(); // Preload sounds on user interaction
    classModal.classList.add('hidden');
    statusEl.textContent = 'Connecting...';
    connectToServer('rusher');
});

scoutBtn.addEventListener('click', () => {
    AudioManager.init(); // Preload sounds on user interaction
    classModal.classList.add('hidden');
    statusEl.textContent = 'Connecting...';
    connectToServer('scout');
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

// Mobile mode toggle button handler
const modeToggleBtn = document.getElementById('modeToggleBtn');
const modeText = document.getElementById('modeText');
if (modeToggleBtn && modeText) {
    modeToggleBtn.addEventListener('click', () => {
        mobileSplitMode = !mobileSplitMode;
        
        if (mobileSplitMode) {
            modeText.textContent = 'DIVIDIR';
            modeToggleBtn.classList.add('split-mode');
            statusEl.textContent = 'Modo DIVIDIR activo - Toca para mover 50% de tropas';
            statusEl.style.background = '#e67e22';
        } else {
            modeText.textContent = 'MOVER';
            modeToggleBtn.classList.remove('split-mode');
            statusEl.textContent = 'Modo MOVER activo - Toca para mover todas las tropas';
            statusEl.style.background = '#3498db';
        }
        
        // Play split sound as feedback when toggling to split mode (non-blocking, wrapped in try/catch)
        if (mobileSplitMode) {
            try {
                AudioManager.play('split');
            } catch (error) {
                console.warn('Audio error ignorado:', error);
            }
        }
    });
}

// Initial render (without connection - wait for login)
render();

// Chat functions
function addChatMessage(nickname, text, color) {
    if (!chatMessages) return;
    
    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message';
    
    const nickEl = document.createElement('span');
    nickEl.className = 'chat-nick';
    nickEl.style.color = COLORS[color] || '#fff';
    nickEl.textContent = '[' + nickname + ']:';
    
    const textEl = document.createElement('span');
    textEl.className = 'chat-text';
    textEl.textContent = ' ' + text;
    
    messageEl.appendChild(nickEl);
    messageEl.appendChild(textEl);
    chatMessages.appendChild(messageEl);
    
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemMessage(text) {
    if (!chatMessages) return;
    
    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message system-message';
    messageEl.textContent = text;
    chatMessages.appendChild(messageEl);
    
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendChatMessage() {
    if (!socket || !chatInput) return;
    
    const text = chatInput.value.trim();
    if (text.length === 0) return;
    
    socket.emit('send_message', { text: text });
    chatInput.value = '';
}

function showChat() {
    if (chatContainer) {
        chatContainer.classList.remove('hidden');
    }
}

function hideChat() {
    if (chatContainer) {
        chatContainer.classList.add('hidden');
    }
}

// Chat event handlers
if (sendChatBtn) {
    sendChatBtn.addEventListener('click', sendChatMessage);
}

if (chatInput) {
    chatInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            sendChatMessage();
        }
    });
}

if (toggleChatBtn) {
    toggleChatBtn.addEventListener('click', () => {
        if (chatContainer) {
            chatContainer.classList.toggle('minimized');
            toggleChatBtn.textContent = chatContainer.classList.contains('minimized') ? '+' : '−';
        }
    });
}

// Help Modal event handlers
if (helpBtn) {
    helpBtn.addEventListener('click', () => {
        if (helpModal) {
            helpModal.classList.remove('hidden');
        }
    });
}

if (closeHelpBtn) {
    closeHelpBtn.addEventListener('click', () => {
        if (helpModal) {
            helpModal.classList.add('hidden');
        }
    });
}

if (helpModal) {
    helpModal.addEventListener('click', (event) => {
        if (event.target === helpModal) {
            helpModal.classList.add('hidden');
        }
    });
}

function renderRanking(ranking) {
    if (!rankingList) return;
    
    if (!ranking || ranking.length === 0) {
        rankingList.innerHTML = '<p class="ranking-empty">No hay victorias registradas aun.</p>';
        return;
    }
    
    let html = '';
    ranking.forEach((player, index) => {
        let medal = '';
        let itemClass = 'ranking-item';
        
        if (index === 0) {
            medal = '🥇';
            itemClass += ' gold';
        } else if (index === 1) {
            medal = '🥈';
            itemClass += ' silver';
        } else if (index === 2) {
            medal = '🥉';
            itemClass += ' bronze';
        } else {
            medal = (index + 1) + '.';
        }
        
        const winsText = player.wins === 1 ? '1 Victoria' : player.wins + ' Victorias';
        
        html += '<div class="' + itemClass + '">';
        html += '<span class="ranking-position">' + medal + '</span>';
        html += '<span class="ranking-name">' + escapeHtml(player.name) + '</span>';
        html += '<span class="ranking-wins">' + winsText + '</span>';
        html += '</div>';
    });
    
    rankingList.innerHTML = html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function openRankingModal() {
    if (rankingModal) {
        rankingModal.classList.remove('hidden');
        rankingList.innerHTML = '<p class="ranking-loading">Cargando ranking...</p>';
        
        if (socket && socket.connected) {
            socket.emit('get_ranking');
        } else {
            const tempSocket = io(window.location.origin, {
                transports: ['websocket'],
                upgrade: false,
                timeout: 5000
            });
            
            tempSocket.on('connect', () => {
                tempSocket.emit('get_ranking');
            });
            
            tempSocket.on('ranking_data', (data) => {
                renderRanking(data.ranking);
                tempSocket.disconnect();
            });
            
            tempSocket.on('connect_error', () => {
                rankingList.innerHTML = '<p class="ranking-empty">Error al cargar el ranking.</p>';
            });
        }
    }
}

function closeRankingModal() {
    if (rankingModal) {
        rankingModal.classList.add('hidden');
    }
}

if (rankingBtn) {
    rankingBtn.addEventListener('click', openRankingModal);
}

if (closeRankingBtn) {
    closeRankingBtn.addEventListener('click', closeRankingModal);
}

if (rankingModal) {
    rankingModal.addEventListener('click', (event) => {
        if (event.target === rankingModal) {
            closeRankingModal();
        }
    });
}

// Zoom functionality with buttons
function zoomIn() {
    cellSize = Math.min(cellSize + ZOOM_STEP, MAX_CELL_SIZE);
    updateCanvasSize();
    render();
}

function zoomOut() {
    cellSize = Math.max(cellSize - ZOOM_STEP, MIN_CELL_SIZE);
    updateCanvasSize();
    render();
}

// Zoom button event listeners
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');

if (zoomInBtn) {
    zoomInBtn.addEventListener('click', zoomIn);
}

if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', zoomOut);
}

// ============================================
// MAGIC LINK: Auto-join via URL parameters
// Usage: gridlords.onrender.com/?room=ABCD&user=Dorian
// ============================================
(function initMagicLink() {
    const urlParams = new URLSearchParams(window.location.search);
    const magicRoom = urlParams.get('room');
    const magicUser = urlParams.get('user');
    
    if (magicRoom && magicUser) {
        console.log('🔗 Magic Link detected - Room:', magicRoom, 'User:', magicUser);
        
        // Store magic link data for use after class selection
        window.magicLinkData = {
            room: magicRoom.toUpperCase(),
            user: magicUser
        };
        
        // Pre-fill the form fields
        if (nicknameInput) {
            nicknameInput.value = magicUser;
        }
        if (roomCodeInput) {
            roomCodeInput.value = magicRoom.toUpperCase();
        }
        
        // Set pending action to join
        playerNickname = magicUser;
        pendingAction = 'join';
        
        // Hide login overlay and show class selection directly
        if (loginOverlay) {
            loginOverlay.classList.add('hidden');
        }
        if (classModal) {
            classModal.classList.remove('hidden');
        }
        
        console.log('🔗 Magic Link: Mostrando selección de clase. Selecciona tu clase para unirte automáticamente a la sala', magicRoom.toUpperCase());
    }
})();
