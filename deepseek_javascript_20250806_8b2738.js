// Gamepad state
let gamepad = null;
let isDrumMode = true;
let isRecording = false;
let recordingStartTime = 0;
let loopEvents = [];
let currentChord = '';
let currentDetune = 0;
let audioInitialized = false;

// Button state tracking for debouncing
let buttonStates = {};
let lastButtonStates = {};

// Audio elements
let drumPlayers;
let synth;
let loopPart;
let recorder;
let recordedBuffer;

// Visual feedback elements
let currentInstrumentDisplay = null;

// Initialize audio context on user interaction
document.getElementById('start-audio').addEventListener('click', async () => {
    try {
        await Tone.start();
        console.log('Audio is ready');
        initAudio();
        audioInitialized = true;
        document.getElementById('start-audio').disabled = true;
        document.getElementById('start-audio').textContent = 'Audio Ready ✓';
        document.getElementById('start-audio').style.backgroundColor = '#28a745';
        
        // Show ready status
        document.getElementById('status').innerHTML = `
            <div style="color: #28a745; font-weight: bold;">✓ Controller detected and audio ready!</div>
            <div style="font-size: 14px; margin-top: 5px;">Press controller buttons to play instruments</div>
        `;
    } catch (error) {
        console.error('Audio initialization failed:', error);
        document.getElementById('status').innerHTML = `
            <div style="color: #dc3545; font-weight: bold;">⚠ Audio initialization failed</div>
            <div style="font-size: 14px;">Please try again</div>
        `;
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

function initAudio() {
    // Drum samples
    drumPlayers = new Tone.Players({
        kick: "https://tonejs.github.io/audio/drum-samples/lo-fi/kick.mp3",
        snare: "https://tonejs.github.io/audio/drum-samples/lo-fi/snare.mp3"
    }).toDestination();
    
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
            drumPlayers.player(event.sound).start(time);
        } else if (event.type === 'chord') {
            synth.triggerAttackRelease(event.notes, event.duration, time, event.velocity);
        }
    }, []).start(0);
    loopPart.loop = true;
    loopPart.loopEnd = '4m';
}

// Gamepad polling
function pollGamepad() {
    const gamepads = navigator.getGamepads();
    if (gamepads[0]) {
        gamepad = gamepads[0];
    }
    
    if (!gamepad) return;
    
    // Update button states for debouncing
    lastButtonStates = {...buttonStates};
    buttonStates = {};
    for (let i = 0; i < gamepad.buttons.length; i++) {
        buttonStates[i] = gamepad.buttons[i].pressed;
    }
    
    // Only process if audio is initialized
    if (!audioInitialized) {
        requestAnimationFrame(pollGamepad);
        return;
    }
    
    checkModeSwitch();
    
    if (isDrumMode) {
        handleDrumMode();
    } else {
        handleChordMode();
    }
    
    handlePitchModulation();
    handleLoopRecording();
    
    requestAnimationFrame(pollGamepad);
}

// Helper function to check if button was just pressed (not held)
function wasButtonJustPressed(buttonIndex) {
    return buttonStates[buttonIndex] && !lastButtonStates[buttonIndex];
}

function checkModeSwitch() {
    // Start button (button 9) toggles mode
    if (wasButtonJustPressed(9)) {
        isDrumMode = !isDrumMode;
        const modeText = isDrumMode ? 'Drum Kit' : 'Chord Synth';
        const modeIndicator = isDrumMode ? '<span class="mode-indicator drum-mode"></span>' : '<span class="mode-indicator chord-mode"></span>';
        
        document.getElementById('mode-display').innerHTML = `Mode: ${modeText} ${modeIndicator}`;
        document.getElementById('mode-display').style.backgroundColor = isDrumMode ? '#ff6b6b' : '#4ecdc4';
        document.getElementById('chord-display').textContent = isDrumMode ? 'Press buttons to play drums!' : 'Press buttons to play chords!';
        
        // Show mode change feedback
        showInstrumentFeedback(`🎵 Switched to ${modeText} mode`, 1500);
    }
}

