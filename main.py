import asyncio
import json
import logging
import uuid
from pathlib import Path

from aiohttp import web
from aiortc import RTCPeerConnection, RTCSessionDescription

from datachannel import setup_datachannel
from transformators import DepthAIVideoTransformTrack, DepthAIDepthVideoTransformTrack
import aiohttp_cors
import depthai as dai

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("pc")

async def index(request):
    with (Path(__file__).parent / 'client/index.html').open() as f:
        return web.Response(content_type="text/html", text=f.read())
    
class OptionsWrapper:
    def __init__(self, raw_options):
        self.raw_options = raw_options

    @property
    def width(self):
        return int(self.raw_options.get('cam_width', 300))

    @property
    def height(self):
        return int(self.raw_options.get('cam_height', 300))

    @property
    def nn(self):
        return self.raw_options.get('nn_model', '')

    @property
    def mono_camera_resolution(self):
        return self.raw_options.get('mono_camera_resolution', 'THE_400_P')

    @property
    def median_filter(self):
        return self.raw_options.get('median_filter', 'KERNEL_7x7')
    
    @property
    def subpixel(self):
        return bool(self.raw_options.get('subpixel', ''))

    @property
    def extended_disparity(self):
        return bool(self.raw_options.get('extended_disparity', ''))

async def offer(request):
    params = await request.json()
    rtc_offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])
    options = OptionsWrapper(params.get("options", dict()))

    pc = RTCPeerConnection()
    pc_id = f"PeerConnection({uuid.uuid4()})"
    request.app.pcs.add(pc)

    # handle offer
    await pc.setRemoteDescription(rtc_offer)
    logger.info("Created for {}".format(request.remote))

    setup_datachannel(pc, pc_id, request.app)

    # Shared device and pipeline
    if not hasattr(request.app, 'device'):
        pipeline = dai.Pipeline()

        # RGB Camera
        camRgb = pipeline.create(dai.node.ColorCamera)
        # camRgb.setPreviewSize(640, 480)
        camRgb.setPreviewSize(options.width, options.height)
        camRgb.setInterleaved(False)
        camRgb.setColorOrder(dai.ColorCameraProperties.ColorOrder.RGB)
        xoutRgb = pipeline.create(dai.node.XLinkOut)
        xoutRgb.setStreamName("rgb")
        camRgb.preview.link(xoutRgb.input)

        # Depth Camera
        monoLeft = pipeline.create(dai.node.MonoCamera)
        monoRight = pipeline.create(dai.node.MonoCamera)
        depth = pipeline.create(dai.node.StereoDepth)
        xoutDepth = pipeline.create(dai.node.XLinkOut)
        xoutDepth.setStreamName("depth")

        # monoLeft.setResolution(dai.MonoCameraProperties.SensorResolution.THE_400_P)
        # monoRight.setResolution(dai.MonoCameraProperties.SensorResolution.THE_400_P)
        if options.mono_camera_resolution == 'THE_400_P':
            monoLeft.setResolution(dai.MonoCameraProperties.SensorResolution.THE_400_P)
            monoRight.setResolution(dai.MonoCameraProperties.SensorResolution.THE_400_P)
        elif options.mono_camera_resolution == 'THE_720_P':
            monoLeft.setResolution(dai.MonoCameraProperties.SensorResolution.THE_720_P)
            monoRight.setResolution(dai.MonoCameraProperties.SensorResolution.THE_720_P)
        elif options.mono_camera_resolution == 'THE_800_P':
            monoLeft.setResolution(dai.MonoCameraProperties.SensorResolution.THE_800_P)
            monoRight.setResolution(dai.MonoCameraProperties.SensorResolution.THE_800_P)

        monoLeft.setBoardSocket(dai.CameraBoardSocket.LEFT)
        monoRight.setBoardSocket(dai.CameraBoardSocket.RIGHT)

        # depth.setMedianFilter(dai.StereoDepthProperties.MedianFilter.KERNEL_7x7)
        if options.median_filter == 'MEDIAN_OFF':
            depth.setMedianFilter(dai.StereoDepthProperties.MedianFilter.MEDIAN_OFF)
        elif options.median_filter == 'KERNEL_3x3':
            depth.setMedianFilter(dai.StereoDepthProperties.MedianFilter.KERNEL_3x3)
        elif options.median_filter == 'KERNEL_5x5':
            depth.setMedianFilter(dai.StereoDepthProperties.MedianFilter.KERNEL_5x5)
        elif options.median_filter == 'KERNEL_7x7':
            depth.setMedianFilter(dai.StereoDepthProperties.MedianFilter.KERNEL_7x7)

        depth.setExtendedDisparity(options.extended_disparity)
        depth.setSubpixel(options.subpixel)

        monoLeft.out.link(depth.left)
        monoRight.out.link(depth.right)
        depth.disparity.link(xoutDepth.input)

        request.app.device = dai.Device(pipeline)
        request.app.rgbQueue = request.app.device.getOutputQueue(name="rgb", maxSize=4, blocking=False)
        request.app.depthQueue = request.app.device.getOutputQueue(name="depth", maxSize=4, blocking=False)
        request.app.depth = depth

    # Adding RGB track
    rgb_track = DepthAIVideoTransformTrack(request.app, pc_id, options, request.app.rgbQueue)
    rgb_track.track_id = f"{pc_id}_rgb"
    request.app.video_transforms[pc_id] = rgb_track
    pc.addTrack(request.app.video_transforms[pc_id])

    # Adding Depth track
    depth_track = DepthAIDepthVideoTransformTrack(request.app, pc_id, options, request.app.depthQueue, request.app.depth)
    depth_track.track_id = f"{pc_id}_depth"
    request.app.video_transforms[f"{pc_id}_depth"] = depth_track
    pc.addTrack(request.app.video_transforms[f"{pc_id}_depth"])

    @pc.on("iceconnectionstatechange")
    async def on_iceconnectionstatechange():
        logger.info("ICE connection state is %s", pc.iceConnectionState)
        if pc.iceConnectionState == "failed":
            await pc.close()
            request.app.pcs.discard(pc)

    @pc.on("track")
    def on_track(track):
        logger.info("Track {} received".format(track.kind))

    await pc.setLocalDescription(await pc.createAnswer())

    return web.Response(
        content_type="application/json",
        text=json.dumps({"sdp": pc.localDescription.sdp, "type": pc.localDescription.type, "video_ids": [f"{pc_id}_rgb", f"{pc_id}_depth"]}),
    )

async def on_shutdown(application):
    coroutines = [pc.close() for pc in application.pcs]
    await asyncio.gather(*coroutines)
    application.pcs.clear()
    if hasattr(application, 'device'):
        del application.device

def init_app(application):
    setattr(application, 'pcs', set())
    setattr(application, 'pcs_datachannels', {})
    setattr(application, 'video_transforms', {})

if __name__ == "__main__":
    app = web.Application()
    init_app(app)
    app.on_shutdown.append(on_shutdown)
    app.router.add_get("/", index)
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
                allow_credentials=True,
                expose_headers="*",
                allow_headers="*",
            )
    })
    cors.add(app.router.add_post("/offer", offer))
    web.run_app(app, port=8081)
