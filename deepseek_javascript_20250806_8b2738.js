// Gamepad state
let gamepad = null;
let isDrumMode = true;
let isRecording = false;
let recordingStartTime = 0;
let loopEvents = [];
let currentChord = '';
let currentDetune = 0;

// Button state tracking for debouncing
let lastButtonStates = {};
let visualTimeouts = {};

// Audio elements
let drumPlayers;
let synth;
let loopPart;
let recorder;
let recordedBuffer;

// Initialize audio context on user interaction
document.getElementById('start-audio').addEventListener('click', async () => {
    try {
        await Tone.start();
        console.log('Audio context started');
        await initAudio();
        document.getElementById('start-audio').disabled = true;
        
        // Start gamepad polling after audio is initialized
        startGamepadPolling();
        
        // Initialize mode display
        updateModeDisplay();
        
    } catch (error) {
        console.error('Error starting audio:', error);
        document.getElementById('status').textContent = 'Error starting audio. Please try again.';
    }
});

// Download loop button
document.getElementById('download-loop').addEventListener('click', () => {
    if (loopEvents.length > 0) {
        const loopData = {
            events: loopEvents,
            mode: isDrumMode ? 'drum' : 'chord',
            timestamp: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(loopData, null, 2)], {type: 'application/json'});
        saveAs(blob, `loop-${new Date().getTime()}.json`);
    }
});

// Debug toggle
let debugMode = false;
document.getElementById('debug-toggle').addEventListener('click', () => {
    debugMode = !debugMode;
    const debugDiv = document.getElementById('debug-info');
    debugDiv.style.display = debugMode ? 'block' : 'none';
});

async function initAudio() {
    try {
        document.getElementById('status').textContent = 'Loading audio samples...';
        
        // Drum samples
        drumPlayers = new Tone.Players({
            kick: "https://tonejs.github.io/audio/drum-samples/lo-fi/kick.mp3",
            snare: "https://tonejs.github.io/audio/drum-samples/lo-fi/snare.mp3"
        }).toDestination();
        
        // Wait for drum samples to load
        await Tone.loaded();
        
        // Synth for chord mode
        synth = new Tone.PolySynth(Tone.Synth, {
            oscillator: {
                type: "sawtooth"
            },
            envelope: {
                attack: 0.02,
                decay: 0.1,
                sustain: 0.3,
                release: 0.5
            }
        }).toDestination();
        
        // Create a recorder
        recorder = new Tone.Recorder();
        synth.connect(recorder);
        drumPlayers.connect(recorder);
        
        // Initialize loop part (empty at first)
        loopPart = new Tone.Part((time, event) => {
            if (event.type === 'drum') {
                if (drumPlayers.loaded) {
                    drumPlayers.player(event.sound).start(time);
                }
            } else if (event.type === 'chord') {
                synth.triggerAttackRelease(event.notes, event.duration, time, event.velocity);
            }
        }, []).start(0);
        loopPart.loop = true;
        loopPart.loopEnd = '4m';
        
        // Update status
        updateGamepadStatus();
        console.log('Audio initialized successfully');
        
    } catch (error) {
        console.error('Error initializing audio:', error);
        document.getElementById('status').textContent = 'Error loading audio. Please try again.';
    }
}

// Gamepad polling
let isPolling = false;

function startGamepadPolling() {
    if (!isPolling) {
        isPolling = true;
        checkForGamepad();
    }
}

function checkForGamepad() {
    if (!isPolling) return;
    
    const gamepads = navigator.getGamepads();
    let foundGamepad = null;
    
    // Check all gamepad slots
    for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
            foundGamepad = gamepads[i];
            break;
        }
    }
    
    if (foundGamepad && !gamepad) {
        // New gamepad detected
        gamepad = foundGamepad;
        document.getElementById('status').textContent = `Gamepad connected: ${gamepad.id}`;
        console.log('Gamepad detected:', gamepad.id);
    } else if (!foundGamepad && gamepad) {
        // Gamepad disconnected
        gamepad = null;
        document.getElementById('status').textContent = 'Gamepad disconnected. Please reconnect and press any button.';
        console.log('Gamepad disconnected');
    } else if (foundGamepad) {
        // Update gamepad reference (important for getting current state)
        gamepad = foundGamepad;
    }
    
    if (gamepad) {
        pollGamepad();
    } else {
        // Continue checking for gamepad if none found
        requestAnimationFrame(checkForGamepad);
    }
}

