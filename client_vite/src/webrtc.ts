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
    private rgbRecorder: MediaRecorder | null = null;
    private depthRecorder: MediaRecorder | null = null;
    private recordedChunks: Blob[];
    private rgbChunks: Blob[] = [];
    private depthChunks: Blob[] = [];
    private trackCount = 0;

    private rgbStream: MediaStream | null = null;
    private depthStream: MediaStream | null = null;

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
        this.rgbRecorder?.stop();
        this.depthRecorder?.stop();

        this.pc.getTransceivers().forEach(transceiver => transceiver.stop?.());
        this.pc.getSenders().forEach(sender => sender.track?.stop());
        this.pc.close();
    }

    addMediaHandles(onRgbVideo: (stream: MediaStream) => void, onDepthVideo: (stream: MediaStream) => void) {
        this.pc.addTransceiver('video'); // RGB
        this.pc.addTransceiver('video'); // Depth

        // this.pc.ontrack = (evt: RTCTrackEvent) => {
        //     const stream = evt.streams[0];
        //     const trackId = evt.track.id;
        //     console.log(evt)
        //     console.log("Received track:", evt.track.kind, "id:", trackId);
        
        //     // Simple heuristic based on MediaStreamTrack properties:
        //     if (evt.track.kind === 'video') {
        //         console.log("Video track:", evt.track.label);
        //         console.log(this.rgbStream, this.depthStream, stream.id);
        //         if (!this.rgbStream) {
        //             console.log("Setting up RGB stream");
        //             this.rgbStream = stream;
        //             onRgbVideo(stream);
        //             this.setupRecorder(stream, 'rgb');
        //         } else if (!this.depthStream && stream.id !== this.rgbStream.id) {
        //             console.log("Setting up Depth stream");
        //             this.depthStream = stream;
        //             onDepthVideo(stream);
        //             this.setupRecorder(stream, 'depth');
        //         }
        //     }
        // };

        this.pc.ontrack = (evt: RTCTrackEvent) => {
            console.log("Track received:", evt.track.kind, evt.track.id);
        
            if (evt.track.kind === 'video') {
                const newStream = new MediaStream([evt.track]);
        
                if (!this.rgbStream) {
                    this.rgbStream = newStream;
                    onRgbVideo(this.rgbStream);
                    this.setupRecorder(this.rgbStream, 'rgb');
                } else if (!this.depthStream && evt.track.id !== this.rgbStream.getVideoTracks()[0].id) {
                    this.depthStream = newStream;
                    onDepthVideo(this.depthStream);
                    this.setupRecorder(this.depthStream, 'depth');
                }
            }
        };
        
        
        // this.pc.addEventListener('track', evt => {
        //     console.log(evt)
        //     // if (evt.track.kind === 'video' && onVideo) {
        //     //     this.setupRecording(evt.streams[0]);
        //     //     onVideo(evt);
        //     // } else if (evt.track.kind === 'audio' && onAudio) {
        //     //     onAudio(evt);
        //     // }
        // });
    }

    private setupRecorder(stream: MediaStream, type: 'rgb' | 'depth') {
        const recorder = new MediaRecorder(stream);
        const chunks = type === 'rgb' ? this.rgbChunks : this.depthChunks;

        recorder.ondataavailable = (event: BlobEvent) => {
            if (event.data.size > 0) chunks.push(event.data);
        };

        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${type}-stream-${Date.now()}.webm`;
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(url);
        };

        recorder.start();

        if (type === 'rgb') this.rgbRecorder = recorder;
        else this.depthRecorder = recorder;
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