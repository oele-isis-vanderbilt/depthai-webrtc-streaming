export class WebRTC {
    private config: RTCConfiguration = {
        sdpSemantics: 'unified-plan',
    };

    private pc: RTCPeerConnection;
    private mediaRecorder: MediaRecorder | null;
    private recordedChunks: Blob[];

    constructor() {
        this.pc = new RTCPeerConnection(this.config);
        this.mediaRecorder = null;
        this.recordedChunks = [];

        this.pc.addEventListener('icegatheringstatechange', () => {
            console.log("[PC] ICE Gathering state:", this.pc.iceGatheringState);
        });

        this.pc.addEventListener('iceconnectionstatechange', () => {
            console.log("[PC] ICE Connection state:", this.pc.iceConnectionState);
        });

        this.pc.addEventListener('signalingstatechange', () => {
            console.log("[PC] Signaling state:", this.pc.signalingState);
        });
    }

    async negotiate() {
        try {
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);

            await new Promise<void>((resolve) => {
                if (this.pc.iceGatheringState === 'complete') {
                    resolve();
                } else {
                    const checkState = () => {
                        if (this.pc.iceGatheringState === 'complete') {
                            this.pc.removeEventListener('icegatheringstatechange', checkState);
                            resolve();
                        }
                    };

                    this.pc.addEventListener('icegatheringstatechange', checkState);
                }
            });

            // Make the request to a different URL at http://localhost:8081/offer
            const response = await fetch('http://localhost:8081/offer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sdp: this.pc.localDescription?.sdp,
                    type: this.pc.localDescription?.type,
                }),
            });

            const answer = await response.json();
            await this.pc.setRemoteDescription(answer);
        } catch (e) {
            alert(e);
        }
    }

    start() {
        return this.negotiate();
    }

    createDataChannel(
        name: string,
        onClose: () => void,
        onOpen: () => void,
        onMessage: (event: MessageEvent) => void
    ): RTCDataChannel {
        const dc = this.pc.createDataChannel(name, { ordered: true });
        dc.onclose = onClose;
        dc.onopen = onOpen;
        dc.onmessage = onMessage;
        return dc;
    }

    stop() {
        if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
            this.mediaRecorder.stop();
        }

        this.pc.getTransceivers().forEach(transceiver => transceiver.stop?.());
        this.pc.getSenders().forEach(sender => sender.track?.stop());
        this.pc.close();
    }

    addMediaHandles(
        onAudio: ((evt: RTCTrackEvent) => void) | null,
        onVideo: ((evt: RTCTrackEvent) => void) | null
    ) {
        if (onVideo) {
            this.pc.addTransceiver("video");
        }
        if (onAudio) {
            this.pc.addTransceiver("audio");
        }

        this.pc.addEventListener('track', evt => {
            if (evt.track.kind === 'video' && onVideo) {
                this.setupRecording(evt.streams[0]);
                onVideo(evt);
            } else if (evt.track.kind === 'audio' && onAudio) {
                onAudio(evt);
            }
        });
    }

    setupRecording(stream: MediaStream) {
        this.mediaRecorder = new MediaRecorder(stream);

        this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
            if (event.data.size > 0) {
                this.recordedChunks.push(event.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `recorded-stream-${Date.now()}.webm`;
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(url);
        };

        this.mediaRecorder.start();
    }
}

export let dataChannel: RTCDataChannel;
export let webrtcInstance: WebRTC;

function onMessage(evt: MessageEvent) {
    const action = JSON.parse(evt.data);
    console.log(action);
}

export function start() {
    webrtcInstance = new WebRTC();
    dataChannel = webrtcInstance.createDataChannel(
        'pingChannel',
        () => console.log("[DC] closed"),
        () => console.log("[DC] opened"),
        onMessage
    );
    webrtcInstance.addMediaHandles(
        null,
        evt => ((document.getElementById('video') as HTMLVideoElement).srcObject = evt.streams[0])
    );
    webrtcInstance.start();
}

export function stop() {
    if (dataChannel) {
        dataChannel.send(JSON.stringify({ type: 'STREAM_CLOSED' }));
    }
    setTimeout(() => webrtcInstance.stop(), 100);
}