function pollGamepad() {
    if (!gamepad || !isPolling) {
        requestAnimationFrame(checkForGamepad);
        return;
    }
    
    // Update debug info if enabled
    if (debugMode) {
        updateDebugInfo();
    }
    
    checkModeSwitch();
    
    if (isDrumMode) {
        handleDrumMode();
    } else {
        handleChordMode();
    }
    
    handlePitchModulation();
    handleLoopRecording();
    
    requestAnimationFrame(checkForGamepad);
}

function updateDebugInfo() {
    if (!gamepad) return;
    
    let debugText = `<strong>Gamepad: ${gamepad.id}</strong><br>`;
    debugText += `Connected: ${gamepad.connected}<br>`;
    debugText += `Timestamp: ${gamepad.timestamp}<br><br>`;
    
    debugText += `<strong>Buttons:</strong><br>`;
    for (let i = 0; i < gamepad.buttons.length; i++) {
        const button = gamepad.buttons[i];
        if (button.pressed || button.value > 0) {
            debugText += `Button ${i}: pressed=${button.pressed}, value=${button.value.toFixed(3)}<br>`;
        }
    }
    
    debugText += `<br><strong>Axes:</strong><br>`;
    for (let i = 0; i < gamepad.axes.length; i++) {
        const axis = gamepad.axes[i];
        if (Math.abs(axis) > 0.1) {
            debugText += `Axis ${i}: ${axis.toFixed(3)}<br>`;
        }
    }
    
    document.getElementById('debug-content').innerHTML = debugText;
}

function checkModeSwitch() {
    // Start button (button 9) toggles mode
    if (gamepad.buttons[9] && gamepad.buttons[9].pressed && !lastButtonStates[9]) {
        isDrumMode = !isDrumMode;
        document.getElementById('mode-display').textContent = `Mode: ${isDrumMode ? 'Drum' : 'Chord'}`;
        document.getElementById('chord-display').textContent = '';
        
        // Update UI visibility
        updateModeDisplay();
    }
    lastButtonStates[9] = gamepad.buttons[9] && gamepad.buttons[9].pressed;
}

function updateModeDisplay() {
    const drumGuide = document.getElementById('drum-guide');
    const chordGuide = document.getElementById('chord-guide');
    
    if (isDrumMode) {
        drumGuide.style.display = 'block';
        chordGuide.style.display = 'none';
    } else {
        drumGuide.style.display = 'none';
        chordGuide.style.display = 'block';
    }
}

function handleDrumMode() {
    // Left bumper (button 4) - kick
    if (gamepad.buttons[4] && gamepad.buttons[4].pressed && !lastButtonStates[4]) {
        if (drumPlayers && drumPlayers.loaded) {
            drumPlayers.player('kick').start();
            recordEvent('drum', { sound: 'kick' });
            showVisualFeedback('kick-drum', 200);
        }
    }
    lastButtonStates[4] = gamepad.buttons[4] && gamepad.buttons[4].pressed;
    
    // Right bumper (button 5) - snare
    if (gamepad.buttons[5] && gamepad.buttons[5].pressed && !lastButtonStates[5]) {
        if (drumPlayers && drumPlayers.loaded) {
            drumPlayers.player('snare').start();
            recordEvent('drum', { sound: 'snare' });
            showVisualFeedback('snare-drum', 200);
        }
    }
    lastButtonStates[5] = gamepad.buttons[5] && gamepad.buttons[5].pressed;
}

