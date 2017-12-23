var toArrayBuffer = require("to-array-buffer")
var tou8 = require("buffer-to-uint8array")
const fs = require("fs")
const raf = require("raf")
var toBuffer = require("typedarray-to-buffer")
const ffmpeg = require("./lib/ffmpeg")
const FB = require("./lib/fb")
const GL = require("./lib/gl")
const KEYBOARD = require("./lib/keyboard")
const VIDEO_OVERLAYS = require("./lib/video_overlays")
const BITRATE_A = 140
const BITRATE_V = 400
const FPS = 30
/*const WIDTH = 640
const HEIGHT = 480*/
const WIDTH = 352
const HEIGHT = 288
//!!!!!!!!
const OFFLINE = true
//!!!!!!!!
const FB_PRIVACY = "private"
//SAM
const FB_ACCESS_TOKEN =
  "EAAXiyxq1MwkBAOg8Qi5h17SIPtgkG0dfiFxn0u5kjTqC2YVNtZC9Cnd8lVWsmIZB3P4xmccCPpZB9XhKe1MC7yOTXmhL96xkgkB4GAZBiwiQkR4FNbVkKbZBydJ2zdSYVUFOQhsy6FtNh66HYTKz1ys74Oa4vPSEZD"
//DAD
// const FB_ACCESS_TOKEN =
//   "EAAXiyxq1MwkBAChJIEEIgdKLVCEwMNJv068D4Cfmy0zcoE3ZCml9wJ7RZBkttxPMyMD3IAjiEgOPbo4cbPWxhHAMfguKSA2Ad3jShq17EchLxaMnuZCXBLeAJ32XxgXfPbBtSxhzIxqQjRy5B9ZBqIsXjEd6fL8ZD"

const TCP = false
const TCP_STREAM_NAME = "/webcam"

var now = require("performance-now")
const WebcamWebsocket = require("./index")
const WEBCAM_IPS = ["10.0.1.9", "10.0.1.7"] //, "10.0.1.3"//"10.0.1.9", "10.0.1.7"
const WEBCAM_IP = "10.0.1.7"
const WEBCAM_IP_2 = "10.0.1.9"
const STREAM_IP = "10.0.1.8"
const STREAM_PORT = "1337"
const web = WebcamWebsocket()

let FFMPEG
function startStream(options) {
  let maxrate = options.maxrate || 600
  console.log(
    options.output || `"udp://${options.ip}:${options.port}"`
  )

  FFMPEG = ffmpeg({
    ...options,
    w: options.w,
    h: options.h,
    output: options.output,
    options: [`${options.options || ""} `],
  })
}

/*const ff2 = web.connect(GL, WEBCAM_IP_2, {
  ip: STREAM_IP,
  port: "1337",
})*/

const GL_UNIFORMS = {
  keySlope: 0.1,
  keyTolerance: 0.8,
  trailIndex: 0,
  trailAmount: 0.3,
  keyIndex: 1,
  keyColor: [0.8, 0.8, 0.8],
  uSaturations: [1, 1, 1, 1],

  overlayKeyColor: [1, 1, 1],
  overlayKeySlope: 0.1,
  overlayKeyTolerance: 0.8,
  overlayContrast: 1,
  overlaySaturation: 1,
  overlaySelectionIndex: 1,
  overlayTone: [0, 0.1],

  pulseAmount: 0.08,
  selectionIndex: 0,
}

const gl = GL({
  width: WIDTH,
  height: HEIGHT,
})

const feedback = gl.regl.texture()

const connections = WEBCAM_IPS.map(ip =>
  web.connect(gl, ip, {
    ip: STREAM_IP,
    port: "1337",
  })
)

const VIDEO_TEX = gl.regl.texture()

const videoOverlays = VIDEO_OVERLAYS(VIDEO_TEX, {
  dir: "_videos",
})

