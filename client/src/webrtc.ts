export interface WebRTCConfiguration {
    // camera_type: string;
    cam_width: number;
    cam_height: number;
    nn_model: string;
    mono_camera_resolution: string;
    median_filter: string;
    subpixel: string;
    extended_disparity: string;
}

export class WebRTC {
    // private config: RTCConfiguration = {
    //     sdpSemantics: 'unified-plan',
    // };

    private props: WebRTCConfiguration = {
        // camera_type: 'rgb',
        cam_width: 1920,
        cam_height: 1080,
        nn_model: '',
        mono_camera_resolution: 'THE_400_P',
        median_filter: 'KERNEL_7x7',
        subpixel: '',
        extended_disparity: '',
    }

    private pc: RTCPeerConnection;
    private rgbRecorder: MediaRecorder | null = null;
    private depthRecorder: MediaRecorder | null = null;
    private rgbChunks: Blob[] = [];
    private depthChunks: Blob[] = [];

    private rgbStream: MediaStream | null = null;
    private depthStream: MediaStream | null = null;

    constructor(props?: WebRTCConfiguration) {
        if (props) {
            this.props = props;
        }
        // this.pc = new RTCPeerConnection(this.config);
        this.pc = new RTCPeerConnection();

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