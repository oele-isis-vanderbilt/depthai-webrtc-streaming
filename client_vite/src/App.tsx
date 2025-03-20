import React, { useState } from 'react';
import { WebRTC, WebRTCConfiguration } from './webrtc.ts'; // Adjust the import path as necessary

// Create an interface for both the webrtcinstance and the data channel
type WebRTCInstance = {
    webrtcInstance: WebRTC;
    dataChannel: RTCDataChannel;
};

const WebRTCControls: React.FC = () => {
    const [cameraType, setCameraType] = useState<string>('rgb');
    const [webRTCInstance, setWebRTCInstance] = useState<WebRTCInstance | null>(null);

    const selectCamera = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setCameraType(event.target.value);
    };

    function onMessage(evt: MessageEvent) {
        const action = JSON.parse(evt.data);
        console.log(action);
    }

    function start() {
        const config: WebRTCConfiguration = {
            camera_type: "depth",
            mono_camera_resolution: "THE_400_P",
            median_filter: "KERNEL_7x7",
            subpixel: "",
            extended_disparity: "",
            cam_width: 1920,
            cam_height: 1080,
            nn_model: ""
        }
        const webrtcInstance = new WebRTC(config);
        const dataChannel = webrtcInstance.createDataChannel(
            'pingChannel',
            () => console.log("[DC] closed"),
            () => console.log("[DC] opened"),
            onMessage,
        );
        webrtcInstance.addMediaHandles(
            null,
            evt => {
                const videoElement = document.getElementById('video') as HTMLVideoElement | null;
                if (videoElement) {
                    videoElement.srcObject = evt.streams[0];
                }
            }
        );
        webrtcInstance.start();
        setWebRTCInstance({ webrtcInstance, dataChannel });
    }

    function stop() {
        const { webrtcInstance, dataChannel } = webRTCInstance as WebRTCInstance;
        console.log("stop")
        if (dataChannel) {
            dataChannel.send(JSON.stringify({'type': 'STREAM_CLOSED'}))
        }
        setTimeout(() => webrtcInstance.stop(), 100);
    }

    return (
        <div>

            <div>
                <h2>Options</h2>
                <form id="options-form">
                    <label htmlFor="camera_type">Camera Type:</label>
                    <select name="camera_type" id="camera_type" value={cameraType} onChange={selectCamera}>
                        <option value="rgb">RGB Camera</option>
                        <option value="depth">Depth</option>
                    </select>

                    {cameraType === 'rgb' && (
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
                                <option value="pedestrian-and-vehicle-detector-adas-0001">pedestrian-and-vehicle-detector-adas-0001</option>
                                <option value="pedestrian-detection-adas-0002">pedestrian-detection-adas-0002</option>
                                <option value="person-detection-retail-0013">person-detection-retail-0013</option>
                                <option value="person-vehicle-bike-detection-crossroad-1016">person-vehicle-bike-detection-crossroad-1016</option>
                                <option value="vehicle-detection-adas-0002">vehicle-detection-adas-0002</option>
                                <option value="vehicle-license-plate-detection-barrier-0106">vehicle-license-plate-detection-barrier-0106</option>
                            </select>
                        </div>
                    )}

                    {cameraType === 'depth' && (
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

                            <input type="checkbox" id="subpixel" name="subpixel" value="on" />
                            <label htmlFor="subpixel">Subpixel</label>

                            <input type="checkbox" id="extended_disparity" name="extended_disparity" value="on" />
                            <label htmlFor="extended_disparity">Extended disparity</label>
                        </div>
                    )}
                </form>
            </div>

            <div>
                <button id="start" onClick={() => start()}>Start</button>
                <button id="stop" onClick={() => stop()}>Stop</button>
                {/* <button id="ping" onClick={() => sendMessage({ type: 'ping' })}>Ping</button> */}
            </div>

            <video id="video" autoPlay playsInline width={1920} height={1080}></video>
        </div>
    );
};

export default WebRTCControls;
