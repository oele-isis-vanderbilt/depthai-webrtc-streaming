import React, { useState } from 'react';
import { WebRTC, WebRTCConfiguration } from './webrtc.ts';

// Create an interface for both the webrtcinstance and the data channel
type WebRTCInstance = {
    webrtcInstance: WebRTC;
    dataChannel: RTCDataChannel;
};

const WebRTCControls: React.FC = () => {
    const [webRTCInstance, setWebRTCInstance] = useState<WebRTCInstance | null>(null);

    function onMessage(evt: MessageEvent) {
        const action = JSON.parse(evt.data);
        console.log(action);
    }

    const start = () => {
        const formData = new FormData(document.getElementById('options-form') as HTMLFormElement);

        const config: WebRTCConfiguration = {
            cam_width: Number(formData.get('cam_width')) || 1920,
            cam_height: Number(formData.get('cam_height')) || 1080,
            nn_model: formData.get('nn_model') as string || '',
            mono_camera_resolution: formData.get('mono_camera_resolution') as string || 'THE_400_P',
            median_filter: formData.get('median_filter') as string || 'KERNEL_7x7',
            subpixel: formData.get('subpixel') ? 'on' : '',
            extended_disparity: formData.get('extended_disparity') ? 'on' : '',
        };
        console.log(config);

        const webrtcInstance = new WebRTC(config);

        const dataChannel = webrtcInstance.createDataChannel(
            'pingChannel',
            () => console.log('[DC] closed'),
            () => console.log('[DC] opened'),
            onMessage,
        );

        webrtcInstance.addMediaHandles(
            (rgbStream) => {
                const rgbVideo = document.getElementById('rgbVideo') as HTMLVideoElement;
                rgbVideo.srcObject = rgbStream;
            },
            (depthStream) => {
                const depthVideo = document.getElementById('depthVideo') as HTMLVideoElement;
                depthVideo.srcObject = depthStream;
            }
        );

        webrtcInstance.start();
        setWebRTCInstance({ webrtcInstance, dataChannel });
    };

    const stop = () => {
        const { webrtcInstance, dataChannel } = webRTCInstance as WebRTCInstance;
        if (dataChannel) {
            dataChannel.send(JSON.stringify({ type: 'STREAM_CLOSED' }));
        }
        setTimeout(() => webrtcInstance.stop(), 100);
    };

    return (
        <div>
            <div>
                <h2>Options</h2>
                <form id="options-form">
                    <div>
                        <h1>RGB Configuration</h1>
                        <div id="rgb_camera_options">
                            <label htmlFor="cam_width">Cam width:</label>
                            <input id="cam_width" name="cam_width" type="number" defaultValue={1920} />

                            <label htmlFor="cam_height">Cam height:</label>
                            <input id="cam_height" name="cam_height" type="number" defaultValue={1080} />

                            <label htmlFor="nn_model">Neural Network:</label>
                            <select name="nn_model" id="nn_model">
                                <option value="">--</option>
                                <option value="age-gender-recognition-retail-0013">age-gender-recognition-retail-0013</option>
                                <option value="face-detection-adas-0001">face-detection-adas-0001</option>
                                <option value="face-detection-retail-0004">face-detection-retail-0004</option>
                                <option value="mobilenet-ssd">mobilenet-ssd</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <h1>Depth Configuration</h1>
                        <div id="depth_options">
                            <label htmlFor="mono_camera_resolution">Mono Camera Resolution:</label>
                            <select name="mono_camera_resolution" id="mono_camera_resolution" defaultValue="THE_400_P">
                                <option value="THE_400_P">THE_400_P</option>
                                <option value="THE_720_P">THE_720_P</option>
                                <option value="THE_800_P">THE_800_P</option>
                            </select>

                            <label htmlFor="median_filter">Median Filter:</label>
                            <select name="median_filter" id="median_filter" defaultValue="KERNEL_7x7">
                                <option value="MEDIAN_OFF">MEDIAN_OFF</option>
                                <option value="KERNEL_3x3">KERNEL_3x3</option>
                                <option value="KERNEL_5x5">KERNEL_5x5</option>
                                <option value="KERNEL_7x7">KERNEL_7x7</option>
                            </select>

                            <input type="checkbox" id="subpixel" name="subpixel" />
                            <label htmlFor="subpixel">Subpixel</label>

                            <input type="checkbox" id="extended_disparity" name="extended_disparity" />
                            <label htmlFor="extended_disparity">Extended disparity</label>
                        </div>
                    </div>
                </form>
            </div>

            <div>
                <button id="start" onClick={start}>Start</button>
                <button id="stop" onClick={stop}>Stop</button>
            </div>

            <div className="flex flex-row space-x-4 justify-center items-center">
                <div className="flex flex-col items-center">
                    <h3 className="mb-2 text-lg font-semibold">RGB Stream</h3>
                    <video id="rgbVideo" autoPlay playsInline width={1024} height={576} className="rounded-lg shadow-md" />
                </div>

                <div className="flex flex-col items-center">
                    <h3 className="mb-2 text-lg font-semibold">Depth Stream</h3>
                    <video id="depthVideo" autoPlay playsInline width={1024} height={576} className="rounded-lg shadow-md" />
                </div>
            </div>
        </div>
    );
};

export default WebRTCControls;