function handleDrumMode() {
    // Left bumper (button 4) - kick
    if (wasButtonJustPressed(4)) {
        drumPlayers.player('kick').start();
        recordEvent('drum', { sound: 'kick' });
        showInstrumentFeedback('🥁 KICK', 500);
    }
    
    // Right bumper (button 5) - snare
    if (wasButtonJustPressed(5)) {
        drumPlayers.player('snare').start();
        recordEvent('drum', { sound: 'snare' });
        showInstrumentFeedback('🥁 SNARE', 500);
    }
    
    // Add more drum sounds for better experience
    // A button (button 0) - hi-hat
    if (wasButtonJustPressed(0)) {
        // Create a simple hi-hat sound using synth
        const hihat = new Tone.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.001, decay: 0.1, sustain: 0 }
        }).toDestination();
        hihat.triggerAttackRelease('8n');
        showInstrumentFeedback('🎵 HI-HAT', 500);
        recordEvent('drum', { sound: 'hihat' });
    }
    
    // B button (button 1) - crash
    if (wasButtonJustPressed(1)) {
        const crash = new Tone.NoiseSynth({
            noise: { type: 'pink' },
            envelope: { attack: 0.01, decay: 0.5, sustain: 0.1, release: 1 }
        }).toDestination();
        crash.triggerAttackRelease('2n');
        showInstrumentFeedback('💥 CRASH', 800);
        recordEvent('drum', { sound: 'crash' });
    }
}

function handleChordMode() {
    // Check for any button press to determine chord
    let buttonPressed = false;
    let rootNote = '';
    let chordFunction = '';
    
    // Check D-Pad and A/B/X/Y buttons for root notes
    if (wasButtonJustPressed(13)) { // D-Pad Down - I
        rootNote = 'C'; chordFunction = 'I'; buttonPressed = true;
    } else if (wasButtonJustPressed(14)) { // D-Pad Left - ii
        rootNote = 'D'; chordFunction = 'ii'; buttonPressed = true;
    } else if (wasButtonJustPressed(12)) { // D-Pad Up - iii
        rootNote = 'E'; chordFunction = 'iii'; buttonPressed = true;
    } else if (wasButtonJustPressed(15)) { // D-Pad Right - IV
        rootNote = 'F'; chordFunction = 'IV'; buttonPressed = true;
    } else if (wasButtonJustPressed(0)) { // A - V
        rootNote = 'G'; chordFunction = 'V'; buttonPressed = true;
    } else if (wasButtonJustPressed(1)) { // B - vi
        rootNote = 'A'; chordFunction = 'vi'; buttonPressed = true;
    } else if (wasButtonJustPressed(2)) { // X - vii°
        rootNote = 'B'; chordFunction = 'vii°'; buttonPressed = true;
    } else if (wasButtonJustPressed(3)) { // Y - Additional chord
        rootNote = 'F#'; chordFunction = 'bVII'; buttonPressed = true;
    }
    
    if (!buttonPressed) return;
    
    // Determine chord quality based on bumpers and triggers (current state)
    let chordQuality = '';
    let chordName = '';
    
    if (gamepad.buttons[4].pressed) { // Left bumper - Major 7
        chordQuality = 'maj7';
        chordName = 'Major 7';
    } else if (gamepad.buttons[5].pressed) { // Right bumper - Minor 7
        chordQuality = 'min7';
        chordName = 'Minor 7';
    } else if (gamepad.buttons[6].value > 0.5) { // Left trigger - Suspended
        chordQuality = 'sus4';
        chordName = 'Suspended';
    } else if (gamepad.buttons[7].value > 0.5) { // Right trigger - Diminished
        chordQuality = 'dim';
        chordName = 'Diminished';
    } else {
        chordQuality = 'maj'; // Default to major
        chordName = 'Major';
    }
    
    const chordNotes = getChordNotes(rootNote, chordQuality);
    synth.triggerAttackRelease(chordNotes, '4n');
    
    currentChord = `${rootNote} ${chordName} (${chordFunction})`;
    document.getElementById('chord-display').textContent = currentChord;
    
    // Show visual feedback
    showInstrumentFeedback(`🎹 ${currentChord}`, 1000);
    
    recordEvent('chord', {
        notes: chordNotes,
        duration: '4n',
        velocity: 0.8,
        chord: currentChord
    });
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
    if (wasButtonJustPressed(8)) {
        if (!isRecording) {
            startRecording();
        } else {
            stopRecording();
        }
    }
}

