import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import Any, Optional

from aiohttp import web
import aiortc
from aiortc import RTCPeerConnection, RTCSessionDescription

from datachannel import setup_datachannel
from transformators import DepthAIVideoTransformTrack, DepthAIDepthVideoTransformTrack
# from old_transformators import DepthAIVideoTransformTrack, DepthAIDepthVideoTransformTrack
import aiohttp_cors
import depthai as dai

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("pc")

def aiortc_multiple_stream_patch() -> None:
    def _patched_route_rtp(self, packet) -> Optional[Any]:
        ssrc_receiver = self.ssrc_table.get(packet.ssrc)

        # the SSRC are known
        if ssrc_receiver is not None:
            return ssrc_receiver

        pt_receiver = self.payload_type_table.get(packet.payload_type)

        # the SSRC is unknown but the payload type matches, update the SSRC table
        if ssrc_receiver is None and pt_receiver is not None:
            self.ssrc_table[packet.ssrc] = pt_receiver
            return pt_receiver

        # discard the packet
        return None

    aiortc.rtcdtlstransport.RtpRouter.route_rtp = _patched_route_rtp

aiortc_multiple_stream_patch()

async def index(request):
    with (Path(__file__).parent / 'client/index.html').open() as f:
        return web.Response(content_type="text/html", text=f.read())

async def javascript(request):
    with (Path(__file__).parent / 'client/build/client.js').open() as f:
        return web.Response(content_type="application/javascript", text=f.read())
    
class OptionsWrapper:
    def __init__(self, raw_options):
        self.raw_options = raw_options

    @property
    def camera_type(self):
        return self.raw_options.get('camera_type', 'rgb')

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
        camRgb.setPreviewSize(640, 480)
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

        monoLeft.setResolution(dai.MonoCameraProperties.SensorResolution.THE_400_P)
        monoRight.setResolution(dai.MonoCameraProperties.SensorResolution.THE_400_P)
        monoLeft.setBoardSocket(dai.CameraBoardSocket.LEFT)
        monoRight.setBoardSocket(dai.CameraBoardSocket.RIGHT)

        depth.setMedianFilter(dai.StereoDepthProperties.MedianFilter.KERNEL_7x7)
        monoLeft.out.link(depth.left)
        monoRight.out.link(depth.right)
        depth.disparity.link(xoutDepth.input)

        request.app.device = dai.Device(pipeline)
        request.app.rgbQueue = request.app.device.getOutputQueue(name="rgb", maxSize=4, blocking=False)
        request.app.depthQueue = request.app.device.getOutputQueue(name="depth", maxSize=4, blocking=False)
        request.app.depth = depth

    # Add tracks for both RGB and Depth
    # rgb_track = DepthAIVideoTransformTrack(request.app, pc_id, options, request.app.rgbQueue)
    # depth_track = DepthAIDepthVideoTransformTrack(request.app, pc_id, options, request.app.depthQueue, request.app.depth)
    # request.app.video_transforms[pc_id] = {"rgb": rgb_track, "depth": depth_track}

    # for t in pc.getTransceivers():
    #     if t.kind == "video":
    # if options.camera_type == 'rgb':
    # request.app.video_transforms[pc_id] = DepthAIVideoTransformTrack(request.app, pc_id, options)
    rgb_track = DepthAIVideoTransformTrack(request.app, pc_id, options, request.app.rgbQueue)
    rgb_track.track_id = f"{pc_id}_rgb"
    request.app.video_transforms[pc_id] = rgb_track
    # elif options.camera_type == 'depth':
        # request.app.video_transforms[pc_id] = DepthAIDepthVideoTransformTrack(request.app, pc_id, options)
    depth_track = DepthAIDepthVideoTransformTrack(request.app, pc_id, options, request.app.depthQueue, request.app.depth)
    depth_track.track_id = f"{pc_id}_depth"
    request.app.video_transforms[f"{pc_id}_depth"] = depth_track
    pc.addTrack(request.app.video_transforms[pc_id])
    pc.addTrack(request.app.video_transforms[f"{pc_id}_depth"])

    # self.assertEqual(pc.getSenders(), [video_sender1, video_sender2, audio_sender])
    logger.info("Tracks %s", pc.getSenders())
    logger.info("Transceivers %s", pc.getTransceivers())
    # self.assertEqual(len(pc.getTransceivers()), 3)

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
    app.router.add_get("/client.js", javascript)
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
                allow_credentials=True,
                expose_headers="*",
                allow_headers="*",
            )
    })
    cors.add(app.router.add_post("/offer", offer))
    web.run_app(app, port=8081)
