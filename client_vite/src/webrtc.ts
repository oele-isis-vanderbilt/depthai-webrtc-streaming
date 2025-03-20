export interface WebRTCConfiguration {
    camera_type: string;
    cam_width: number;
    cam_height: number;
    nn_model: string;
    mono_camera_resolution: string;
    median_filter: string;
    subpixel: string;
    extended_disparity: string;
}

export class WebRTC {
    private config: RTCConfiguration = {
        sdpSemantics: 'unified-plan',
    };

    private props: WebRTCConfiguration = {
        camera_type: 'rgb',
        cam_width: 1920,
        cam_height: 1080,
        nn_model: '',
        mono_camera_resolution: 'THE_400_P',
        median_filter: 'KERNEL_7x7',
        subpixel: '',
        extended_disparity: '',
    }

    private pc: RTCPeerConnection;
    private mediaRecorder: MediaRecorder | null;
    private recordedChunks: Blob[];

    constructor(props?: WebRTCConfiguration) {
        if (props) {
            this.props = props;
        }
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
        const response = await fetch(`${import.meta.env.VITE_DEPTHAI_SERVER_URL}/offer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sdp: this.pc.localDescription?.sdp,
                type: this.pc.localDescription?.type,
                options: this.props,
            }),
        });

        const answer = await response.json();
        await this.pc.setRemoteDescription(answer);
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
            this.pc.addTransceiver("video"); // RGB
            this.pc.addTransceiver("video"); // Depth
        }
        if (onAudio) {
            this.pc.addTransceiver("audio");
        }

        this.pc.addEventListener('track', evt => {
            console.log(evt)
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

// export let dataChannel: RTCDataChannel;
// export let webrtcInstance: WebRTC;

// function onMessage(evt: MessageEvent) {
//     const action = JSON.parse(evt.data);
//     console.log(action);
// }

// export function start() {
//     webrtcInstance = new WebRTC();
//     dataChannel = webrtcInstance.createDataChannel(
//         'pingChannel',
//         () => console.log("[DC] closed"),
//         () => console.log("[DC] opened"),
//         onMessage
//     );
//     webrtcInstance.addMediaHandles(
//         null,
//         evt => ((document.getElementById('video') as HTMLVideoElement).srcObject = evt.streams[0])
//     );
//     webrtcInstance.start();
// }

// export function stop() {
//     if (dataChannel) {
//         dataChannel.send(JSON.stringify({ type: 'STREAM_CLOSED' }));
//     }
//     setTimeout(() => webrtcInstance.stop(), 100);
// }