function showVisualFeedback(elementId, duration = 150) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    // Clear existing timeout
    if (visualTimeouts[elementId]) {
        clearTimeout(visualTimeouts[elementId]);
    }
    
    // Add active class
    element.classList.add('active');
    
    // Remove active class after duration
    visualTimeouts[elementId] = setTimeout(() => {
        element.classList.remove('active');
        delete visualTimeouts[elementId];
    }, duration);
}

function handleChordMode() {
    // Check each chord button for presses
    const chordButtons = [
        { button: 13, elementId: 'chord-I', root: 'C', function: 'I' },    // D-Pad Down
        { button: 14, elementId: 'chord-ii', root: 'D', function: 'ii' },  // D-Pad Left
        { button: 12, elementId: 'chord-iii', root: 'E', function: 'iii' }, // D-Pad Up
        { button: 15, elementId: 'chord-IV', root: 'F', function: 'IV' },   // D-Pad Right
        { button: 0, elementId: 'chord-V', root: 'G', function: 'V' },      // A button
        { button: 1, elementId: 'chord-vi', root: 'A', function: 'vi' },    // B button
        { button: 2, elementId: 'chord-vii', root: 'B', function: 'vii°' }  // X button
    ];
    
    // Determine chord quality based on bumpers and triggers
    let chordQuality = 'maj'; // Default to major
    let chordName = 'Major';
    
    if (gamepad.buttons[4] && gamepad.buttons[4].pressed) { // Left bumper - Major 7
        chordQuality = 'maj7';
        chordName = 'Major 7';
    } else if (gamepad.buttons[5] && gamepad.buttons[5].pressed) { // Right bumper - Minor 7
        chordQuality = 'min7';
        chordName = 'Minor 7';
    } else if (gamepad.buttons[6] && gamepad.buttons[6].value > 0.5) { // Left trigger - Suspended
        chordQuality = 'sus4';
        chordName = 'Suspended';
    } else if (gamepad.buttons[7] && gamepad.buttons[7].value > 0.5) { // Right trigger - Diminished
        chordQuality = 'dim';
        chordName = 'Diminished';
    }
    
    // Check each chord button
    for (const chord of chordButtons) {
        if (gamepad.buttons[chord.button] && gamepad.buttons[chord.button].pressed && !lastButtonStates[chord.button]) {
            if (synth) {
                const chordNotes = getChordNotes(chord.root, chordQuality);
                synth.triggerAttackRelease(chordNotes, '8n');
                
                currentChord = `${chord.function} (${chordName})`;
                document.getElementById('chord-display').textContent = currentChord;
                
                showVisualFeedback(chord.elementId, 300);
                
                recordEvent('chord', {
                    notes: chordNotes,
                    duration: '8n',
                    velocity: 0.8,
                    chord: currentChord
                });
            }
        }
        lastButtonStates[chord.button] = gamepad.buttons[chord.button] && gamepad.buttons[chord.button].pressed;
    }
}

function getChordNotes(root, quality) {
    const notes = {
        'maj': [0, 4, 7],
        'min': [0, 3, 7],
        'maj7': [0, 4, 7, 11],
        'min7': [0, 3, 7, 10],
        'sus4': [0, 5, 7],
        'dim': [0, 3, 6]
    };
    
    const intervals = notes[quality] || notes['maj'];
    const rootNote = Tone.Frequency(root + "3").toMidi();
    
    return intervals.map(interval => {
        return Tone.Midi(rootNote + interval).toNote();
    });
}

function handlePitchModulation() {
    // Right stick X-axis (axes[2]) for pitch bend/detune
    if (gamepad.axes[2] !== undefined) {
        const detune = gamepad.axes[2] * 100; // Map to ±100 cents
        synth.set({ detune: detune });
        currentDetune = Math.round(detune);
        
        if (!isDrumMode) {
            document.getElementById('chord-display').textContent = 
                `${currentChord} ${currentDetune > 0 ? '+' : ''}${currentDetune} cents`;
        }
    }
    
    // Right stick Y-axis (axes[3]) for filter cutoff (optional)
    if (gamepad.axes[3] !== undefined) {
        const cutoff = 100 + (gamepad.axes[3] * 1000); // Map to 100-1100 Hz
        synth.set({ filterEnvelope: { baseFrequency: cutoff } });
    }
}