// Visual feedback function
function showInstrumentFeedback(text, duration = 1000) {
    // Remove existing feedback
    if (currentInstrumentDisplay) {
        currentInstrumentDisplay.remove();
    }
    
    // Create new feedback element
    currentInstrumentDisplay = document.createElement('div');
    currentInstrumentDisplay.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 20px 40px;
        border-radius: 15px;
        font-size: 28px;
        font-weight: bold;
        text-align: center;
        z-index: 1000;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        animation: feedbackPulse 0.3s ease-out;
        pointer-events: none;
    `;
    
    // Add CSS animation if not already added
    if (!document.getElementById('feedback-styles')) {
        const style = document.createElement('style');
        style.id = 'feedback-styles';
        style.textContent = `
            @keyframes feedbackPulse {
                0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
                50% { transform: translate(-50%, -50%) scale(1.1); opacity: 1; }
                100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            }
            @keyframes feedbackFadeOut {
                0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                100% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
            }
        `;
        document.head.appendChild(style);
    }
    
    currentInstrumentDisplay.textContent = text;
    document.body.appendChild(currentInstrumentDisplay);
    
    // Remove after duration
    setTimeout(() => {
        if (currentInstrumentDisplay) {
            currentInstrumentDisplay.style.animation = 'feedbackFadeOut 0.3s ease-in forwards';
            setTimeout(() => {
                if (currentInstrumentDisplay) {
                    currentInstrumentDisplay.remove();
                    currentInstrumentDisplay = null;
                }
            }, 300);
        }
    }, duration);
}

function startRecording() {
    isRecording = true;
    recordingStartTime = Tone.now();
    loopEvents = [];
    document.getElementById('recording-status').innerHTML = `
        <div style="color: #ff4757; font-weight: bold;">🔴 Recording...</div>
        <div style="font-size: 14px;">Press BACK again to stop</div>
    `;
    document.getElementById('download-loop').disabled = true;
    
    // Show recording feedback
    showInstrumentFeedback('🔴 Recording Started', 1500);
    
    // Start the recorder
    recorder.start();
}

async function stopRecording() {
    isRecording = false;
    
    // Stop the recorder and get the buffer
    recordedBuffer = await recorder.stop();
    
    // Create a loop from the recorded events
    if (loopEvents.length > 0) {
        loopPart.clear();
        loopPart.add(loopEvents);
        loopPart.start(0);
        document.getElementById('download-loop').disabled = false;
        document.getElementById('recording-status').innerHTML = `
            <div style="color: #28a745; font-weight: bold;">✅ Recording saved!</div>
            <div style="font-size: 14px;">${loopEvents.length} events recorded</div>
        `;
        showInstrumentFeedback(`✅ Recording Saved (${loopEvents.length} events)`, 2000);
    } else {
        document.getElementById('recording-status').innerHTML = `
            <div style="color: #ffa500; font-weight: bold;">⚠ No events recorded</div>
            <div style="font-size: 14px;">Play some instruments while recording</div>
        `;
        showInstrumentFeedback('⚠ No events recorded', 1500);
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
    gamepad = e.gamepad;
    document.getElementById('status').innerHTML = `
        <div style="color: #28a745; font-weight: bold;">🎮 Controller connected!</div>
        <div style="font-size: 14px; margin-top: 5px;">${gamepad.id}</div>
        <div style="font-size: 14px; margin-top: 5px;">Click "Start Audio" to begin playing</div>
    `;
    showInstrumentFeedback('🎮 Controller Connected!', 2000);
    requestAnimationFrame(pollGamepad);
});

window.addEventListener("gamepaddisconnected", (e) => {
    document.getElementById('status').innerHTML = `
        <div style="color: #ff4757; font-weight: bold;">⚠ Controller disconnected</div>
        <div style="font-size: 14px; margin-top: 5px;">Please reconnect your controller</div>
    `;
    showInstrumentFeedback('⚠ Controller Disconnected', 2000);
    gamepad = null;
});