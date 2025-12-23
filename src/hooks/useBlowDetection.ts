import { useEffect, useRef, useState } from 'react';

interface BlowDetectionOptions {
    onBlow: () => void;
    enabled: boolean;
    sensitivity?: number;
}

export function useBlowDetection({ onBlow, enabled, sensitivity = 0.3 }: BlowDetectionOptions) {
    const [hasPermission, setHasPermission] = useState<boolean | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const microphoneRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    useEffect(() => {
        if (!enabled) {
            // Clean up when disabled
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            if (microphoneRef.current) {
                microphoneRef.current.disconnect();
            }
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
            return;
        }

        async function setupMicrophone() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                setHasPermission(true);

                const audioContext = new AudioContext();
                const analyser = audioContext.createAnalyser();
                const microphone = audioContext.createMediaStreamSource(stream);

                analyser.fftSize = 512;
                analyser.smoothingTimeConstant = 0.8;
                microphone.connect(analyser);

                audioContextRef.current = audioContext;
                analyserRef.current = analyser;
                microphoneRef.current = microphone;

                detectBlow();
            } catch (error) {
                console.error('Microphone access denied:', error);
                setHasPermission(false);
            }
        }

        function detectBlow() {
            if (!analyserRef.current) return;

            const analyser = analyserRef.current;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            let lastBlowTime = 0;
            let previousVolume = 0;
            const BLOW_COOLDOWN = 1500; // 1.5 second cooldown between blows

            function analyze() {
                if (!analyser) return;

                analyser.getByteFrequencyData(dataArray);

                // Blow sounds are characterized by:
                // 1. Broadband noise (energy spread across frequencies)
                // 2. Low-frequency emphasis
                // 3. Lack of harmonic peaks (unlike speech/music)
                // 4. Sudden onset

                // Divide frequency spectrum into bands
                const lowBand = Math.floor(bufferLength * 0.15);    // 0-15% (low freq)
                const midBand = Math.floor(bufferLength * 0.35);    // 15-35% (mid freq)
                const highBand = Math.floor(bufferLength * 0.55);   // 35-55% (high freq)

                let lowSum = 0, midSum = 0, highSum = 0;
                let peakCount = 0;
                let totalEnergy = 0;

                for (let i = 0; i < bufferLength; i++) {
                    totalEnergy += dataArray[i];

                    if (i < lowBand) {
                        lowSum += dataArray[i];
                    } else if (i < midBand) {
                        midSum += dataArray[i];
                    } else if (i < highBand) {
                        highSum += dataArray[i];
                    }

                    // Count sharp peaks (indicates harmonic content - speech/music)
                    if (i > 0 && i < bufferLength - 1) {
                        if (dataArray[i] > dataArray[i - 1] + 30 && dataArray[i] > dataArray[i + 1] + 30) {
                            peakCount++;
                        }
                    }
                }

                const lowAvg = lowSum / lowBand;
                const midAvg = midSum / (midBand - lowBand);
                const highAvg = highSum / (highBand - midBand);
                const avgVolume = totalEnergy / bufferLength;

                // Calculate suddenness (rate of change)
                const volumeChange = avgVolume - previousVolume;
                previousVolume = avgVolume;

                // Blow detection criteria:
                // 1. Strong low frequency (blow sounds are bassy)
                // 2. Broadband energy (not too much variation between bands)
                // 3. Few harmonic peaks (less than 5 sharp peaks = not speech/music)
                // 4. Sufficient overall volume
                // 5. Sudden onset (volume increased rapidly)

                const threshold = 255 * sensitivity;
                const isLowFreqStrong = lowAvg > threshold * 1.2;
                const isBroadband = (lowAvg + midAvg + highAvg) / 3 > threshold * 0.8;
                const isNotHarmonic = peakCount < 5;
                const hasVolume = avgVolume > threshold * 0.7;
                const hasSuddenOnset = volumeChange > 15;

                const isBlowing = isLowFreqStrong && isBroadband && isNotHarmonic && hasVolume && hasSuddenOnset;

                const now = Date.now();
                if (isBlowing && now - lastBlowTime > BLOW_COOLDOWN) {
                    console.log('Blow detected!', {
                        lowAvg: lowAvg.toFixed(1),
                        midAvg: midAvg.toFixed(1),
                        highAvg: highAvg.toFixed(1),
                        avgVolume: avgVolume.toFixed(1),
                        peakCount,
                        volumeChange: volumeChange.toFixed(1),
                        threshold: threshold.toFixed(1)
                    });
                    lastBlowTime = now;
                    onBlow();
                }

                animationFrameRef.current = requestAnimationFrame(analyze);
            }

            analyze();
        }

        setupMicrophone();

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            if (microphoneRef.current) {
                microphoneRef.current.disconnect();
            }
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        };
    }, [enabled, onBlow, sensitivity]);

    return { hasPermission };
}