var _t = now().toFixed(3)
var handle = raf(function tick() {
  var start = now().toFixed(3)

  if (start - _t >= 22 && FFMPEG) {
    //&& ff2.player.outBuffer

    if (WEBCAM_IPS.length == 1) {
      if (connections[0].player.outBuffer) {
        gl.drawSingle({
          tex0: connections[0].player.pixels,
          overlay: VIDEO_TEX,
        })
        FFMPEG.frame(toBuffer(gl.read(WIDTH, HEIGHT)))
      }
    } else if (WEBCAM_IPS.length == 2) {
      if (
        connections[0].player.outBuffer &&
        connections[1].player.outBuffer
      ) {
        //console.log(ff2.player.outBuffer.buffer);
        /*return gl.read(new Uint8Array(WIDTH * HEIGHT * 4))

      renderWebgl(ff.player.outBuffer, ff2.player.outBuffer)
      var pixels = new Uint8Array(W * H * 4)
      GL.readPixels(0, 0, W, H, GL.RGBA, GL.UNSIGNED_BYTE, pixels)*/
        //FFMPEG.frame(toBuffer(ff2.player.outBuffer))
        gl.mergeStreams({
          tex0: connections[0].player.pixels,
          tex1: connections[1].player.pixels,
          feedback: feedback,
          overlay: VIDEO_TEX,
          keySlope: GL_UNIFORMS.keySlope,
          keyTolerance: GL_UNIFORMS.keyTolerance,
          overlayKeySlope: GL_UNIFORMS.overlayKeySlope,
          overlayKeyTolerance: GL_UNIFORMS.overlayKeyTolerance,
          overlayKeyColor: GL_UNIFORMS.overlayKeyColor,
          overlayContrast: GL_UNIFORMS.overlayContrast,
          overlaySaturation: GL_UNIFORMS.overlaySaturation,
          overlaySelectionIndex: GL_UNIFORMS.overlaySelectionIndex,
          overlayTone: GL_UNIFORMS.overlayTone,
          pulseAmount: GL_UNIFORMS.pulseAmount,
          trailAmount: GL_UNIFORMS.trailAmount,
          keyIndex: GL_UNIFORMS.keyIndex,
          trailIndex: GL_UNIFORMS.trailIndex,
          keyColor: GL_UNIFORMS.keyColor,
          uSaturations: GL_UNIFORMS.uSaturations,
        })
        feedback({
          copy: true,
        })
        FFMPEG.frame(toBuffer(gl.read(WIDTH, HEIGHT)))
      }
    } else {
    }
    _t = start
  }
  raf(tick)
})

/*const ff = web.connect(gl, WEBCAM_IP_2, {
  ip: STREAM_IP,
  port: "1337",
})
*/

const startFFMPEG = rtmpUrl => {
  const _videoBitrate = ` -preset ultrafast -tune zerolatency  -b:v ${BITRATE_V}k -minrate ${BITRATE_V /
    2}k  -maxrate ${BITRATE_V}k  -bufsize ${BITRATE_V *
    2}k -analyzeduration 2048 -probesize 128 `

  //-fflags nobuffer
  const _framerate = `-g ${Math.round(
    FPS * 2
  )} -r ${FPS} -framerate ${FPS} `
  const _options = OFFLINE
    ? `${TCP
        ? " -acodec aac -strict -2 -ar 48000 -ab 96k " //TCP
        : ""} ${_framerate} ${TCP ? "" : " "} `
    : ` -b:a ${BITRATE_A}k -c:v libx264 -pix_fmt yuv420p ${_framerate}`

  const _format = OFFLINE ? `${TCP ? "" : " -f mpegts"} ` : ` -f flv `

  const _audioInput = OFFLINE
    ? ["-y", "-f", "avfoundation", "-i", ":3", "-framerate", FPS]
    : ["-y", "-f", "avfoundation", "-i", ":3", "-framerate", FPS]
  startStream(
    Object.assign(
      {},
      {
        //input: [],
        input: _audioInput,
        // input: OFFLINE
        //   ? null
        //   : ["-y", "-f", "avfoundation", "-i", ":3"],
        //input: ["-f", "alsa", "-ac", "1", "-ar", "44100" ,"-i", "hw:3"],
        //input: ["-i", "hw:1,0","-f alsa", "-ac", "2",],
        options: `${_options} ${_videoBitrate} ${_format}`,
        //output: `"rtmp://a.rtmp.youtube.com/live2/f5v7-kfmq-27ce-9dft"`, //`"${rtmpUrl}"`,
        output: OFFLINE
          ? `${TCP
              ? `"http://127.0.0.1:8080${TCP_STREAM_NAME}.ffm"` //TCP
              : `"udp://${STREAM_IP}:${STREAM_PORT}"`}`
          : `"${rtmpUrl}"`,
      },
      { w: WIDTH, h: HEIGHT }
    )
  )

  const keyboard = KEYBOARD({
    GL_UNIFORMS,
    FB,
    FB_ACCESS_TOKEN,
    FFMPEG,
    WEBCAM_IPS,
  })
}

function start() {
  if (OFFLINE) {
    startFFMPEG()
  } else {
    var privacys = {
      public: "{'value':'EVERYONE'}",
      friends: "{'value':'ALL_FRIENDS'}",
      friends_of_friends: "{'value':'FRIENDS_OF_FRIENDS'}",
      private: null,
    }
    FB.startLiveVideo({
      accessToken: FB_ACCESS_TOKEN,
      title: "Live Video",
      privacy: privacys[FB_PRIVACY],
      /*privacy:
        privacys["public"] ||
        "{'value':'CUSTOM',allow:'100009508046151,1751806573'}",*/
    })
      .then(liveVideo => {
        var rtmpUrl = liveVideo.stream_url
        FB.postId = liveVideo.id

        startFFMPEG(rtmpUrl)
      })
      .catch(error => {
        console.error(error.message, error.options)
      })
  }
}

start()

setTimeout(() => {
  FFMPEG.end()
  FB.endLiveVideo({
    postId: FB.postId,
    accessToken: FB_ACCESS_TOKEN,
  })
  console.log("ENDED!")
  process.exit()
}, 15 * 60 * 1000)

console.log(`PRESS <ESCAPE TO FINISH`)

//initWebgl()

//startStream(Object.assign({}, ffmpegOptions, { w: W, h: H }))
