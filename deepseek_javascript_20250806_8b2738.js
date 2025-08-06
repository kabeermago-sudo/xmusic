// Gamepad state
let gamepad = null;
let isDrumMode = true;
let isRecording = false;
let recordingStartTime = 0;
let loopEvents = [];
let currentChord = '';
let currentDetune = 0;

// Audio elements
let drumPlayers;
let synth;
let loopPart;
let recorder;
let recordedBuffer;

// Initialize audio context on user interaction
document.getElementById('start-audio').addEventListener('click', async () => {
    await Tone.start();
    console.log('Audio is ready');
    initAudio();
    document.getElementById('start-audio').disabled = true;
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

function checkModeSwitch() {
    // Start button (button 9) toggles mode
    if (gamepad.buttons[9].pressed) {
        isDrumMode = !isDrumMode;
        document.getElementById('mode-display').textContent = `Mode: ${isDrumMode ? 'Drum' : 'Chord'}`;
        document.getElementById('chord-display').textContent = '';
        // Debounce
        setTimeout(() => {}, 200);
    }
}

function handleDrumMode() {
    // Left bumper (button 4) - kick
    if (gamepad.buttons[4].pressed) {
        drumPlayers.player('kick').start();
        recordEvent('drum', { sound: 'kick' });
    }
    
    // Right bumper (button 5) - snare
    if (gamepad.buttons[5].pressed) {
        drumPlayers.player('snare').start();
        recordEvent('drum', { sound: 'snare' });
    }
}

function handleChordMode() {
    // Determine chord quality based on bumpers and triggers
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
    
    // Determine root note based on D-Pad and A/B/X/Y buttons
    let rootNote = '';
    let chordFunction = '';
    
    if (gamepad.buttons[13].pressed) { // D-Pad Down - I
        rootNote = 'C';
        chordFunction = 'I';
    } else if (gamepad.buttons[14].pressed) { // D-Pad Left - ii
        rootNote = 'D';
        chordFunction = 'ii';
    } else if (gamepad.buttons[12].pressed) { // D-Pad Up - iii
        rootNote = 'E';
        chordFunction = 'iii';
    } else if (gamepad.buttons[15].pressed) { // D-Pad Right - IV
        rootNote = 'F';
        chordFunction = 'IV';
    } else if (gamepad.buttons[0].pressed) { // A - V
        rootNote = 'G';
        chordFunction = 'V';
    } else if (gamepad.buttons[1].pressed) { // B - vi
        rootNote = 'A';
        chordFunction = 'vi';
    } else if (gamepad.buttons[2].pressed) { // X - vii°
        rootNote = 'B';
        chordFunction = 'vii°';
    }
    
    if (rootNote) {
        const chordNotes = getChordNotes(rootNote, chordQuality);
        synth.triggerAttackRelease(chordNotes, '8n');
        
        currentChord = `${chordFunction} (${chordName})`;
        document.getElementById('chord-display').textContent = currentChord;
        
        recordEvent('chord', {
            notes: chordNotes,
            duration: '8n',
            velocity: 0.8,
            chord: currentChord
        });
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
    if (gamepad.buttons[8].pressed) {
        if (!isRecording) {
            startRecording();
        } else {
            stopRecording();
        }
        // Debounce
        setTimeout(() => {}, 200);
    }
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
    gamepad = e.gamepad;
    document.getElementById('status').textContent = `Gamepad connected: ${gamepad.id}`;
    requestAnimationFrame(pollGamepad);
});

window.addEventListener("gamepaddisconnected", (e) => {
    document.getElementById('status').textContent = 'Gamepad disconnected. Please reconnect.';
    gamepad = null;
});