function handleLoopRecording() {
    // Back button (button 8) toggles recording
    if (gamepad.buttons[8] && gamepad.buttons[8].pressed && !lastButtonStates[8]) {
        if (!isRecording) {
            startRecording();
        } else {
            stopRecording();
        }
    }
    lastButtonStates[8] = gamepad.buttons[8] && gamepad.buttons[8].pressed;
}

function startRecording() {
    isRecording = true;
    recordingStartTime = Tone.now();
    loopEvents = [];
    document.getElementById('recording-status').textContent = 'Recording...';
    document.getElementById('download-loop').disabled = true;
    
    // Start the recorder
    recorder.start();
}

async function stopRecording() {
    isRecording = false;
    document.getElementById('recording-status').textContent = 'Recording stopped';
    
    // Stop the recorder and get the buffer
    recordedBuffer = await recorder.stop();
    
    // Create a loop from the recorded events
    if (loopEvents.length > 0) {
        loopPart.clear();
        loopPart.add(loopEvents);
        loopPart.start(0);
        document.getElementById('download-loop').disabled = false;
    }
}

function recordEvent(type, data) {
    if (!isRecording) return;
    
    const eventTime = Tone.now() - recordingStartTime;
    loopEvents.push({
        time: eventTime,
        type: type,
        ...data
    });
}

// Gamepad connection handling
window.addEventListener("gamepadconnected", (e) => {
    console.log('Gamepadconnected event fired:', e.gamepad.id);
    // The polling loop will pick this up automatically
});

window.addEventListener("gamepaddisconnected", (e) => {
    console.log('Gamepaddisconnected event fired:', e.gamepad.id);
    // The polling loop will handle disconnection
});

// Add manual detection button and improved status
function updateGamepadStatus() {
    const gamepads = navigator.getGamepads();
    let connectedCount = 0;
    let gamepadInfo = [];
    
    for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
            connectedCount++;
            gamepadInfo.push(`Slot ${i}: ${gamepads[i].id}`);
        }
    }
    
    if (connectedCount === 0) {
        document.getElementById('status').innerHTML = `
            No gamepads detected. <br>
            <small>Make sure your controller is connected and press any button on it.</small><br>
            <button onclick="startGamepadPolling()" style="margin-top: 10px; padding: 5px 10px; font-size: 14px;">Check for Controllers</button>
        `;
    } else {
        document.getElementById('status').innerHTML = `
            ${connectedCount} gamepad(s) detected:<br>
            <small>${gamepadInfo.join('<br>')}</small>
        `;
    }
}

// Initialize gamepad status check
document.addEventListener('DOMContentLoaded', () => {
    // Check for gamepad API support
    if (!navigator.getGamepads) {
        document.getElementById('status').innerHTML = `
            <span style="color: red;">❌ Gamepad API not supported in this browser.</span><br>
            <small>Please use Chrome, Firefox, or Edge for gamepad support.</small>
        `;
        return;
    }
    
    // Check for HTTPS (required for some gamepad features)
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        document.getElementById('status').innerHTML = `
            <span style="color: orange;">⚠️ HTTPS recommended for better gamepad support.</span><br>
            <small>Some browsers require HTTPS for full gamepad functionality.</small><br>
            <button onclick="startGamepadPolling()" style="margin-top: 10px; padding: 5px 10px; font-size: 14px;">Try Anyway</button>
        `;
    }
    
    updateGamepadStatus();
    
    // Check periodically for gamepads even before audio is started
    setInterval(() => {
        if (!isPolling) {
            updateGamepadStatus();
        }
    }, 2000);
});